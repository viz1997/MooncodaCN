/**
 * 用户端 - 获取效果图（URL）
 * GET /api/orders/[token]/candidates/[imageIdx]/[candIdx]
 *
 * 直接 302 重定向到效果图 URL（Lingting 上游 URL 或 R2 占位图公开 URL）。
 *
 * 带 ?historyId=... 时：从指定历史快照的 candidates JSON 中读图。
 * 校验 historyId 属于该 token 的订单，避免越权读到别人的快照。
 */

import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder, promptOrderHistory } from "@/db/schema";
import { parseCandidates } from "@/features/gpt-image/lib/order-helpers";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

async function getHandler(
  req: NextRequest,
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
    const historyId = req.nextUrl.searchParams.get("historyId");

    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      columns: { id: true, candidates: true },
    });
    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }

    // 历史快照路径：historyId 必须属于该订单
    if (historyId) {
      const snap = await db
        .select({ candidates: promptOrderHistory.candidates })
        .from(promptOrderHistory)
        .where(
          and(
            eq(promptOrderHistory.id, historyId),
            eq(promptOrderHistory.orderId, order.id)
          )
        )
        .limit(1);
      const row = snap[0];
      if (!row) {
        return NextResponse.json(
          { success: false, error: "历史快照不存在或不属于该订单" },
          { status: 404 }
        );
      }
      const nested = parseCandidates(row.candidates);
      const group = nested[imageIdx];
      const target = Array.isArray(group) ? group[candIdx] : undefined;
      if (typeof target !== "string" || !target) {
        return NextResponse.json(
          { success: false, error: "历史快照的效果图不存在" },
          { status: 404 }
        );
      }
      if (!/^https?:\/\//i.test(target)) {
        return NextResponse.json(
          {
            success: false,
            error: "历史快照字段不是合法 URL",
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
    }

    // 正常路径
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
