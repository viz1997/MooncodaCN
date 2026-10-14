/**
 * 外部 API Key 鉴权统一 helper
 *
 * 2026-10-13：从 /api/public/generate 抽出,让 /api/public/prompt-templates
 * (及未来同类 public 路由) 复用同一套鉴权 + 拒绝语义 + 限流 headers + 埋点。
 *
 * 2026-10-14：扩展已登录 demo 流放行 —— `/image-gen` 页面强制 BA 登录,
 * 但页面 fetch 的还是同一组 /api/image-gen/* 路由,如果不放行,已登录用户
 * 调这些路由会被 401(因为他们没 x-api-key)。三档鉴权优先级:
 *
 *   1) dev 模式(EXTERNAL_API_KEY_REQUIRED=false) → verify=null,跳过
 *   2) BA session 命中(headers 里带登录 cookie) → verify=null,跳过
 *      - 仅适用 demo 流;合作伙伴路径走 x-api-key 仍是必填
 *   3) 否则校验 x-api-key / Authorization: Bearer
 *      - 校验失败 → 返 errorResponse + 埋点
 *      - 校验成功 → 返 verify(调用方按需用 allowedMasks / 配额)
 *
 * 调用方语义保持向后兼容:verify=null 仍意味着「不需要走 key 白名单 / 配额
 * 逻辑」,无论是 dev 跳过还是 BA session 跳过。submit / templates 等路由无
 * 需感知是哪种 null。
 *
 * 外部 Key 通道内部优先级: x-api-key > Authorization: Bearer <key>
 * (同源策略避免 mp 错把 BA session token 当外部 key 透传,需要走 Authorization
 * 通道时主动 unset Bearer)
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { logImageGen } from "@/features/image-gen";
import {
  isExternalApiKeyRequired,
  verifyExternalApiKey,
  type VerifyRejectReason,
} from "@/features/image-gen/lib/external-api-key-service";
import { auth } from "@/lib/auth";
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

  // 2026-10-14:已登录 demo 流放行 —— /image-gen 页面强制登录,fetch 同一组
  // 公共路由必须能跑通。BA session.user.id 存在则视为「已登录 demo 用户」,
  // 跳过 x-api-key 校验。BA session 缺失/过期/未登录,落到 x-api-key 校验
  // 路径(合作伙伴 / 小程序)。getSession 是 BA 标准用法,失败抛错也吞掉
  // —— 主流程继续走 key 校验,不让 session 抖动阻塞。
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (session?.user?.id) {
      return { verify: null };
    }
  } catch {
    // session 取失败不阻塞,继续走 x-api-key 校验
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
