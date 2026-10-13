/**
 * 410 Gone —— /api/public/generate 已迁走
 *
 * 2026-10-13 v2.1:mp 端点统一迁到 /api/image-gen/**,鉴权 / 限流 / 响应 shape
 * 完全保持,只换路径前缀。
 *
 *   POST /api/public/generate        → POST /api/image-gen/submit
 *   GET  /api/public/generate        → GET  /api/image-gen/templates
 *
 * 此路由返 410 + 指向新路径,而不是 404:
 *   - 410 是 HTTP 标准 "永久移走" 语义,SDK 升级中漏升的 mp 看到 410 + 文案
 *     就能立刻定位改哪
 *   - 1 个月后再删(2026-11 中下旬),期间给留个明确 breadcrumb
 *
 * 删除计划:2026-11-15 之后可以从仓库移除,届时 mp 端应已全部切到
 * /api/image-gen/**。在此之前保留 410 防止线上漏升 SDK 不可见。
 */

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
// 410 stub 不调外部,maxDuration 给最小值即可
export const maxDuration = 10;

export async function POST(_req: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error:
        "POST /api/public/generate 已迁到 POST /api/image-gen/submit(2026-10-13 v2.1)",
      code: "GONE",
      movedTo: "/api/image-gen/submit",
    },
    { status: 410 }
  );
}

export async function GET(_req: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error:
        "GET /api/public/generate 已迁到 GET /api/image-gen/templates(2026-10-13 v2.1)",
      code: "GONE",
      movedTo: "/api/image-gen/templates",
    },
    { status: 410 }
  );
}
