/**
 * /api/canvas/meshy/multi-image/create —— 画布 Meshy Multi-Image to 3D 创建路由（POST）
 *
 * 调用链路：
 *   1. better-auth 校验 session
 *   2. 校验 body（imageUrls.length ∈ [2,4] + 每条 URL 协议白名单 + 去重）
 *   3. rate limit（按 userId，ai 类型）
 *   4. createMeshyMultiImageTo3DOnServer（预扣 400 credits + 创 Meshy 任务 + 写 job + send）
 *   5. 立即返 { jobId, pollUrl } → 前端轮询 GET /api/canvas/poll/{jobId}
 *
 * 与 /api/canvas/meshy/create（image-to-3d 单图）镜像：
 *   - 多图走 2-4 张 URL，body 是 imageUrls: string[] 而非 imageUrl: string
 *   - 强制 imageUrls 去重（Meshy 不去重，重复 URL 会让用户被多扣积分）
 *   - 失败语义统一：积分不足 402、账号冻结 403、MeshyAuthError 503
 *
 * 复用：
 *   - createMeshyMultiImageTo3DOnServer: src/features/canvas/services/meshy-multi-image-to-3d.ts
 *   - /api/canvas/poll/[jobId]: 复用现有轮询路由（DB 分支自动支持新 capability）
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import {
  type CreateMeshyMultiImageTo3DInput,
  createMeshyMultiImageTo3DOnServer,
} from "@/features/canvas/services/meshy-multi-image-to-3d";
import { auth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  MeshyAuthError,
  MeshyInsufficientCreditsError,
  MeshyRateLimitError,
  MeshyUpstreamError,
} from "@/lib/meshy/client";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
// createMeshyMultiImageTo3DOnServer 内部走：consumeCredits + createMultiImageTo3DTask +
// db.insert + inngest.send，理论上 < 30s。预扣 400 credits 的 DB transaction
// + R2 准备可能要 10-20s，给 60s 兜底。Meshy 临时 URL 8 分钟的轮询是
// Inngest 后台的事，不在这条路径里。
export const maxDuration = 60;

// imageUrl 协议白名单：Meshy 仅接受 http(s) URL + data URL
const ALLOWED_PROTOCOLS = /^(https?:\/\/|data:image\/)/;
// Meshy 限制 1-4 张图；业务层强制 [2,4]
const IMAGE_URLS_MIN = 2;
const IMAGE_URLS_MAX = 4;
// 每条 URL 长度上限
const SINGLE_URL_MAX = 4096;

/**
 * options 白名单：与 MeshyMultiImageTo3DOptions 对齐，防止任意 payload 灌入。
 * Meshy options 在 createMeshyMultiImageTo3DTask 的 spread 里已含默认值，
 * 但服务端再过一遍更稳。
 */
const ALLOWED_OPTION_KEYS = new Set([
  "ai_model",
  "ultra_mode",
  "should_texture",
  "enable_pbr",
  "texture_resolution",
  "target_polycount",
  "topology",
  "pose_mode",
  "image_enhancement",
  "remove_lighting",
  "moderation",
  "target_formats",
  "auto_size",
  "texture_prompt",
  "style",
]);

export async function POST(req: NextRequest) {
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "请先登录" },
      { status: 401 }
    );
  }
  const userId = session.user.id;

  // rate limit：按 userId，ai 类型（与单图共享同一档）
  const rateLimit = await checkRateLimit(
    `canvas-meshy-multi-create:${userId}`,
    "ai"
  );
  if (!rateLimit.success) {
    return createRateLimitResponse(rateLimit);
  }

  // 解析 body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "请求体不是合法 JSON" },
      { status: 400 }
    );
  }

  const parsed = parseMeshyMultiCreateBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { success: false, error: parsed.error },
      { status: 400 }
    );
  }

  try {
    const result = await createMeshyMultiImageTo3DOnServer({
      userId,
      imageUrls: parsed.value.imageUrls,
      ...(parsed.value.options ? { options: parsed.value.options } : {}),
      ...(parsed.value.sourceNodeIds && parsed.value.sourceNodeIds.length > 0
        ? { sourceNodeIds: parsed.value.sourceNodeIds }
        : {}),
      ...(parsed.value.projectId ? { projectId: parsed.value.projectId } : {}),
    });
    const res = NextResponse.json({
      success: true,
      capability: "multi-image-to-3d",
      jobId: result.jobId,
      creditsConsumed: result.creditsConsumed,
      transactionId: result.transactionId,
      status: "pending",
      pollUrl: result.pollUrl,
      imageCount: parsed.value.imageUrls.length,
    });
    Object.entries(getRateLimitHeaders(rateLimit)).forEach(([k, v]) => {
      res.headers.set(k, v);
    });
    res.headers.set("x-ratelimit-remaining", String(rateLimit.remaining));
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "未知错误";

    // 业务异常 → 精确状态码
    if (err instanceof Error && err.name === "InsufficientCreditsError") {
      return NextResponse.json(
        { success: false, error: message, code: "insufficient_credits" },
        { status: 402 }
      );
    }
    if (err instanceof Error && err.name === "AccountFrozenError") {
      return NextResponse.json(
        { success: false, error: message, code: "account_frozen" },
        { status: 403 }
      );
    }
    // Meshy 业务错误
    if (
      err instanceof MeshyAuthError ||
      err instanceof MeshyInsufficientCreditsError
    ) {
      logger.warn(
        { err, userId, message },
        "Meshy 鉴权 / 余额失败（未扣积分或已自动 refund）"
      );
      return NextResponse.json(
        { success: false, error: message, code: "meshy_config" },
        { status: 503 }
      );
    }
    if (err instanceof MeshyRateLimitError) {
      return NextResponse.json(
        { success: false, error: message, code: "meshy_rate_limit" },
        { status: 429 }
      );
    }
    if (err instanceof MeshyUpstreamError) {
      logger.error({ err, userId }, "Meshy 上游 5xx 失败（积分已自动 refund）");
      return NextResponse.json(
        { success: false, error: message, code: "meshy_upstream" },
        { status: 502 }
      );
    }
    // 兜底：未知错误
    logger.error(
      { err, userId, message },
      "canvas meshy multi-image create 失败"
    );
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// body 校验
// ───────────────────────────────────────────────────────────────────────────

type ParsedMeshyMultiBody =
  | {
      ok: true;
      value: {
        imageUrls: string[];
        options?: CreateMeshyMultiImageTo3DInput["options"];
        sourceNodeIds?: string[];
        projectId?: string;
      };
    }
  | { ok: false; error: string };

function parseMeshyMultiCreateBody(raw: unknown): ParsedMeshyMultiBody {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "请求体必须是对象" };
  }
  const obj = raw as Record<string, unknown>;

  // imageUrls 数组校验
  if (!Array.isArray(obj.imageUrls)) {
    return { ok: false, error: "缺少必填字段 imageUrls（必须是 string[]）" };
  }
  const imageUrlsRaw = obj.imageUrls as unknown[];
  if (
    imageUrlsRaw.length < IMAGE_URLS_MIN ||
    imageUrlsRaw.length > IMAGE_URLS_MAX
  ) {
    return {
      ok: false,
      error: `imageUrls 长度必须在 [${IMAGE_URLS_MIN}, ${IMAGE_URLS_MAX}] 区间`,
    };
  }
  // 每条 URL：trim + 类型 + 协议白名单 + 长度上限
  const imageUrls: string[] = [];
  for (let idx = 0; idx < imageUrlsRaw.length; idx++) {
    const raw = imageUrlsRaw[idx];
    if (typeof raw !== "string") {
      return { ok: false, error: `imageUrls[${idx}] 不是字符串` };
    }
    const url = raw.trim();
    if (!url) {
      return { ok: false, error: `imageUrls[${idx}] 为空` };
    }
    if (url.length > SINGLE_URL_MAX) {
      return {
        ok: false,
        error: `imageUrls[${idx}] 过长（>${SINGLE_URL_MAX}）`,
      };
    }
    if (!ALLOWED_PROTOCOLS.test(url)) {
      return {
        ok: false,
        error: `imageUrls[${idx}] 必须以 https:// 或 data:image/ 开头`,
      };
    }
    imageUrls.push(url);
  }

  // 去重校验 —— Meshy 不会去重，重复 URL 会让用户被多扣积分
  if (new Set(imageUrls).size !== imageUrls.length) {
    return { ok: false, error: "imageUrls 包含重复 URL，请去除重复后再试" };
  }

  // options 白名单过滤
  let options: CreateMeshyMultiImageTo3DInput["options"] | undefined;
  if (obj.options && typeof obj.options === "object") {
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      obj.options as Record<string, unknown>
    )) {
      if (ALLOWED_OPTION_KEYS.has(k)) filtered[k] = v;
    }
    if (Object.keys(filtered).length > 0) {
      options = filtered as CreateMeshyMultiImageTo3DInput["options"];
    }
  }

  // sourceNodeIds / projectId 透传（仅字符串）
  const sourceNodeIds = Array.isArray(obj.sourceNodeIds)
    ? (obj.sourceNodeIds as unknown[])
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .slice(0, 16)
        .map((s) => s.slice(0, 128))
    : undefined;
  const projectId =
    typeof obj.projectId === "string" && obj.projectId.length > 0
      ? obj.projectId.slice(0, 128)
      : undefined;

  return {
    ok: true,
    value: {
      imageUrls,
      ...(options ? { options } : {}),
      ...(sourceNodeIds && sourceNodeIds.length > 0 ? { sourceNodeIds } : {}),
      ...(projectId ? { projectId } : {}),
    },
  };
}
