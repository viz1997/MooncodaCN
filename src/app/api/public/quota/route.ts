/**
 * 外部 API Key 配额查询端点
 *
 * 2026-10-13：mp 端把 quota 从云函数迁到 BFF 时,owner 之前指错路径
 * (/api/credits/balance 不存在,404)。本端点才是 mp 应调的目标:
 *   GET /api/public/quota  +  x-api-key: <mk_pub_xxx>
 *
 * 语义说明:
 * - 配额是「外部 API Key 的月调用上限」,不是用户的 credits 余额
 *   (credits 是登录用户用 BA session 查的,跟本路由无关)
 * - monthlyQuota ≤ 0 视为无限(见 external-api-key-service 注释)
 * - monthlyCalls 在 verify 时按需跨月重置(usedAfterReset=0),但 DB 行本
 *   身是惰性写回 —— 只有下次 recordExternalApiKeyCall 才会落库。这里只
 *   读 verify 返回的"逻辑当前月"值,不算 DB 原值。
 * - 失败时不应该自增 monthlyCalls,所以这里只 verify 不 record。
 *
 * 响应:
 *   {
 *     keyName: "moon",
 *     used: 12,                 // 当月已调用次数
 *     limit: 1000,              // 月配额上限(0 = 无限)
 *     remaining: 988,           // 剩余可调用次数(无限时 = -1)
 *     unlimited: false,         // 是否无限配额
 *     resetAt: "2026-11-01T00:00:00Z"  // 下次重置时间(ISO 8601,UTC)
 *   }
 *
 * 错误码:复用 requireExternalApiKey 的 status 码(401/403/429)
 */

import { type NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/features/image-gen";
import { requireExternalApiKey } from "@/lib/require-external-api-key";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);

  // 配额查询相对廉价,reuse ai 限流配置(同 /api/public/generate 的桶)
  const rl = await checkRateLimit(ip ?? "unknown", "ai");
  if (!rl.success) {
    return NextResponse.json(
      { success: false, error: "请求过于频繁" },
      { status: 429, headers: getRateLimitHeaders(rl) }
    );
  }

  const { verify, errorResponse } = await requireExternalApiKey(req, ip, rl);
  if (errorResponse) return errorResponse;
  // requireExternalApiKey 在 !isExternalApiKeyRequired() 时返 verify=null;
  // 本端点必须有 key —— dev 关校验时不返业务数据,直接 401
  if (!verify?.ok) {
    return NextResponse.json(
      { success: false, error: "需要 API Key", code: "API_KEY_MISSING" },
      { status: 401 }
    );
  }

  // resetAt:本月 1 号 0:00 UTC 之后的下个月 1 号 0:00 UTC。mp 端可以据此
  // 算出"距离配额恢复还剩多久"做 UI 展示。
  const now = new Date();
  const nextReset = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  );

  const used = verify.monthlyCalls;
  const limit = verify.monthlyQuota;
  const unlimited = limit <= 0;
  const remaining = unlimited ? -1 : Math.max(0, limit - used);

  return NextResponse.json(
    {
      success: true,
      keyName: verify.name,
      used,
      limit,
      remaining,
      unlimited,
      resetAt: nextReset.toISOString(),
    },
    { headers: getRateLimitHeaders(rl) }
  );
}
