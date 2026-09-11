/**
 * 用户端 - 提交产品定制（刻字 / 外露）
 * POST /api/orders/[token]/configure
 *
 * 2026-09-07：终端用户在 /p/[token] 上填"刻字"定制，与"尺寸/配件"在
 * 创建时由代理商定死的语义互补。能力按产品型号区分：
 * - engravingText / engravingExposed 必须在 productTypeCode 的 capabilities
 *   支持的字段里才允许填，否则 400。
 * - 无 productTypeCode（ToC 订单）→ 全不接受。
 *
 * 历史：曾包含 hasLeatherBadge 字段（皮革徽章挂在 R 钥匙扣上的开关），
 * 同日下午重构为 LB（皮革徽章）独立产品型号，已删除。
 *
 * 状态机：PENDING 阶段可改，GENERATING 之后锁死（用户没机会改，
 * 但万一前端误调，直接 400 拒绝）。
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import {
  getProductType,
  validateLeatherColor,
  validatePlatform,
} from "@/features/gpt-image/lib/product-catalog";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

// 2026-09-10：扩 4 个 LB 皮革徽章定制字段（leatherColor / leatherExposed / pvcProtection / remarks）。
// 2026-09-11：再加 platform（订单来源平台，PLATFORMS 字典 code；仅 LB canPlatform=true 接受）
//   与 platformOrderNo（渠道订单号，与 platform 配对的异构字符串 free text）。
// 全部 capability-gated：非 LB 型号在下面联动校验块被静默 collapse 为 null，不抛错。
const configureSchema = z
  .object({
    engravingText: z.string().trim().min(0).max(40).nullable().optional(),
    engravingExposed: z.boolean().nullable().optional(),
    leatherColor: z.string().min(1).max(32).nullable().optional(),
    leatherExposed: z.boolean().nullable().optional(),
    pvcProtection: z.boolean().nullable().optional(),
    remarks: z.string().trim().min(0).max(500).nullable().optional(),
    platform: z.string().min(1).max(32).nullable().optional(),
    // 2026-09-11：渠道订单号（max 64：淘宝订单号 18 位 + 留余量）
    platformOrderNo: z.string().trim().min(0).max(64).nullable().optional(),
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

    // 2026-09-10：LB 皮革徽章扩字段联动。capability 关闭的字段静默 collapse 为 null（与 engraving 同模式）。
    const finalLeatherColor = type.capabilities.canLeatherColor
      ? (input.leatherColor ?? null)
      : null;
    // 字典白名单 —— 字典外的 code 直接抛 400（避免脏数据落库）
    validateLeatherColor(finalLeatherColor);
    const finalLeatherExposed = type.capabilities.canLeatherExposed
      ? input.leatherExposed === true
      : null;
    const finalPvcProtection = type.capabilities.canPvcProtection
      ? input.pvcProtection === true
      : null;
    // 2026-09-11：皮革外露 / PVC 保护互斥（二选一）。
    // UI 层 ProductConfigSection 已经做了互斥，server 再兜一次挡绕过前端的脏请求。
    if (finalLeatherExposed === true && finalPvcProtection === true) {
      return NextResponse.json(
        {
          success: false,
          error: "皮革外露 与 PVC 保护 不能同时勾选",
        },
        { status: 400 }
      );
    }
    // remarks：capability 关闭 → null；开启但用户没填 → null；否则 trim 后存
    const trimmedRemarks =
      type.capabilities.canHaveRemarks &&
      typeof input.remarks === "string" &&
      input.remarks.trim().length > 0
        ? input.remarks.trim()
        : null;

    // 2026-09-11：订单来源平台。capability 关闭 → null；开启但用户没传 → null；
    // 否则按 PLATFORMS 字典校验（非法 code 抛 400）。
    let finalPlatform: string | null = null;
    // 2026-09-11：渠道订单号（与 platform 配对；trim 后存；空 = null）。
    let finalPlatformOrderNo: string | null = null;
    if (type.capabilities.canPlatform) {
      const raw = input.platform;
      if (raw && raw.trim().length > 0) {
        try {
          validatePlatform(raw);
          finalPlatform = raw;
        } catch (e) {
          return NextResponse.json(
            {
              success: false,
              error: e instanceof Error ? e.message : "平台 code 不合法",
            },
            { status: 400 }
          );
        }
      }
      // 渠道订单号：trim 后存；空串视为未填 → null
      const rawOrderNo = input.platformOrderNo;
      if (typeof rawOrderNo === "string") {
        const trimmed = rawOrderNo.trim();
        finalPlatformOrderNo = trimmed.length > 0 ? trimmed : null;
      }
      // 业务规则：用户填了渠道订单号但没选 platform → 400 提示配对填写
      if (finalPlatformOrderNo && !finalPlatform) {
        return NextResponse.json(
          {
            success: false,
            error: "填写渠道订单号时需同时选择订单来源平台",
          },
          { status: 400 }
        );
      }
    }

    await db
      .update(promptOrder)
      .set({
        engravingText: trimmedEngraving,
        engravingExposed: finalEngravingExposed,
        leatherColor: finalLeatherColor,
        leatherExposed: finalLeatherExposed,
        pvcProtection: finalPvcProtection,
        remarks: trimmedRemarks,
        // 2026-09-11：订单来源平台
        platform: finalPlatform,
        // 2026-09-11：渠道订单号（与 platform 配对）
        platformOrderNo: finalPlatformOrderNo,
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, order.id));

    return NextResponse.json({
      success: true,
      data: {
        engravingText: trimmedEngraving,
        engravingExposed: finalEngravingExposed,
        leatherColor: finalLeatherColor,
        leatherExposed: finalLeatherExposed,
        pvcProtection: finalPvcProtection,
        remarks: trimmedRemarks,
        // 2026-09-11：订单来源平台（PLATFORMS 字典 code）
        platform: finalPlatform,
        // 2026-09-11：渠道订单号
        platformOrderNo: finalPlatformOrderNo,
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
