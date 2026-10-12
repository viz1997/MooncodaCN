/**
 * 用户端 - 获取原图（URL / 二进制流）
 * GET /api/orders/[token]/image?index=0
 *
 * 默认：302 重定向到 R2 公开 URL（用于 <img src> 直接展示）。
 * 带 ?download=1：服务端 fetch R2 → binary stream 回前端，触发下载。
 * 修管理端 orders-admin-view.tsx 原图下载：浏览器 fetch(R2 URL) 会被
 * R2 公开域默认无 CORS 拒绝，与 candidates 路由同一根因（参考
 * [[public-order-download-cors]] / [[workbench-image-proxy]]）。
 *
 * 2026-09-14：扩 ?download=1 模式（candidates 路由早已有，本次对齐）。
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { parseUploadedImages } from "@/features/gpt-image/lib/order-helpers";
import { withApiLogging } from "@/lib/api-logger";

import { getPreviewShareByToken } from "../../_lib/preview-share-helpers";

export const runtime = "nodejs";

async function getHandler(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;
    const url = new URL(req.url);
    const indexStr = url.searchParams.get("index");
    const index = indexStr ? Number.parseInt(indexStr, 10) : 0;
    if (!Number.isInteger(index) || index < 0) {
      return NextResponse.json(
        { success: false, error: "index 无效" },
        { status: 400 }
      );
    }

    // 2026-09-14：preview 流 6 步工作台 —— preview_share 优先。
    const preview = await getPreviewShareByToken(token);
    if (preview) {
      const images = parseUploadedImages(preview.uploadedImages);
      const target = images[index];
      if (!target) {
        return NextResponse.json(
          { success: false, error: "原图不存在" },
          { status: 404 }
        );
      }
      if (!/^https?:\/\//i.test(target)) {
        return NextResponse.json(
          {
            success: false,
            error: "原图字段不是合法 URL",
          },
          { status: 500 }
        );
      }
      return NextResponse.redirect(target, {
        status: 302,
        headers: { "Cache-Control": "private, max-age=60" },
      });
    }

    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      columns: { uploadedImages: true },
    });
    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }
    const images = parseUploadedImages(order.uploadedImages as string | null);
    const target = images[index];
    if (!target) {
      return NextResponse.json(
        { success: false, error: "原图不存在" },
        { status: 404 }
      );
    }
    if (!/^https?:\/\//i.test(target)) {
      return NextResponse.json(
        {
          success: false,
          error: "原图字段不是合法 URL（可能是历史 base64 数据）",
        },
        { status: 500 }
      );
    }

    // 2026-09-14：下载模式 — 服务端 fetch 二进制 → stream 回前端，
    // 与 candidates 路由的 download 分支同语义。避免浏览器 fetch R2 URL
    // 撞 CORS 拿到 opaque blob（管理端 handleDownload 现在统一加 ?download=1）。
    if (url.searchParams.get("download") === "1") {
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
        "Cache-Control": "private, max-age=60",
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
