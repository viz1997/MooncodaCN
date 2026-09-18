/**
 * 小程序 SDK —— AI 生图
 *
 * 核心流:
 *   1. listTemplates()             → 拿可选产品线 + 模板(用作 maskId 下拉)
 *   2. submitGenerate({ maskId, imageUrls, ... })
 *                                  → 返 taskId
 *   3. pollImageTask(taskId)       → 轮询直到 status=completed/failed
 *   4. (已登录用户)listPhotos()    → 我的资产列表
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
  return sdkRequest<PublicGenerateResponse>("/api/public/generate", {
    method: "POST",
    json: payload,
    timeoutMs: 120_000, // 服务端 maxDuration=120s
  });
}

/**
 * 轮询生图任务状态(免登录,无 Bearer 需求)
 *
 * 推荐轮询策略(递减间隔,cold start 长 → 接近完成短):
 *   [15s, 12s, 10s, 8s, 6s, 5s, 4s, 3s]
 */
export async function pollImageTask(
  taskId: string,
  options?: { signal?: AbortSignal }
): Promise<ImageTaskStatusResponse> {
  return sdkRequest<ImageTaskStatusResponse>(
    `/api/image/task/${encodeURIComponent(taskId)}`,
    {
      method: "GET",
      signal: options?.signal,
      timeoutMs: 30_000,
    }
  );
}

/**
 * 列产品线 + 模板(需 Bearer,已登录用户)
 *
 * 用法:进入生图页时拉一次,用作 maskId 下拉 / 产品线 Tab
 */
export async function listTemplates(): Promise<PromptTemplatesResponse> {
  return sdkRequest<PromptTemplatesResponse>(
    "/api/image-gen/prompt-templates",
    {
      method: "GET",
      timeoutMs: 30_000,
    }
  );
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
