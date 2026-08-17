import { and, eq, isNotNull, lt } from "drizzle-orm";

import { db } from "@/db";
import { imageJob } from "@/db/schema";
import { updateImageJobFromTaskResult } from "@/features/image-gen/lib/generation-service";
import { submitGeneration } from "@/features/gpt-image/lib/generation-service";
import { logger } from "@/lib/logger";

import { inngest } from "./client";

/**
 * Hello World 示例函数
 *
 * 演示 Inngest 后台任务的基本用法：
 * 1. 前端通过 inngest.send() 发送事件
 * 2. Inngest 函数在后台异步执行
 * 3. 使用 step.run() 进行可靠的步骤执行（支持重试）
 */
export const helloWorld = inngest.createFunction(
  {
    id: "hello-world",
    retries: 3,
  },
  { event: "app/hello-world" },
  async ({ event, step }) => {
    const result = await step.run("process-message", async () => {
      logger.info({ message: event.data.message }, "处理 hello-world 事件");
      return { processed: true, message: event.data.message };
    });

    return result;
  }
);

/**
 * gpt-image 生图任务触发器
 *
 * 上游路由（/upload、/regenerate）只做"收 URL + 写库 + 状态置 GENERATING"，
 * 然后 send 这个事件；本函数在 Inngest 后台跑 submitGeneration，把
 * submitLingtingTask 的 R2 下载（120s）+ Lingting POST（120s）从
 * Vercel 函数预算里挪走。
 *
 * 重要：不设 retries。Lingting 不支持幂等键，重复提交会重复扣配额；
 * 如果后台跑挂，宁可让订单落到 FAILED 让用户手动重试，也不要自动重试
 * 造成静默扣费。
 *
 * 注意：这里用 step.run 包住 submitGeneration 是为了让 Inngest 记录
 * 一次 step 完成，但 step.run 自身失败不会被重试（因为 fn 级 retries=0）。
 * 这正好是想要的——失败就显式抛，让 order 留在 GENERATING 由前端
 * stall watchdog 推到 FAILED。
 */
export const submitGenerationJob = inngest.createFunction(
  {
    id: "gpt-image-submit-generation",
    retries: 0,
  },
  { event: "gpt-image/submit-generation" },
  async ({ event, step }) => {
    const { orderId, fromIdx, total, candidateCount } = event.data;
    await step.run("submit-generation", async () => {
      logger.info(
        { orderId, fromIdx, total, candidateCount },
        "Inngest: 开始提交生图任务"
      );
      await submitGeneration(orderId, fromIdx, total, candidateCount);
    });
  }
);

/**
 * image-gen 工作台 —— reconcile 孤悬的 processing 行。
 *
 * 背景：工作台 (`src/features/image-gen/components/generate-workbench-view.tsx`)
 * 把 imageJob 的 status 推进全部押在前端 setTimeout 链上。如果用户：
 *   - 关掉 / 切走 Tab
 *   - 浏览器崩
 *   - 网络抖动把 setTimeout 吞掉
 * imageJob 在 DB 里会永远停在 `processing`，上游 WellAPI / Doubao / Gemini
 * 任务其实早就结束了。`/p/[token]` 有 Inngest 后台函数兜底，工作台没有。
 *
 * 本函数每 5 分钟 cron 触发一次，把 stale 的 `processing` 行重新打一次
 * 上游，按真实状态写回。`createdAt` 是基准 —— `image_job` 表没有 `updatedAt`
 * 列（与 gpt-image `promptOrder` 不同），所以用 `createdAt < now - 5min`
 * 作为"看起来卡了"的近似。
 *
 * 重试策略：retries=1（不是 0）。理由与 submitGenerationJob 不同 —— 本函数
 * 是只读 + 幂等的：再调一次上游拿到的是同一终态，多次重试不会扣更多钱。
 * 偶尔 Inngest 函数瞬时 throw 给它一次机会。
 */
export const reconcileStaleJobs = inngest.createFunction(
  {
    id: "image-gen-reconcile-stale-jobs",
    retries: 1,
  },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    const STALE_MS = 5 * 60_000;
    const BATCH = 20;
    const cutoff = new Date(Date.now() - STALE_MS);

    const stale = await step.run("find-stale", async () =>
      db.query.imageJob.findMany({
        where: and(
          eq(imageJob.status, "processing"),
          lt(imageJob.createdAt, cutoff),
          isNotNull(imageJob.taskId)
        ),
        limit: BATCH,
        orderBy: (j, { asc }) => [asc(j.createdAt)],
      })
    );

    if (stale.length === 0) {
      return { reconciled: 0 };
    }

    for (const job of stale) {
      // taskId 已经在 where 里过滤过非空，这里再 narrow 一下给 TS
      const taskId = job.taskId as string;
      await step.run(`reconcile-${job.id}`, async () => {
        try {
          const { dispatchQueryImageTask, parseTaskModel } = await import(
            "@/features/image-gen/lib/image-models/adapters"
          );
          const model = parseTaskModel(taskId);
          if (!model) {
            logger.warn(
              { jobId: job.id, taskId },
              "reconcile: 无法解析 model，跳过"
            );
            return;
          }
          const result = await dispatchQueryImageTask(model, taskId);
          await updateImageJobFromTaskResult(taskId, result);
          logger.info(
            {
              jobId: job.id,
              taskId,
              resultStatus: result.status,
            },
            "reconcile: 已同步 imageJob"
          );
        } catch (err) {
          // 单条失败不能让整个 cron 翻车 —— 下个窗口再试
          logger.warn(
            { err, jobId: job.id, taskId },
            "reconcile: 单条失败，下个 cron 再试"
          );
        }
      });
    }

    return { reconciled: stale.length };
  }
);

/**
 * 导出所有 Inngest 函数
 * 在 src/app/api/inngest/route.ts 中注册
 *
 * 注：原 generatePromptOrder 已移除 —— 生图改为 submit/poll 两段式
 * （服务端只提交，前端调 /api/orders/[token]/poll 驱动轮询），
 * 不再需要长时 worker，因此也不再依赖 Inngest。
 *
 * 2026-08-13 重新引入 submitGenerationJob：/upload 路由的同步 submit
 * 链路（R2 120s + Lingting 120s）撞 Vercel 函数预算太频繁，改为
 * Inngest 事件触发后立即返回 202，submit 在后台跑。
 *
 * 2026-08-17 引入 reconcileStaleJobs：image-gen 工作台没有 gpt-image 的
 * 服务端 /poll 路由，前端 setTimeout 链断了 DB 行就永远卡 processing。
 * 5 分钟 cron 兜底 reconcile。
 */
export const functions = [helloWorld, submitGenerationJob, reconcileStaleJobs];
