/**
 * image-gen 工作台 —— submit 触发器。
 *
 * 与 gpt-image /api/orders/[token]/upload 路由里的 triggerSubmit 同形态：
 *   1. 先 try inngest.send —— 成功立刻返 { mode: "ingest" }
 *   2. send 失败（dev server 没启 / INNGEST_EVENT_KEY 没配）→
 *      同步跑 dispatchImageGenerationJob 兜底，返 { mode: "sync" }
 *
 * 调用方拿到 mode 仅用于诊断/打日志，不依赖其行为 —— 两种 mode 下
 * imageJob 行最终都会被推进到终态，区别只是"在 Inngest cloud"还是"在这
 * 个 HTTP 请求周期内"完成 dispatch。
 */

import { inngest } from "@/inngest/client";
import { logger } from "@/lib/logger";

import { dispatchImageGenerationJob } from "./generation-service";
import type { InternalGenerateInput } from "./validation";

export type SubmitMode = "ingest" | "sync";

/**
 * 触发一次 image-gen 生图 submit。
 *
 * @param jobId   createImageJob 已经写库的 imageJob.id
 * @param input   原始 InternalGenerateInput（enableSafetyCheck/watermark 等
 *                imageJob 没存的字段靠它传给 Inngest 函数）
 */
export async function triggerImageGenSubmit(
  jobId: string,
  input: InternalGenerateInput
): Promise<{ mode: SubmitMode }> {
  try {
    await inngest.send({
      name: "image-gen/submit-job",
      data: { jobId, input },
    });
    return { mode: "ingest" };
  } catch (err) {
    logger.warn(
      { err, jobId },
      "Inngest send 失败，降级到同步 dispatchImageGenerationJob（未配 INNGEST_EVENT_KEY 或 dev server 未启动？）"
    );
    await dispatchImageGenerationJob({ jobId, input });
    return { mode: "sync" };
  }
}
