/**
 * Meshy API 客户端 —— Image-to-3D + Multi-Image to 3D 任务（2026-09-15 / 2026-09-16）
 *
 * 封装 Meshy OpenAPI 两个相关端点的创建、查询、删除。Meshy 是付费 3D 生成服务
 * （mesh.ai / api.meshy.cn），官方文档：
 *
 *   POST /openapi/v1/image-to-3d          单图转 3D
 *   GET  /openapi/v1/image-to-3d/:id      单图查询
 *   DELETE /openapi/v1/image-to-3d/:id    单图删除
 *
 *   POST /openapi/v1/multi-image-to-3d    多图（1-4 张）转 3D
 *   GET  /openapi/v1/multi-image-to-3d/:id 多图查询
 *   DELETE /openapi/v1/multi-image-to-3d/:id 多图删除
 *
 * 任务返回 model_urls.glb（GLB 二进制）+ model_urls.fbx（可选 FBX）。
 *
 * 设计要点：
 * - 单一职责：只做 HTTP 封装 + 类型 + 错误。业务层（积分扣减、状态机、
 *   R2 持久化）写在 src/features/canvas/services/{meshy-image-to-3d,meshy-multi-image-to-3d}.ts
 * - 无副作用：每次调用都发起实际 HTTP，调用方按业务节奏决定频率
 * - 错误分桶：401/402/429/5xx 各自抛特定错误类，便于业务层 catch 后
 *   走不同的 refund / 重试策略
 * - 环境变量缺失时 `isMeshyConfigured()` 返 false，业务层在 create 阶段
 *   直接拒，不让请求发出去
 *
 * 不做的事：
 * - 不读 DB（业务层处理）
 * - 不写 DB（业务层处理）
 * - 不调 Inngest（业务层处理）
 * - 不扣积分（业务层处理）
 *
 * 关联：src/lib/ai/openai.ts / src/features/gpt-image/lib/generation-service.ts
 * 是同形态的 HTTP 客户端。
 */

import type {
  MeshyImageTo3DOptions,
  MeshyImageTo3DTask,
  MeshyMultiImageTo3DOptions,
  MeshyTaskStatus,
} from "./types";

// ───────────────────────────────────────────────────────────────────────────
// 错误类
// ───────────────────────────────────────────────────────────────────────────

export class MeshyAuthError extends Error {
  constructor(message = "MESHY_API_KEY 无效或缺失") {
    super(message);
    this.name = "MeshyAuthError";
  }
}

export class MeshyInsufficientCreditsError extends Error {
  constructor(message = "Meshy 账户余额不足") {
    super(message);
    this.name = "MeshyInsufficientCreditsError";
  }
}

export class MeshyRateLimitError extends Error {
  constructor(message = "Meshy API 触发限流（429）") {
    super(message);
    this.name = "MeshyRateLimitError";
  }
}

export class MeshyUpstreamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`Meshy API ${status}：${message}`);
    this.name = "MeshyUpstreamError";
    this.status = status;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 环境配置
// ───────────────────────────────────────────────────────────────────────────

const MESHY_BASE_URL = (
  process.env.MESHY_BASE_URL ?? "https://api.meshy.cn"
).replace(/\/+$/, "");
const MESHY_API_KEY = process.env.MESHY_API_KEY;

/**
 * Meshy 是否配置完成。
 *
 * 与 isR2Configured 同语义：业务层先调这个再发请求，避免 undefined API key
 * 进 fetch header 导致 401 噪音。
 */
export function isMeshyConfigured(): boolean {
  return Boolean(MESHY_API_KEY);
}

// ───────────────────────────────────────────────────────────────────────────
// 内部工具
// ───────────────────────────────────────────────────────────────────────────

/**
 * 把已知错误的 HTTP status 翻译成具体错误类。401 单独抛以便上层做
 * "credentials_invalid" 分支；402 翻译成余额不足便于用户友好提示。
 */
async function throwForStatus(res: Response, context: string): Promise<never> {
  const text = await res.text().catch(() => "");
  if (res.status === 401) {
    throw new MeshyAuthError(`MESHY_API_KEY 鉴权失败（${context}）`);
  }
  if (res.status === 402) {
    throw new MeshyInsufficientCreditsError(
      `Meshy 账户余额不足（${context}）：${text.slice(0, 200)}`
    );
  }
  if (res.status === 429) {
    throw new MeshyRateLimitError(
      `Meshy 限流（${context}）：${text.slice(0, 200)}`
    );
  }
  // 5xx 上游错误：保留原文便于排查（前 300 字符）
  throw new MeshyUpstreamError(res.status, `${context}：${text.slice(0, 300)}`);
}

/**
 * 通用 fetch wrapper —— 自动塞 Authorization、超时、错误分桶。
 *
 * 超时：单次 60s。Meshy image-to-3d 创建任务本身 < 5s 返回，
 * 查询是只读 GET 也很快，60s 给上游冷启动留余量。
 */
async function meshyFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  if (!isMeshyConfigured()) {
    throw new MeshyAuthError(
      "MESHY_API_KEY 未配置，无法调用 Meshy API（请在 .env.local 设置）"
    );
  }
  const url = `${MESHY_BASE_URL}${path}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${MESHY_API_KEY}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(60_000),
  });
}

// ───────────────────────────────────────────────────────────────────────────
// 对外 API
// ───────────────────────────────────────────────────────────────────────────

/**
 * 创建 Image-to-3D 任务。
 *
 * Meshy 文档：POST /openapi/v1/image-to-3d，body 至少含 image_url；
 * ai_model / topology / target_polycount / enable_pbr 等参数透传。
 *
 * @returns Meshy task id（后续轮询 / 取消都用）
 */
export async function createImageTo3DTask(input: {
  imageUrl: string;
  options?: MeshyImageTo3DOptions;
}): Promise<string> {
  const body = {
    image_url: input.imageUrl,
    // 默认值：Meshy 文档推荐 meshy-4-turbo + smart-topology 平衡速度/质量
    ai_model: "meshy-4-turbo",
    topology: "triangle",
    target_polycount: 30000,
    enable_pbr: false,
    texture_resolution: 1024,
    ...input.options,
  };

  const res = await meshyFetch("/openapi/v1/image-to-3d", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    await throwForStatus(res, "createImageTo3DTask");
  }
  const json = (await res.json()) as { result?: string; id?: string };
  const taskId = json.result ?? json.id;
  if (!taskId) {
    throw new Error("Meshy createImageTo3DTask 响应无 result/id");
  }
  return taskId;
}

/**
 * 查询 Image-to-3D 任务状态。
 *
 * Meshy 文档：GET /openapi/v1/image-to-3d/:id。
 * status 取值：PENDING / IN_PROGRESS / SUCCEEDED / FAILED / CANCELED。
 *
 * SUCCEEDED 时 model_urls.glb 是临时签名 URL（约 1 天过期）—— 业务层
 * 必须立即 fetch → R2 putObject，否则过期后用户拿不到模型。
 */
export async function getImageTo3DTask(
  taskId: string
): Promise<MeshyImageTo3DTask> {
  const res = await meshyFetch(
    `/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}`
  );
  if (!res.ok) {
    await throwForStatus(res, `getImageTo3DTask(${taskId})`);
  }
  return (await res.json()) as MeshyImageTo3DTask;
}

/**
 * 取消进行中的任务（Inngest 函数失败 / 用户主动取消时调用）。
 *
 * Meshy 文档：DELETE /openapi/v1/image-to-3d/:id。
 *
 * 注意：DELETE 对 SUCCEEDED / FAILED 任务是 idempotent 返 200，业务层
 * catch MeshyUpstreamError 4xx 也无所谓 —— 业务状态机已自洽。
 */
export async function deleteImageTo3DTask(taskId: string): Promise<void> {
  const res = await meshyFetch(
    `/openapi/v1/image-to-3d/${encodeURIComponent(taskId)}`,
    {
      method: "DELETE",
    }
  );
  if (!res.ok && res.status !== 404) {
    await throwForStatus(res, `deleteImageTo3DTask(${taskId})`);
  }
}

/**
 * 判断 Meshy 任务是否"已终态"（成功 / 失败 / 取消），便于轮询循环 break。
 */
export function isTerminalStatus(status: MeshyTaskStatus): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELED";
}

// ───────────────────────────────────────────────────────────────────────────
// Multi-Image to 3D（2026-09-16）
// ───────────────────────────────────────────────────────────────────────────

/**
 * 创建 Multi-Image to 3D 任务（2-4 张图合并）。
 *
 * Meshy 文档：POST /openapi/v1/multi-image-to-3d。
 *
 * - imageUrls 必须 1-4 张；Meshy 文档说 1 张也行，业务路由会强制 [2,4] 才发起。
 * - 首张图作为主视图（正面），其余顺序不影响结果。
 * - ai_model 默认 latest（Meshy 7）。
 *
 * @returns Meshy task id（后续轮询 / 取消都用）
 */
export async function createMultiImageTo3DTask(input: {
  imageUrls: string[];
  options?: MeshyMultiImageTo3DOptions;
}): Promise<string> {
  const body = {
    image_urls: input.imageUrls,
    // 默认值：Meshy 文档推荐 latest + should_texture=true 平衡质量与一致性
    ai_model: "latest",
    should_texture: true,
    enable_pbr: false,
    texture_resolution: "2k",
    target_polycount: 30000,
    topology: "triangle",
    pose_mode: "",
    image_enhancement: true,
    remove_lighting: true,
    ...input.options,
  };

  const res = await meshyFetch("/openapi/v1/multi-image-to-3d", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    await throwForStatus(res, "createMultiImageTo3DTask");
  }
  const json = (await res.json()) as { result?: string; id?: string };
  const taskId = json.result ?? json.id;
  if (!taskId) {
    throw new Error("Meshy createMultiImageTo3DTask 响应无 result/id");
  }
  return taskId;
}

/**
 * 查询 Multi-Image to 3D 任务状态。
 *
 * Meshy 文档：GET /openapi/v1/multi-image-to-3d/:id。
 * status 取值同单图：PENDING / IN_PROGRESS / SUCCEEDED / FAILED / CANCELED。
 *
 * SUCCEEDED 时 model_urls.glb 是临时签名 URL（约 1 天过期）—— 业务层
 * 必须立即 fetch → R2 putObject，否则过期后用户拿不到模型。
 *
 * 返回类型复用 MeshyImageTo3DTask —— 多图响应是超集（多出的字段如
 * model_urls.stl/3mf/pre_remeshed_glb、thumbnail_urls{front,right,...} 都是 optional）。
 */
export async function getMultiImageTo3DTask(
  taskId: string
): Promise<MeshyImageTo3DTask> {
  const res = await meshyFetch(
    `/openapi/v1/multi-image-to-3d/${encodeURIComponent(taskId)}`
  );
  if (!res.ok) {
    await throwForStatus(res, `getMultiImageTo3DTask(${taskId})`);
  }
  return (await res.json()) as MeshyImageTo3DTask;
}

/**
 * 取消 Multi-Image to 3D 任务（Inngest 函数失败 / 用户主动取消时调用）。
 *
 * Meshy 文档：DELETE /openapi/v1/multi-image-to-3d/:id。
 *
 * 注意：DELETE 对 SUCCEEDED / FAILED 任务是 idempotent 返 200，业务层
 * catch MeshyUpstreamError 4xx 也无所谓 —— 业务状态机已自洽。
 */
export async function deleteMultiImageTo3DTask(taskId: string): Promise<void> {
  const res = await meshyFetch(
    `/openapi/v1/multi-image-to-3d/${encodeURIComponent(taskId)}`,
    {
      method: "DELETE",
    }
  );
  if (!res.ok && res.status !== 404) {
    await throwForStatus(res, `deleteMultiImageTo3DTask(${taskId})`);
  }
}
