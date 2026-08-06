/**
 * 用户端 - 获取效果图（URL）
 * GET /api/orders/[token]/candidates/[imageIdx]/[candIdx]
 *
 * 直接 302 重定向到效果图 URL（Lingting 上游 URL 或 R2 占位图公开 URL）。
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { parseCandidates } from "@/features/gpt-image/lib/order-helpers";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

async function getHandler(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; imageIdx: string; candIdx: string }> }
) {
  try {
    const { token, imageIdx: imgStr, candIdx: candStr } = await ctx.params;
    const imageIdx = Number.parseInt(imgStr, 10);
    const candIdx = Number.parseInt(candStr, 10);
    if (
      !Number.isInteger(imageIdx) ||
      !Number.isInteger(candIdx) ||
      imageIdx < 0 ||
      candIdx < 0
    ) {
      return NextResponse.json(
        { success: false, error: "参数无效" },
        { status: 400 }
      );
    }
    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      columns: { candidates: true },
    });
    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }
    const nested = parseCandidates(order.candidates as string | null);
    const group = nested[imageIdx];
    const target = Array.isArray(group) ? group[candIdx] : undefined;
    if (typeof target !== "string" || !target) {
      return NextResponse.json(
        { success: false, error: "效果图不存在" },
        { status: 404 }
      );
    }
    if (!/^https?:\/\//i.test(target)) {
      return NextResponse.json(
        {
          success: false,
          error: "效果图字段不是合法 URL（可能是历史 base64 数据）",
        },
        { status: 500 }
      );
    }

    return NextResponse.redirect(target, {
      status: 302,
      headers: {
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "获取失败",
      },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler);
