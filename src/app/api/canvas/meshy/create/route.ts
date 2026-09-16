/**
 * /api/canvas/meshy/create —— 画布 Meshy Image-to-3D 创建路由（POST）
 *
 * 调用链路：
 *   1. better-auth 校验 session
 *   2. 校验 body（imageUrl 协议 + options 白名单）
 *   3. rate limit（按 userId，ai 类型）
 *   4. createMeshyImageTo3DOnServer（预扣 200 credits + 创 Meshy 任务 + 写 job + send）
 *   5. 立即返 { jobId, pollUrl } → 前端轮询 GET /api/canvas/poll/{jobId}
 *
 * 与 /api/canvas/generate（image/audio）镜像：
 *   - 不走视频 createVideoOnServer 的同步 fallback（Meshy 必异步）
 *   - imageUrl 必须是 http(s):// 或 data:image/...（Meshy 不收其他）
 *   - 失败语义统一：积分不足 402、账号冻结 403、MeshyAuthError 503
 *
 * 复用：
 *   - createMeshyImageTo3DOnServer: src/features/canvas/services/meshy-image-to-3d.ts
 *   - /api/canvas/poll/[jobId]: 复用现有轮询路由（DB 分支自动支持新 capability）
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import {
  type CreateMeshyImageTo3DInput,
  createMeshyImageTo3DOnServer,
} from "@/features/canvas/services/meshy-image-to-3d";
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
// createMeshyImageTo3DOnServer 内部走：consumeCredits + createImageTo3DTask +
// db.insert + inngest.send，理论上 < 30s。预扣 200 credits 的 DB transaction
// + R2 准备可能要 10-20s，给 60s 兜底。Meshy 临时 URL 8 分钟的轮询是
// Inngest 后台的事，不在这条路径里。
export const maxDuration = 60;

// imageUrl 协议白名单：Meshy 仅接受 http(s) URL + data URL
const ALLOWED_PROTOCOLS = /^(https?:\/\/|data:image\/)/;

/**
 * options 白名单：防止任意 payload 灌入（Meshy options 在 client 层
 * 已 spread 默认值，但服务端再过一遍更稳）。
 */
const ALLOWED_OPTION_KEYS = new Set([
  "ai_model",
  "topology",
  "target_polycount",
  "enable_pbr",
  "texture_resolution",
  "symmetry_mode",
  "text_prompt",
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

  // rate limit：按 userId，ai 类型（与 image / audio / video 共享同一档）
  const rateLimit = await checkRateLimit(`canvas-meshy-create:${userId}`, "ai");
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

  const parsed = parseMeshyCreateBody(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { success: false, error: parsed.error },
      { status: 400 }
    );
  }

  try {
    const result = await createMeshyImageTo3DOnServer({
      userId,
      imageUrl: parsed.value.imageUrl,
      ...(parsed.value.options ? { options: parsed.value.options } : {}),
      ...(parsed.value.sourceNodeId
        ? { sourceNodeId: parsed.value.sourceNodeId }
        : {}),
      ...(parsed.value.projectId ? { projectId: parsed.value.projectId } : {}),
    });
    const res = NextResponse.json({
      success: true,
      capability: "image-to-3d",
      jobId: result.jobId,
      creditsConsumed: result.creditsConsumed,
      transactionId: result.transactionId,
      status: "pending",
      pollUrl: result.pollUrl,
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
    logger.error({ err, userId, message }, "canvas meshy create 失败");
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

// ───────────────────────────────────────────────────────────────────────────
// body 校验
// ───────────────────────────────────────────────────────────────────────────

type ParsedMeshyBody =
  | {
      ok: true;
      value: {
        imageUrl: string;
        options?: CreateMeshyImageTo3DInput["options"];
        sourceNodeId?: string;
        projectId?: string;
      };
    }
  | { ok: false; error: string };

function parseMeshyCreateBody(raw: unknown): ParsedMeshyBody {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "请求体必须是对象" };
  }
  const obj = raw as Record<string, unknown>;

  const imageUrl = typeof obj.imageUrl === "string" ? obj.imageUrl.trim() : "";
  if (!imageUrl) {
    return { ok: false, error: "缺少必填字段 imageUrl" };
  }
  if (imageUrl.length > 4096) {
    return { ok: false, error: "imageUrl 过长（>4096）" };
  }
  if (!ALLOWED_PROTOCOLS.test(imageUrl)) {
    return {
      ok: false,
      error: "imageUrl 必须以 https:// 或 data:image/ 开头",
    };
  }

  // options 白名单过滤
  let options: CreateMeshyImageTo3DInput["options"] | undefined;
  if (obj.options && typeof obj.options === "object") {
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(
      obj.options as Record<string, unknown>
    )) {
      if (ALLOWED_OPTION_KEYS.has(k)) filtered[k] = v;
    }
    if (Object.keys(filtered).length > 0) {
      options = filtered as CreateMeshyImageTo3DInput["options"];
    }
  }

  // sourceNodeId / projectId 透传（仅字符串）
  const sourceNodeId =
    typeof obj.sourceNodeId === "string" && obj.sourceNodeId.length > 0
      ? obj.sourceNodeId.slice(0, 128)
      : undefined;
  const projectId =
    typeof obj.projectId === "string" && obj.projectId.length > 0
      ? obj.projectId.slice(0, 128)
      : undefined;

  return {
    ok: true,
    value: {
      imageUrl,
      ...(options ? { options } : {}),
      ...(sourceNodeId ? { sourceNodeId } : {}),
      ...(projectId ? { projectId } : {}),
    },
  };
}
