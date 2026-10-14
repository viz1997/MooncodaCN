/**
 * 小程序 SDK —— AI 生图
 *
 * 2026-10-13 v2.1: 端点路径统一迁到 /api/image-gen/**(原 /api/public/**
 * 已 410 Gone)。所有鉴权 / 限流 / 响应 shape 跟原路径完全一致,只换前缀。
 *
 * 核心流:
 *   1. listTemplates()             → 拿可选产品线 + 模板(用作 maskId 下拉)
 *   2. submitGenerate({ maskId, imageUrls, ... })
 *                                  → 返 taskId
 *   3. pollImageTask(taskId)       → 轮询直到 status=completed/failed
 *   4. (已登录用户)listPhotos()    → 我的资产列表
 *   5. getQuota()                  → 外部 API Key 月调用上限(非 credits 余额)
 *
 * 注意:
 *  - taskId 不可猜测(128-bit 熵),免登录轮询安全
 *  - 轮询建议 1-2s 间隔,30s 后服务端 maxDuration 会砍
 *  - 已登录用户提交会自动入库 photo(source=generation);
 *    匿名走公共流不写库(向后兼容)
 */

import { sdkRequest } from "./request";
import type {
  ImageTaskStatusResponse,
  PhotosListResponse,
  PromptTemplatesResponse,
  PublicGenerateRequest,
  PublicGenerateResponse,
  QuotaResponse,
} from "./types";

/**
 * 提交生图任务
 *
 * 必传:imageUrls(至少 1 张 R2 URL,先调 publicUpload 拿到)
 * 选填:maskId(关联模板,从 listTemplates 拿)、prompt(自定义追加)、size、count、model
 */
export async function submitGenerate(
  payload: PublicGenerateRequest
): Promise<PublicGenerateResponse> {
  return sdkRequest<PublicGenerateResponse>("/api/image-gen/submit", {
    method: "POST",
    json: payload,
    timeoutMs: 120_000, // 服务端 maxDuration=10s 但 mp 给 Inngest 完成时间留 buffer
  });
}

/**
 * 轮询生图任务状态(免登录,无 Bearer 需求)
 *
 * v2.1 起调 /api/image-gen/jobs/[jobId]/poll(原 /api/image/task/[id])。
 * 端点内部走 advanceImageGenJob,已支持 imageJob.id 直接读 DB,
 * 不再调上游 apimart(由 Inngest 在后台推进)。
 *
 * 推荐轮询策略(递减间隔,cold start 长 → 接近完成短):
 *   [15s, 12s, 10s, 8s, 6s, 5s, 4s, 3s]
 *
 * 鉴权语义:端点支持双鉴权(BA session OR x-api-key)。
 * mp 走 x-api-key 分支,工作台走 BA session 分支,SDK 调用方不需要传
 * Authorization 头 —— sdkRequest 会根据 setSdkApiKey() 自动注入。
 */
export async function pollImageTask(
  taskId: string,
  options?: { signal?: AbortSignal }
): Promise<ImageTaskStatusResponse> {
  // 新端点返 { success, data: { job: <projection | imageJob row> } };映射到 SDK
  // 老的 ImageTaskStatusResponse 契约(只暴露 status / candidates / error)
  // 避免 mp 端改业务代码。
  //
  // 2026-10-14:外部路径(x-api-key,匿名 jobId)服务端走 toPublicJobView 投影,
  // 字段名 errorMessage(已 sanitize),不再有 errorMsg。
  // 工作台 owner 路径仍走 imageJob 全行(零回归),errorMsg 仍在。SDK 两边
  // 都兼容,优先读 errorMessage(投影),fallback 到 errorMsg(全行)。
  const raw = await sdkRequest<{
    success: boolean;
    data?: {
      job?: {
        id: string;
        status: "pending" | "processing" | "completed" | "failed";
        resultUrls: string[] | null;
        generateDuration: number | null;
        /** 外部投影专用字段,服务端已脱敏上游 fingerprint */
        errorMessage?: string | null;
        /** 全行路径(工作台)字段,2026-10-14 前所有响应都走这里 */
        errorMsg?: string | null;
        completedAt: string | Date | null;
      };
    };
  }>(`/api/image-gen/jobs/${encodeURIComponent(taskId)}/poll`, {
    method: "POST",
    signal: options?.signal,
    timeoutMs: 30_000,
  });

  const job = raw.data?.job;
  if (!job) {
    return { status: "failed", candidates: [], errorMessage: "任务不存在" };
  }
  // exactOptionalPropertyTypes 下 optional 与 undefined 不同;只在该字段真
  // 存在时加进对象(直接 ?? undefined 会因为类型 'string | undefined'
  // 不 assignable to 'string' 报错)。
  const completedAtIso =
    job.completedAt instanceof Date
      ? job.completedAt.toISOString()
      : (job.completedAt ?? null);
  const errMsg = job.errorMessage ?? job.errorMsg ?? null;
  return {
    status: job.status,
    candidates: job.resultUrls ?? [],
    ...(errMsg && { errorMessage: errMsg }),
    ...(job.generateDuration !== null && {
      durationMs: job.generateDuration,
    }),
    ...(completedAtIso && { finishedAt: completedAtIso }),
  };
}

/**
 * 查询外部 API Key 配额(走 x-api-key,登录态无关)
 *
 * v2.1 起调 /api/image-gen/quota(原 /api/public/quota)。语义是「外部
 * API Key 的月调用上限」,不是登录用户的 credits 余额——两个是不同的
 * 概念,前端展示时记得区分。
 *
 * 用法:进入生图页时拉一次,显示"本月剩余 N 次"提示;生成失败时也可以
 * 再次拉一下,确认是不是配额超了(429 quota_exceeded)。
 */
export async function getQuota(): Promise<QuotaResponse> {
  return sdkRequest<QuotaResponse>("/api/image-gen/quota", {
    method: "GET",
    timeoutMs: 10_000,
  });
}

/**
 * 列产品线 + 模板(走 x-api-key,小程序/第三方集成用)
 *
 * v2.1 起调 /api/image-gen/templates(原 /api/public/prompt-templates)。
 *
 * 用法:进入生图页时拉一次,用作 maskId 下拉 / 产品线 Tab
 */
export async function listTemplates(): Promise<PromptTemplatesResponse> {
  return sdkRequest<PromptTemplatesResponse>("/api/image-gen/templates", {
    method: "GET",
    timeoutMs: 30_000,
  });
}

/**
 * 列我的资产(需 Bearer)
 *
 * @param params.cursor - 上一页 nextCursor(可选)
 * @param params.source - 过滤 "upload" | "generation"
 * @param params.limit  - 默认 30
 */
export async function listPhotos(params?: {
  cursor?: string;
  source?: "upload" | "generation";
  limit?: number;
}): Promise<PhotosListResponse> {
  return sdkRequest<PhotosListResponse>("/api/image-gen/photos/list", {
    method: "GET",
    query: {
      cursor: params?.cursor,
      source: params?.source,
      limit: params?.limit ?? 30,
    },
    timeoutMs: 30_000,
  });
}

/** 便利函数:把内生图外链 URL 转成走代理的展示 URL(避免 R2 CORS) */
export function proxyImageUrl(url: string): string {
  // 在小程序内嵌 H5 / canvas 用图必走代理
  return `/api/image-gen/thumbnail?url=${encodeURIComponent(url)}`;
}
