/**
 * 用户端 - 获取效果图（URL / 二进制流）
 * GET /api/orders/[token]/candidates/[imageIdx]/[candIdx]
 *
 * 默认：302 重定向到效果图 URL（用于 <img src> 直接展示）
 *
 * 带 ?historyId=... 时：从指定历史快照的 candidates JSON 中读图。
 * 校验 historyId 属于该 token 的订单，避免越权读到别人的快照。
 *
 * 带 ?download=1 时：服务端 fetch 图二进制 → stream 回前端，
 * 触发 Content-Disposition: attachment 下载。
 * 修公共免登录页 (/p/[token]) 的下载失败：浏览器 fetch(R2 URL)
 * 会被 R2 公共域默认无 CORS 拒绝（与 [[workbench-image-proxy]]
 * 同一根因），服务端 fetch 没有跨域限制。
 */

import { and, eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder, promptOrderHistory } from "@/db/schema";
import { parseCandidates } from "@/features/gpt-image/lib/order-helpers";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";
// 2026-09-02：download 路径要 stream R2 二进制，cold fetch 16s+
export const maxDuration = 60;

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
      if (req.nextUrl.searchParams.get("download") === "1") {
        // 同主路径：服务端 stream（修 R2 CORS）
        let upstream: Response;
        try {
          upstream = await fetch(target, {
            signal: AbortSignal.timeout(25_000),
          });
        } catch (err) {
          return NextResponse.json(
            {
              success: false,
              error: `下载源失败：${err instanceof Error ? err.message : "unknown"}`,
            },
            { status: 502 }
          );
        }
        if (!upstream.ok || !upstream.body) {
          return NextResponse.json(
            {
              success: false,
              error: `上游返回 ${upstream.status}`,
              status: upstream.status,
            },
            { status: 502 }
          );
        }
        const contentType =
          upstream.headers.get("Content-Type") ?? "application/octet-stream";
        const headers: HeadersInit = {
          "Content-Type": contentType,
          "Cache-Control": "private, max-age=300",
        };
        return new Response(upstream.body, { headers });
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

    // 2026-09-02：下载模式 — 服务端 fetch 图二进制 → stream 回前端。
    // 修公共免登录页 (/p/[token]) 的下载失败：浏览器 fetch(R2 URL)
    // 会被 R2 公共域默认无 CORS 拒绝（与 [[workbench-image-proxy]] 同一根因），
    // 服务端 fetch 没有跨域限制。
    if (req.nextUrl.searchParams.get("download") === "1") {
      let upstream: Response;
      try {
        upstream = await fetch(target, {
          signal: AbortSignal.timeout(25_000),
        });
      } catch (err) {
        return NextResponse.json(
          {
            success: false,
            error: `下载源失败：${err instanceof Error ? err.message : "unknown"}`,
          },
          { status: 502 }
        );
      }
      if (!upstream.ok || !upstream.body) {
        return NextResponse.json(
          {
            success: false,
            error: `上游返回 ${upstream.status}`,
            status: upstream.status,
          },
          { status: 502 }
        );
      }
      const contentType =
        upstream.headers.get("Content-Type") ?? "application/octet-stream";
      const headers: HeadersInit = {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=300",
      };
      return new Response(upstream.body, { headers });
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
