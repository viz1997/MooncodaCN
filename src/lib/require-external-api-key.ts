/**
 * 外部 API Key 鉴权统一 helper
 *
 * 2026-10-13：从 /api/public/generate 抽出,让 /api/public/prompt-templates
 * (及未来同类 public 路由) 复用同一套鉴权 + 拒绝语义 + 限流 headers + 埋点。
 *
 * 行为:
 * - EXTERNAL_API_KEY_REQUIRED=false (dev) → verify = null,跳过校验
 * - 校验失败 → 返 errorResponse(带 status + rate limit headers + 埋点)
 * - 校验成功 → 返 verify(含 keyId / allowedMasks 等,调用方按需使用)
 *
 * 优先级: x-api-key > Authorization: Bearer <key>(同源策略避免 mp 错把 BA
 * session token 当作外部 key 透传,需要走 Authorization 通道时主动 unset Bearer)
 */

import { type NextRequest, NextResponse } from "next/server";
import { logImageGen } from "@/features/image-gen";
import {
  isExternalApiKeyRequired,
  verifyExternalApiKey,
  type VerifyRejectReason,
} from "@/features/image-gen/lib/external-api-key-service";
import { type RateLimitResult, getRateLimitHeaders } from "@/lib/rate-limit";

/** verify 完整 ok 结果的 type alias(便于多处复用) */
type KeyVerifyResult = Awaited<ReturnType<typeof verifyExternalApiKey>>;

/** verify reject reason → HTTP status code */
const API_KEY_REJECT_STATUS: Record<VerifyRejectReason, number> = {
  missing: 401,
  malformed: 401,
  not_found: 401,
  disabled: 403,
  quota_exceeded: 429,
};

/** 从请求头提取 raw API key。trim 后空串视作未传。 */
function extractApiKeyFromHeaders(req: NextRequest): string | null {
  const xApiKey = req.headers.get("x-api-key");
  if (xApiKey) {
    const trimmed = xApiKey.trim();
    if (trimmed) return trimmed;
  }
  const auth = req.headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    if (match?.[1]) {
      const trimmed = match[1].trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

/**
 * 统一 API Key 校验(供 /api/public/** 路由调用)
 *
 * @param req       NextRequest
 * @param ip        客户端 IP(用于埋点 + 限流)
 * @param rl        限流结果(用于响应 headers)
 * @returns         verify + 失败时 errorResponse
 *
 * 用法:
 *   const { verify, errorResponse } = await requireExternalApiKey(req, ip, rl);
 *   if (errorResponse) return errorResponse;
 *   // verify?.ok ? key 已校验:走白名单逻辑
 */
export async function requireExternalApiKey(
  req: NextRequest,
  ip: string | undefined,
  rl: RateLimitResult
): Promise<{ verify: KeyVerifyResult | null; errorResponse?: NextResponse }> {
  if (!isExternalApiKeyRequired()) {
    return { verify: null };
  }
  const rawKey = extractApiKeyFromHeaders(req);
  const verify = await verifyExternalApiKey(rawKey);
  if (!verify.ok) {
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "public",
      model: "unknown",
      errorCode: `API_KEY_${verify.reason.toUpperCase()}`,
      errorMessage: verify.message,
      ip,
    });
    return {
      verify: null,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: verify.message,
          code: `API_KEY_${verify.reason.toUpperCase()}`,
        },
        {
          status: API_KEY_REJECT_STATUS[verify.reason]!,
          headers: getRateLimitHeaders(rl),
        }
      ),
    };
  }
  return { verify };
}
