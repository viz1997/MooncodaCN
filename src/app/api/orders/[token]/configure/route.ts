/**
 * 用户端 - 提交产品定制（皮革徽章 / 刻字 / 外露）
 * POST /api/orders/[token]/configure
 *
 * 2026-09-07：4 个定制字段由 /p/[token] 上的终端用户填，与"尺寸/配件"
 * 在创建时由代理商定死的语义互补。能力按产品型号区分：
 * - hasLeatherBadge / engravingText 必须在 productTypeCode 的 capabilities
 *   支持的字段里才允许填，否则 400。
 * - 无 productTypeCode（ToC 订单）→ 4 字段全不接受。
 *
 * 状态机：PENDING 阶段可改，GENERATING 之后锁死（用户没机会改，
 * 但万一前端误调，直接 400 拒绝）。
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { getProductType } from "@/features/gpt-image/lib/product-catalog";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

const configureSchema = z
  .object({
    hasLeatherBadge: z.boolean().nullable().optional(),
    engravingText: z.string().trim().min(0).max(40).nullable().optional(),
    engravingExposed: z.boolean().nullable().optional(),
  })
  .strict();

async function postHandler(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;
    const raw = await req.json().catch(() => ({}));
    const parsed = configureSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "请求体格式不合法" },
        { status: 400 }
      );
    }
    const input = parsed.data;

    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      columns: {
        id: true,
        status: true,
        productTypeCode: true,
      },
    });
    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }

    // 状态机：仅 PENDING 阶段可改。GENERATING / CANDIDATES_READY /
    // SELECTED / CANCELLED / FAILED 全部拒绝。
    if (order.status !== "PENDING") {
      return NextResponse.json(
        {
          success: false,
          error: `当前状态（${order.status}）不允许修改定制信息`,
        },
        { status: 400 }
      );
    }

    // ToC 订单（无 productTypeCode）→ 不接受定制
    if (!order.productTypeCode) {
      return NextResponse.json(
        { success: false, error: "此订单无产品型号，不支持定制" },
        { status: 400 }
      );
    }

    const type = getProductType(order.productTypeCode);
    if (!type) {
      return NextResponse.json(
        {
          success: false,
          error: `产品型号不存在：${order.productTypeCode}`,
        },
        { status: 400 }
      );
    }

    // 能力联动校验：与产品 capabilities 严格对齐
    const finalHasLeatherBadge =
      type.capabilities.hasLeatherBadge && input.hasLeatherBadge === true
        ? true
        : null;
    // engravingText 联动：canEngrave=true 且用户给了非空文本才存
    const trimmedEngraving =
      type.capabilities.canEngrave &&
      typeof input.engravingText === "string" &&
      input.engravingText.trim().length > 0
        ? input.engravingText.trim()
        : null;
    const finalEngravingExposed =
      type.capabilities.canEngrave && trimmedEngraving !== null
        ? input.engravingExposed === true
        : null;

    await db
      .update(promptOrder)
      .set({
        hasLeatherBadge: finalHasLeatherBadge,
        engravingText: trimmedEngraving,
        engravingExposed: finalEngravingExposed,
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, order.id));

    return NextResponse.json({
      success: true,
      data: {
        hasLeatherBadge: finalHasLeatherBadge,
        engravingText: trimmedEngraving,
        engravingExposed: finalEngravingExposed,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "保存失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler);
