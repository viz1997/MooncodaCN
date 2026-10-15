/**
 * GET /api/image-gen/quota
 *
 * 2026-10-13 v2.1:从 /api/public/quota 迁过来。
 * 原 /api/public/quota 已 410 Gone(指向本路径)。迁移动机见
 * scripts/verify-image-gen-routes.sh 头部注释 + conversation 历史。
 *
 * 鉴权:与 /api/public/quota 一致,强制外部 API Key
 * (x-api-key > Authorization: Bearer <key>),dev 模式 EXTERNAL_API_KEY_REQUIRED=0 关。
 *
 * 语义:外部 API Key 月调用配额,不是登录用户 credits 余额。
 * - limit=0 → 无限配额
 * - remaining=-1 → 无限配额的占位
 * - resetAt:下月 1 号 0:00 UTC 的 ISO 8601
 */

import { type NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/features/image-gen";
import { checkRateLimit, getRateLimitHeaders } from "@/lib/rate-limit";
import { requireExternalApiKey } from "@/lib/require-external-api-key";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const ip = getClientIp(req.headers);

  // 配额查询相对廉价,reuse ai 限流配置(同 /api/image-gen/submit 的桶)
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
