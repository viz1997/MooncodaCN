/**
 * 用户端 - 获取原图（URL）
 * GET /api/orders/[token]/image?index=0
 *
 * 直接 302 重定向到 R2 公开 URL，不再做 base64 解码和字节流回吐。
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { parseUploadedImages } from "@/features/gpt-image/lib/order-helpers";
import { withApiLogging } from "@/lib/api-logger";

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
