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
 */
export const functions = [helloWorld, submitGenerationJob];
