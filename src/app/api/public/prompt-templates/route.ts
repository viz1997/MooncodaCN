/**
 * 410 Gone —— /api/public/prompt-templates 已迁走
 *
 * 2026-10-13 v2.1:mp 端点统一迁到 /api/image-gen/templates。
 * 此路由返 410 + 指向新路径。删除计划:2026-11-15 之后。
 */

import { type NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(_req: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error:
        "GET /api/public/prompt-templates 已迁到 GET /api/image-gen/templates(2026-10-13 v2.1)",
      code: "GONE",
      movedTo: "/api/image-gen/templates",
    },
    { status: 410 }
  );
}
