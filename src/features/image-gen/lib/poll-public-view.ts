/**
 * image-gen 外部轮询响应投影(纯函数)。
 *
 * 2026-10-14：原 /api/image-gen/jobs/[jobId]/poll 直接序列化 imageJob 全行
 * 泄露给 x-api-key 客户端 —— 包括上游 provider 名称 + error 结构 +
 * apimart request_id(可用于假装客服 / 上游 trace 撞码)、业务提示词原文、
 * 用户上传图 R2 URL(可能带签名)、内部模型 id、成本 / 积分消耗等。
 *
 * 违反 §"响应只返回图片 URL + 友好消息全友好回显,不暴露内部 model /
 * 提示词 / 成本等"。
 *
 * 设计:
 *   - **owner 路径**(BA session,userId === session.user.id)返回全行——
 *     workbench UI 用的就是原 shape,0 回归。客户端是这条 job 的拥有者,
 *     看自己的调试细节合理。
 *   - **external 路径**(x-api-key,匿名 userId IS NULL 的 job)投影到
 *     SDK 实际消费的字段 + UX 必需字段,errorMessage 走
 *     sanitizeExternalFailureMessage 把上游指纹脱敏。
 *
 * 后续若要做结构化错误分类:在 imageJob.errorCode 列加 worker 专属字段 +
 * 一份文案映射表,这里直接 lookup。当前 errorMsg 是自由文本,
 * 靠 sanitizeExternalFailureMessage 把上游 JSON / keyword 去掉。
 */
import type { imageJob } from "@/db/schema";

export type ImageJobRow = typeof imageJob.$inferSelect;

export type PublicJobView = {
  id: string;
  status: ImageJobRow["status"];
  resultUrls: string[];
  mode: ImageJobRow["mode"];
  size: string;
  batchSize: number;
  generateDuration: number | null;
  completedAt: Date | null;
  /** 失败时给客户端的友好错误,从不包含 request_id / apimart / JSON 等内部指纹 */
  errorMessage: string | null;
};

export const EXTERNAL_GENERIC_FAILURE_MESSAGE =
  "生成失败,请稍后重试或联系客服";
export const EXTERNAL_EMPTY_FAILURE_MESSAGE = "生成失败,请稍后重试";

export function toPublicJobView(job: ImageJobRow): PublicJobView {
  return {
    id: job.id,
    status: job.status,
    resultUrls: job.status === "completed" ? job.resultUrls : [],
    mode: job.mode,
    size: job.size,
    batchSize: job.batchSize,
    generateDuration: job.generateDuration,
    completedAt: job.completedAt,
    errorMessage:
      job.status === "failed"
        ? sanitizeExternalFailureMessage(job.errorMsg)
        : null,
  };
}

/**
 * 把 imageJob.errorMsg 中的上游指纹脱敏成客户端可读文案。
 *
 * 检测规则:若原文包含 JSON 对象(以 `{` 开头)或上游关键字 `apimart` /
 * `request_id` / `build_request_failed` / `submit NNN` HTTP 状态码,
 * 一律替换为通用友好文案;否则保留原 message(可能是「积分不足」之类
 * 业务文案,这种是设计上有意给用户看的)。
 *
 * 原始 errorMsg 仍由 logImageGen 在 submit / query 路径上落地(参
 * generation-service.ts:289, 327, 452),便于运维排查 —— 本函数只管
 * 「出」防线的东西,不丢上下文。
 */
export function sanitizeExternalFailureMessage(
  raw: string | null | undefined,
): string {
  if (!raw) return EXTERNAL_EMPTY_FAILURE_MESSAGE;
  const trimmed = raw.trim();
  // 全空白也算空(防御上游写 "  " 进 errorMsg)
  if (!trimmed) return EXTERNAL_EMPTY_FAILURE_MESSAGE;
  if (
    trimmed.startsWith("{") ||
    /apimart|request_id|build_request_failed|submit\s+\d{3}/i.test(trimmed)
  ) {
    return EXTERNAL_GENERIC_FAILURE_MESSAGE;
  }
  return trimmed;
}