import { and, eq, isNotNull, lt } from "drizzle-orm";

import { db } from "@/db";
import { canvasRemoteJob, imageJob } from "@/db/schema";
import { generateOnServerSync } from "@/features/canvas/services/canvas-server-generate";
import { submitGeneration } from "@/features/gpt-image/lib/generation-service";
import { submitPreviewGeneration } from "@/features/gpt-image/lib/preview-generation";
import {
  dispatchImageGenerationJob,
  updateImageJobFromTaskResult,
} from "@/features/image-gen/lib/generation-service";
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
 * 2026-09-14：preview 流 6 步工作台 Inngest 事件函数。
 *
 * 与 submitGenerationJob 镜像，差异：payload 是 shareId 而非 orderId，操作
 * preview_share 表而非 promptOrder。retries=0 一致 —— Lingting 无幂等键，
 * 重复提交重复扣配额。
 *
 * 由 /api/orders/[token]/upload / regenerate 路由（preview 分支）触发：
 *   客人扫码进 /p/{token} → UploadStep 选图 → /upload 写 preview_share +
 *   send `gpt-image/submit-preview-generation` → 后台 submitPreviewGeneration
 *   写 status='generating' + generationTask JSON → /poll 路由推进
 */
export const submitPreviewGenerationJob = inngest.createFunction(
  {
    id: "gpt-image-submit-preview-generation",
    retries: 0,
  },
  { event: "gpt-image/submit-preview-generation" },
  async ({ event, step }) => {
    const { shareId, fromIdx, total, candidateCount } = event.data;
    await step.run("submit-preview-generation", async () => {
      logger.info(
        { shareId, fromIdx, total, candidateCount },
        "Inngest: 开始提交 preview 生图任务"
      );
      await submitPreviewGeneration(shareId, fromIdx, total, candidateCount);
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
          const { dispatchQueryImageTask } = await import(
            "@/features/image-gen/lib/image-models/adapters"
          );
          // 直接用 job.model 列（DB 已经存了），不从 taskId 反推 —— gpt_image_2
          // 等真实模型的 taskId 是 Lingting/Gemini 的 id，parseTaskModel 拿不到。
          const model = job.model as Parameters<
            typeof dispatchQueryImageTask
          >[0];
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
 * image-gen 工作台 —— 异步 submit 入口（/p/[token] 架构镜像）。
 *
 * 调用链路：
 *   generateImageAction Server Action
 *     → createImageJob（写 imageJob pending 行）
 *     → triggerImageGenSubmit（inngest.send + 同步 fallback）
 *   ↑↑↑ HTTP 路径到此结束，立刻返 jobId
 *
 *   Inngest 云端：
 *     submitImageGenJob → dispatchImageGenerationJob
 *     → dispatchGenerateImage → 更新 imageJob 到 processing/completed/failed
 *
 * 与 gpt-image submitGenerationJob 同语义：把"submit 撞 Vercel 函数预算"的
 * 风险从 HTTP 路径挪到 Inngest cloud。
 *
 * retries: 0 与 gpt-image 一致 —— Lingting 没有幂等键，重试会重复扣配额。
 */
export const submitImageGenJob = inngest.createFunction(
  {
    id: "image-gen-submit-job",
    retries: 0,
  },
  { event: "image-gen/submit-job" },
  async ({ event, step }) => {
    const { jobId, input } = event.data;
    await step.run("dispatch", async () => {
      logger.info({ jobId }, "Inngest: 开始 dispatchImageGenerationJob");
      const result = await dispatchImageGenerationJob({ jobId, input });
      logger.info(
        {
          jobId,
          status: result.status,
          taskId: result.taskId,
        },
        "Inngest: dispatchImageGenerationJob 完成"
      );
    });
  }
);

/**
 * 画布内置渠道 image / audio 异步生成入口。
 *
 * 调用链路：
 *   POST /api/canvas/generate (image / audio)
 *     → 写 canvasRemoteJob 行 (status=pending) + inngest.send
 *     → 立即返 202 + jobId
 *
 *   Inngest 云端：
 *     canvasRemoteGenerateJob → generateOnServerSync(payload)
 *     → **image / audio 不消耗积分**（产品决策 2026-08-20），video 在 createVideoOnServer 内 pre-consume
 *     → image edit（有 references + Lingting 已配）走 Lingting/WellAPI
 *       submitLingtingTask → 同步 url 立即落 R2 / taskId 轮询直到 done
 *     → 其他 image 场景（text-to-image / Lingting 未配）走 OpenAI SDK
 *       imageGeneration / imageEdit
 *     → audio 仍走 OpenAI SDK audioSpeech（TTS wellapi 没提供）
 *     → 所有结果 fetchToBuffer → R2 putObject → 返 items
 *     → 把 items / creditsConsumed (始终 0) / transactionId (始终 "") 写回 canvasRemoteJob
 *
 *   [失败]
 *     image / audio 不消耗积分 → 无 refund；video 路径 generateOnServerSync 仍负责 pre-consume + safeRefund
 *     本函数只负责把错误信息写到 canvasRemoteJob.error 字段
 *
 * 与 gpt-image submitGenerationJob / image-gen submitImageGenJob 同语义：
 * 把"submit 撞 Vercel 函数预算"的风险从 HTTP 路径挪到 Inngest cloud。
 *
 * retries: 0 —— 上游（Lingting / OpenAI）无幂等键，重试会重复扣积分（视频路径仍受影响）。
 *
 * 2026-08-20：image edit 路径改走 Lingting/WellAPI。原因：用户网络下
 * OpenAI SDK 直连撞 undici connectTimeout 10s × 3 ≈ 38s 抛
 * APIConnectionTimeoutError；Lingting 走 HTTPS multipart，connect 是
 * 一次握手后流式上传 + 后台轮询，不受该 timeout 链路影响（与
 * image-gen 工作台 gptImage2Adapter 同语义）。
 *
 * 2026-08-20：image / audio 路径取消积分扣减。内置渠道 = 用户带
 * key 平台代付，不扣用户积分；video 路径（OpenAI /v1/videos）保持
 * pre-consume + refund 不变。
 */
export const canvasRemoteGenerateJob = inngest.createFunction(
  {
    id: "canvas-remote-generate",
    retries: 0,
  },
  { event: "canvas/remote-generate" },
  async ({ event, step }) => {
    const { jobId, userId, payload } = event.data;
    await step.run("generate", async () => {
      logger.info(
        { jobId, userId, capability: payload.capability, mode: payload.mode },
        "Inngest: 开始画布内置渠道生成"
      );
      // 1. 标记 processing
      await db
        .update(canvasRemoteJob)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(canvasRemoteJob.id, jobId));

      try {
        // 2. 调 service —— image / audio 不消耗积分；video 路径内部仍 pre-consume + safeRefund
        const result = await generateOnServerSync({
          ...payload,
          userId,
        });
        // 3. 写回 result（image / audio：creditsConsumed=0、transactionId=""）
        await db
          .update(canvasRemoteJob)
          .set({
            status: "completed",
            result: result.items,
            creditsConsumed: result.creditsConsumed,
            transactionId: result.transactionId,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(canvasRemoteJob.id, jobId));
        logger.info(
          {
            jobId,
            capability: result.capability,
            itemCount: result.items.length,
            creditsConsumed: result.creditsConsumed,
          },
          "Inngest: 画布内置渠道生成完成"
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "未知错误";
        // 失败：image / audio 不消耗积分（无 refund）；video 路径 service 内部已 safeRefund
        await db
          .update(canvasRemoteJob)
          .set({
            status: "failed",
            error: message.slice(0, 1000),
            updatedAt: new Date(),
            completedAt: new Date(),
          })
          .where(eq(canvasRemoteJob.id, jobId));
        logger.error(
          { jobId, userId, err },
          "Inngest: 画布内置渠道生成失败（image/audio 不扣积分；video 已 refund）"
        );
        // 不 rethrow —— 失败已持久化，让前端轮询能拿到 failed 状态
        // 若 rethrow，Inngest 会记 run failed，但 canvasRemoteJob 行已经
        // 是 failed，前端轮询仍能正确处理；为简化监控日志，这里 swallow。
      }
    });
  }
);

/**
 * 画布内置渠道 Image-to-3D 异步执行（Meshy，2026-09-15）
 *
 * 调用链路：
 *   POST /api/canvas/meshy/create
 *     → createMeshyImageTo3DOnServer（预扣 200 credits + 创 Meshy 任务 + 写 job 行）
 *     → inngest.send("canvas/image-to-3d")
 *     → 立即返 { jobId, pollUrl }
 *
 *   Inngest 云端（本函数）：
 *     1. 读 canvasRemoteJob 行 → 拿 providerJobId（Meshy taskId）
 *     2. 标 processing
 *     3. 轮询 getImageTo3DTask 60 次 × 8s = 最多 8 分钟（Meshy 上限）：
 *        - SUCCEEDED → break
 *        - FAILED / CANCELED → throw（catch 内 safeRefund + DB failed）
 *        - PENDING / IN_PROGRESS → 继续 sleep + poll
 *        - 60 轮仍 PENDING/IN_PROGRESS → throw（catch 同上）
 *     4. fetch GLB（Meshy 临时签名 URL，约 1 天过期）→ R2 putObject → 永久 URL
 *     5. 写回 canvasRemoteJob: status=completed, result=[{url, storageKey, mimeType, bytes}]
 *
 *   [失败]
 *     safeRefund 全额退回 200 credits；DB 标 failed；不 rethrow
 *     （前端轮询能拿到 failed；Inngest run 失败日志仅供排查）
 *
 * retries: 0 —— Meshy taskId 不可幂等（重复触发会重复扣 Meshy 配额 + 重复
 * pre-consume）。任何重试都意味着用户被多扣 200 积分。
 *
 * 复用：
 *   - getImageTo3DTask: src/lib/meshy/client.ts
 *   - persistBufferToR2 / safeRefund: src/features/canvas/services/canvas-server-generate.ts
 */
export const canvasImageTo3DJob = inngest.createFunction(
  {
    id: "canvas-image-to-3d",
    retries: 0,
  },
  { event: "canvas/image-to-3d" },
  async ({ event, step }) => {
    const { jobId, userId } = event.data;

    await step.run("setup", async () => {
      logger.info(
        { jobId, userId },
        "Inngest: 开始画布 Image-to-3D 生成（Meshy）"
      );
      await db
        .update(canvasRemoteJob)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(canvasRemoteJob.id, jobId));
    });

    // 拿 providerJobId（Meshy taskId）—— 由 create*OnServer 阶段写入
    const providerJobId = await step.run("get-provider-job-id", async () => {
      const job = await db.query.canvasRemoteJob.findFirst({
        where: eq(canvasRemoteJob.id, jobId),
        columns: {
          providerJobId: true,
          transactionId: true,
          creditsConsumed: true,
        },
      });
      if (!job) throw new Error(`canvasRemoteJob 不存在：${jobId}`);
      if (!job.providerJobId) throw new Error(`providerJobId 缺失：${jobId}`);
      return {
        providerJobId: job.providerJobId,
        transactionId: job.transactionId ?? "",
        creditsConsumed: job.creditsConsumed ?? 0,
      };
    });

    try {
      // 60 轮 × 8s = 8 分钟上限（与 plan 对齐）
      const POLL_MAX = 60;
      const POLL_INTERVAL_S = "8s";
      let finalTask: {
        status?: string;
        model_urls?: { glb?: string };
        task_error?: { message?: string };
      } | null = null;

      for (let i = 0; i < POLL_MAX; i++) {
        await step.sleep(`poll-sleep-${i}`, POLL_INTERVAL_S);
        const polled = await step.run(`poll-check-${i}`, async () => {
          const { getImageTo3DTask } = await import("@/lib/meshy/client");
          return getImageTo3DTask(providerJobId.providerJobId);
        });
        if (polled.status === "SUCCEEDED") {
          finalTask = polled;
          break;
        }
        if (polled.status === "FAILED" || polled.status === "CANCELED") {
          const errObj = polled.task_error as { message?: unknown } | undefined;
          throw new Error(
            `Meshy ${polled.status}: ${errObj?.message ?? "未知错误"}`
          );
        }
        // PENDING / IN_PROGRESS：继续下一轮
      }

      if (!finalTask) {
        throw new Error("Meshy 任务超时（8 分钟未完成）");
      }

      // 落 GLB 到 R2
      const r2Item = await step.run("persist-glb-to-r2", async () => {
        const { persistBufferToR2 } = await import(
          "@/features/canvas/services/canvas-server-generate"
        );
        const glbUrl = finalTask!.model_urls?.glb;
        if (!glbUrl) {
          throw new Error("Meshy SUCCEEDED 但 model_urls.glb 为空");
        }
        const res = await fetch(glbUrl, {
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          throw new Error(`Meshy GLB 下载失败：HTTP ${res.status}`);
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        return persistBufferToR2(buffer, "model/gltf-binary", userId, "3d");
      });

      await step.run("write-result", async () => {
        await db
          .update(canvasRemoteJob)
          .set({
            status: "completed",
            result: [
              r2Item as {
                url: string;
                storageKey: string;
                mimeType: string;
                bytes: number;
              },
            ],
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(canvasRemoteJob.id, jobId));
        logger.info(
          { jobId, userId, r2Url: r2Item.url },
          "Inngest: Meshy Image-to-3D 完成，GLB 已落 R2"
        );
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "未知错误";
      // 失败：safeRefund + DB 标 failed + 不 rethrow
      try {
        const { safeRefund } = await import(
          "@/features/canvas/services/canvas-server-generate"
        );
        await safeRefund(
          userId,
          providerJobId.creditsConsumed,
          providerJobId.transactionId,
          "image-to-3d",
          message
        );
      } catch (refundErr) {
        logger.error(
          { err: refundErr, jobId, userId },
          "Inngest: Image-to-3D safeRefund 失败"
        );
      }
      try {
        await db
          .update(canvasRemoteJob)
          .set({
            status: "failed",
            error: message.slice(0, 1000),
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(canvasRemoteJob.id, jobId));
      } catch (dbErr) {
        logger.error(
          { err: dbErr, jobId },
          "Inngest: Image-to-3D 写 failed 状态失败"
        );
      }
      logger.error(
        { err, jobId, userId, message },
        "Inngest: Meshy Image-to-3D 失败（积分已自动回退）"
      );
      // 不 rethrow —— 失败已持久化，让前端轮询拿到 failed 状态
    }
  }
);

/**
 * 画布内置渠道 Multi-Image to 3D 后台执行（2026-09-16）
 *
 * 与 canvasImageTo3DJob 平行的多图版本 —— 2-4 张图合并生成单一 GLB。
 * capability='multi-image-to-3d'，credits 400（单图 2 倍）。
 *
 *   [成功]
 *     1. 读 canvasRemoteJob 行 → 拿 providerJobId + transactionId + creditsConsumed
 *     2. 轮询 GET /openapi/v1/multi-image-to-3d/:id（60 轮 × 8s = 8 分钟上限）
 *     3. SUCCEEDED → 取 model_urls.glb
 *     4. fetch GLB（Meshy 临时签名 URL，约 1 天过期）→ R2 putObject → 永久 URL
 *     5. 写回 canvasRemoteJob: status=completed, result=[{url, storageKey, mimeType, bytes}]
 *
 *   [失败]
 *     safeRefund 全额退回 400 credits；DB 标 failed；不 rethrow
 *     （前端轮询能拿到 failed；Inngest run 失败日志仅供排查）
 *
 * retries: 0 —— Meshy taskId 不可幂等（重复触发会重复扣 Meshy 配额 + 重复
 * pre-consume）。任何重试都意味着用户被多扣 400 积分。
 *
 * step 命名优化：
 *   - 单图函数（canvasImageTo3DJob）每轮一个独立 step.sleep/poll-check，
 *     60 轮 = 120 个唯一 step 名。Inngest 函数 step 配额紧张。
 *   - 多图函数**复用** 6 个分组 sleep 名（每组 10 轮 × 8s = 80s）+ 1 个
 *     共享 step.run 名 → 总 step 数从 ~120 降到 ~8，避免配额风险。
 *
 * 复用：
 *   - getMultiImageTo3DTask: src/lib/meshy/client.ts
 *   - persistBufferToR2 / safeRefund: src/features/canvas/services/canvas-server-generate.ts
 */
export const canvasMultiImageTo3DJob = inngest.createFunction(
  {
    id: "canvas-multi-image-to-3d",
    retries: 0,
  },
  { event: "canvas/multi-image-to-3d" },
  async ({ event, step }) => {
    const { jobId, userId } = event.data;

    await step.run("setup", async () => {
      logger.info(
        { jobId, userId },
        "Inngest: 开始画布 Multi-Image to 3D 生成（Meshy）"
      );
      await db
        .update(canvasRemoteJob)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(canvasRemoteJob.id, jobId));
    });

    // 拿 providerJobId（Meshy taskId）—— 由 create*OnServer 阶段写入
    const providerJobId = await step.run("get-provider-job-id", async () => {
      const job = await db.query.canvasRemoteJob.findFirst({
        where: eq(canvasRemoteJob.id, jobId),
        columns: {
          providerJobId: true,
          transactionId: true,
          creditsConsumed: true,
        },
      });
      if (!job) throw new Error(`canvasRemoteJob 不存在：${jobId}`);
      if (!job.providerJobId) throw new Error(`providerJobId 缺失：${jobId}`);
      return {
        providerJobId: job.providerJobId,
        transactionId: job.transactionId ?? "",
        creditsConsumed: job.creditsConsumed ?? 0,
      };
    });

    try {
      // 60 轮 × 8s = 8 分钟上限（与单图一致 —— Meshy multi-image p95 ~5min）
      //
      // step 命名优化：用 6 个分组 sleep 名（每组 10 轮）+ 1 个共享 poll-check
      // run 名 → 总 ~8 个 step（vs 单图 60 + 60 = 120 个）。Inngest step 配额
      // 友好，调试面板更清晰。
      const POLL_MAX = 60;
      const POLL_INTERVAL_S = "8s";
      const POLLS_PER_GROUP = 10; // 10 × 8s = 80s/组
      const POLL_GROUPS = Math.ceil(POLL_MAX / POLLS_PER_GROUP);
      let finalTask: {
        status?: string;
        model_urls?: { glb?: string };
        task_error?: { message?: string };
      } | null = null;

      for (let g = 0; g < POLL_GROUPS; g++) {
        const groupEnd = Math.min(
          POLLS_PER_GROUP,
          POLL_MAX - g * POLLS_PER_GROUP
        );
        for (let i = 0; i < groupEnd; i++) {
          await step.sleep(`poll-group-${g}`, POLL_INTERVAL_S);
          const polled = await step.run("poll-check", async () => {
            const { getMultiImageTo3DTask } = await import(
              "@/lib/meshy/client"
            );
            return getMultiImageTo3DTask(providerJobId.providerJobId);
          });
          if (polled.status === "SUCCEEDED") {
            finalTask = polled;
            break;
          }
          if (polled.status === "FAILED" || polled.status === "CANCELED") {
            const errObj = polled.task_error as
              | { message?: unknown }
              | undefined;
            throw new Error(
              `Meshy ${polled.status}: ${errObj?.message ?? "未知错误"}`
            );
          }
          // PENDING / IN_PROGRESS：继续下一轮
        }
        if (finalTask) break;
      }

      if (!finalTask) {
        throw new Error("Meshy Multi-Image 任务超时（8 分钟未完成）");
      }

      // 落 GLB 到 R2
      const r2Item = await step.run("persist-glb-to-r2", async () => {
        const { persistBufferToR2 } = await import(
          "@/features/canvas/services/canvas-server-generate"
        );
        const glbUrl = finalTask!.model_urls?.glb;
        if (!glbUrl) {
          throw new Error("Meshy SUCCEEDED 但 model_urls.glb 为空");
        }
        const res = await fetch(glbUrl, {
          signal: AbortSignal.timeout(120_000),
        });
        if (!res.ok) {
          throw new Error(`Meshy GLB 下载失败：HTTP ${res.status}`);
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        return persistBufferToR2(buffer, "model/gltf-binary", userId, "3d");
      });

      await step.run("write-result", async () => {
        await db
          .update(canvasRemoteJob)
          .set({
            status: "completed",
            result: [
              r2Item as {
                url: string;
                storageKey: string;
                mimeType: string;
                bytes: number;
              },
            ],
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(canvasRemoteJob.id, jobId));
        logger.info(
          { jobId, userId, r2Url: r2Item.url },
          "Inngest: Meshy Multi-Image to 3D 完成，GLB 已落 R2"
        );
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "未知错误";
      // 失败：safeRefund + DB 标 failed + 不 rethrow
      try {
        const { safeRefund } = await import(
          "@/features/canvas/services/canvas-server-generate"
        );
        await safeRefund(
          userId,
          providerJobId.creditsConsumed,
          providerJobId.transactionId,
          "multi-image-to-3d",
          message
        );
      } catch (refundErr) {
        logger.error(
          { err: refundErr, jobId, userId },
          "Inngest: Multi-Image to 3D safeRefund 失败"
        );
      }
      try {
        await db
          .update(canvasRemoteJob)
          .set({
            status: "failed",
            error: message.slice(0, 1000),
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(canvasRemoteJob.id, jobId));
      } catch (dbErr) {
        logger.error(
          { err: dbErr, jobId },
          "Inngest: Multi-Image to 3D 写 failed 状态失败"
        );
      }
      logger.error(
        { err, jobId, userId, message },
        "Inngest: Meshy Multi-Image to 3D 失败（积分已自动回退）"
      );
      // 不 rethrow —— 失败已持久化，让前端轮询拿到 failed 状态
    }
  }
);

/**
 * 画布内置渠道（image / audio / video）—— 兜底 reconcile cron。
 *
 * 与 reconcileStaleJobs（image-gen 工作台）同语义：
 * - canvasRemoteGenerateJob 走 Inngest send + 前端轮询路径
 * - 如果 inngest.send 失败但 HTTP 路径已成功返回 jobId，DB 行永远卡 pending
 * - 如果 Inngest 函数本身 step.run 抛错但 catch 没写 status，也卡 processing
 * - 前端 `image-workbench.tsx:351-358` 的 catch 不写 results 是个独立 bug，
 *   但即便前端修了，DB 状态不更新 /poll 就拿不到 completed，UI 仍卡"生成中"
 *
 * 因此必须有一个独立于前端的兜底把 stale 行标 failed，否则：
 * - 用户下次打开工作台看到一堆 orphan pending 行
 * - 长期占用 DB + 影响看板统计
 *
 * 行为：
 * 1. 找 pending 超过 STALE_PENDING_MS（10 min）+ processing 超过 STALE_PROCESSING_MS（15 min）
 *    的行。pending 卡死几乎一定是 Inngest 事件没被云端收到；processing 卡死
 *    是 step.run 内吞了错或 Inngest 函数本身崩溃
 * 2. 单条 UPDATE 标 failed，不查上游（与 reconcileStaleJobs 对齐）
 * 3. 不 refund 积分：image / audio 路径不消耗积分（见 canvasRemoteGenerateJob 注释
 *    + canvas-server-generate.ts:596-598），video 路径 service 内部已 safeRefund
 *
 * 频率：每 5 分钟一次（cron "slash 5 * * * *"，与 reconcileStaleJobs 对齐）。
 * Vercel Hobby 计划只支持每天一次 cron，所以这条路径在 Hobby 下不会被自动触发；
 * 正式环境走 Pro + 改 vercel.json，或外部 cron-job.org 每 5 分钟 POST 注册的 endpoint。
 */
export const reconcileCanvasRemoteJobs = inngest.createFunction(
  {
    id: "canvas-remote-reconcile-stale-jobs",
    retries: 1,
  },
  { cron: "*/5 * * * *" },
  async ({ step }) => {
    const STALE_PENDING_MS = 10 * 60_000;
    const STALE_PROCESSING_MS = 15 * 60_000;
    const BATCH = 30;
    const now = new Date();

    const stuckPending = await step.run("find-stale-pending", async () =>
      db.query.canvasRemoteJob.findMany({
        where: and(
          eq(canvasRemoteJob.status, "pending"),
          lt(
            canvasRemoteJob.createdAt,
            new Date(now.getTime() - STALE_PENDING_MS)
          )
        ),
        columns: { id: true, userId: true, capability: true, createdAt: true },
        limit: BATCH,
        orderBy: (j, { asc }) => [asc(j.createdAt)],
      })
    );

    const stuckProcessing = await step.run("find-stale-processing", async () =>
      db.query.canvasRemoteJob.findMany({
        where: and(
          eq(canvasRemoteJob.status, "processing"),
          lt(
            canvasRemoteJob.updatedAt,
            new Date(now.getTime() - STALE_PROCESSING_MS)
          )
        ),
        columns: { id: true, userId: true, capability: true, updatedAt: true },
        limit: BATCH,
        orderBy: (j, { asc }) => [asc(j.updatedAt)],
      })
    );

    const markFailed = async (
      rows: Array<{
        id?: string | null;
        userId?: string | null;
        capability?: string | null;
      }>,
      reason: string
    ) => {
      if (rows.length === 0) return 0;
      let count = 0;
      for (const row of rows) {
        if (!row.id) continue;
        const jobId = row.id;
        try {
          await db
            .update(canvasRemoteJob)
            .set({
              status: "failed",
              error: reason.slice(0, 1000),
              completedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(canvasRemoteJob.id, jobId));
          count++;
          logger.warn(
            {
              jobId,
              userId: row.userId ?? undefined,
              capability: row.capability ?? undefined,
            },
            `reconcile: canvasRemoteJob 标 failed (${reason})`
          );
        } catch (err) {
          logger.error({ err, jobId }, "reconcile: 单条 update 失败");
        }
      }
      return count;
    };

    const pendingCleaned = await markFailed(
      stuckPending,
      "任务提交超时未启动，请重新生成"
    );
    const processingCleaned = await markFailed(
      stuckProcessing,
      "生成任务已超时未返回结果，请重新生成"
    );

    return {
      pendingCleaned,
      processingCleaned,
      timestamp: now.toISOString(),
    };
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
 *
 * 2026-08-17 引入 submitImageGenJob：把工作台的 generateImageAction 也
 * 改成 Inngest send → 202 异步 submit，与 /p/[token] /upload 路由的
 * triggerSubmit 模式对齐。
 *
 * 2026-08-20 引入 canvasRemoteGenerateJob：/api/canvas/generate 的
 * image/audio 同步阻塞（gpt-image-2 单图 30-90s）撞 Vercel maxDuration，
 * 改为 Inngest 异步 send + 前端轮询 /api/canvas/poll/[jobId]。
 *
 * 2026-08-22 引入 reconcileCanvasRemoteJobs：画布内置渠道没有 V1 那样的
 * 服务端轮询驱动，纯靠前端 image-workbench.tsx 的 pollRemoteImageJob。
 * 前端 catch 不写 results（[image-workbench.tsx:351-358]）+ Inngest send 失
 * 败但 HTTP 已返 202 + step.run 内部吞错 等场景下，没有兜底就把行永远卡住。
 * 5 分钟 cron 把 stale 行标 failed，与 reconcileStaleJobs 同语义。
 */
export const functions = [
  helloWorld,
  submitGenerationJob,
  submitPreviewGenerationJob,
  reconcileStaleJobs,
  submitImageGenJob,
  canvasRemoteGenerateJob,
  canvasImageTo3DJob,
  canvasMultiImageTo3DJob,
  reconcileCanvasRemoteJobs,
];
