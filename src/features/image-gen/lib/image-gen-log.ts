// image-gen 生图埋点日志
// 输出结构化日志，serverless 友好：无文件、无外部依赖、无状态
// 统一前缀 "IMAGE_GEN"，便于日志检索

import { logError, logger } from "@/lib/logger";
import type {
  GenerateImageRequest,
  GenerateImageResult,
  ImageModelId,
} from "./image-models/types";

// 一条生图埋点记录
export interface ImageGenLogEntry {
  /** 事件类型：submit（提交生图）| query（异步任务轮询） */
  event: "submit" | "query";
  /** 成功或失败 */
  outcome: "success" | "failed";
  /** 生图模型 id */
  model: ImageModelId | string;
  /** 入口：internal（登录用户）| public（外部用户） */
  source: "internal" | "public";
  /** 生成模式 */
  mode?: string | undefined;
  /** 是否带参考图 */
  hasRefImage?: boolean | undefined;
  /** 产品效果 maskId（若通过模版生图） */
  maskId?: string | undefined;
  /** 尺寸 */
  size?: string | undefined;
  /** 批量数 */
  batchSize?: number | undefined;
  /** 服务端耗时（ms） */
  durationMs?: number | undefined;
  /** 异步任务 id */
  taskId?: string | undefined;
  /** 任务最终状态 */
  taskStatus?: string | undefined;
  /** 产出图片数量 */
  imageCount?: number | undefined;
  /** 失败时的错误码 */
  errorCode?: string | undefined;
  /** 失败时的错误信息 */
  errorMessage?: string | undefined;
  /** 上游 HTTP 状态码（若有） */
  upstreamStatus?: number | undefined;
  /** 请求来源 IP */
  ip?: string | undefined;
  /** 时间戳 ISO */
  timestamp: string;
}

// 统一埋点输出：带固定前缀便于检索
export function logImageGen(entry: Omit<ImageGenLogEntry, "timestamp">): void {
  const record: ImageGenLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };
  if (entry.outcome === "failed") {
    logError(
      new Error(`IMAGE_GEN ${entry.event} failed`),
      record as unknown as Record<string, unknown>
    );
    return;
  }
  logger.info(
    record as unknown as Record<string, unknown>,
    `IMAGE_GEN ${entry.event}`
  );
}

// 提交生图请求时，从请求体提取公共字段
export function extractSubmitContext(
  req: GenerateImageRequest,
  source: "internal" | "public"
) {
  return {
    event: "submit" as const,
    source,
    model: req.model,
    mode: req.mode,
    hasRefImage: !!req.imageUrl,
    maskId: req.maskId,
    size: req.size,
    batchSize: req.batchSize,
  };
}

// 从结果提取 outcome / 附加字段
export function buildResultFields(result: GenerateImageResult): {
  outcome: "success" | "failed";
  taskId?: string | undefined;
  taskStatus?: string | undefined;
  imageCount?: number | undefined;
  durationMs?: number | undefined;
  errorMessage?: string | undefined;
} {
  const outcome = result.success ? "success" : "failed";
  return {
    outcome,
    taskId: result.taskId,
    taskStatus: result.status,
    imageCount: result.images?.length,
    durationMs: result.duration,
    errorMessage: result.success ? undefined : result.error,
  };
}

// 从请求头提取客户端 IP
// 经过 Cloudflare 代理时优先读 CF-Connecting-IP（单个真实用户 IP，最可靠）；
// 否则回退到 x-forwarded-for / x-real-ip。
export function getClientIp(headers: Headers): string | undefined {
  return (
    headers.get("cf-connecting-ip") ||
    headers.get("true-client-ip") ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    undefined
  );
}
