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
import { previewShare, promptOrder } from "@/db/schema";
import {
  getProductType,
  validateLeatherColor,
  validatePlatform,
} from "@/features/gpt-image/lib/product-catalog";
import { withApiLogging } from "@/lib/api-logger";

import { getPreviewShareByToken } from "../../_lib/preview-share-helpers";

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

/**
 * 2026-09-14：把 capability 校验抽出（promptOrder + preview_share 两路共用）。
 * 返回 final fields 或 throw 一个 { status, error }。
 */
type ConfigInput = z.infer<typeof configureSchema>;

function validateAndFinalize(
  productTypeCode: string | null,
  input: ConfigInput
):
  | {
      ok: true;
      fields: {
        engravingText: string | null;
        engravingExposed: boolean | null;
        leatherColor: string | null;
        leatherExposed: boolean | null;
        pvcProtection: boolean | null;
        remarks: string | null;
        platform: string | null;
        platformOrderNo: string | null;
      };
    }
  | { ok: false; status: number; error: string } {
  if (!productTypeCode) {
    return { ok: false, status: 400, error: "此订单无产品型号，不支持定制" };
  }
  const type = getProductType(productTypeCode);
  if (!type) {
    return {
      ok: false,
      status: 400,
      error: `产品型号不存在：${productTypeCode}`,
    };
  }

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

  const finalLeatherColor = type.capabilities.canLeatherColor
    ? (input.leatherColor ?? null)
    : null;
  try {
    validateLeatherColor(finalLeatherColor);
  } catch (e) {
    return {
      ok: false,
      status: 400,
      error: e instanceof Error ? e.message : "皮革颜色 code 不合法",
    };
  }
  const finalLeatherExposed = type.capabilities.canLeatherExposed
    ? input.leatherExposed === true
    : null;
  const finalPvcProtection = type.capabilities.canPvcProtection
    ? input.pvcProtection === true
    : null;
  if (finalLeatherExposed === true && finalPvcProtection === true) {
    return {
      ok: false,
      status: 400,
      error: "皮革外露 与 PVC 保护 不能同时勾选",
    };
  }
  const trimmedRemarks =
    type.capabilities.canHaveRemarks &&
    typeof input.remarks === "string" &&
    input.remarks.trim().length > 0
      ? input.remarks.trim()
      : null;

  let finalPlatform: string | null = null;
  let finalPlatformOrderNo: string | null = null;
  if (type.capabilities.canPlatform) {
    const rawPlatform = input.platform;
    if (rawPlatform && rawPlatform.trim().length > 0) {
      try {
        validatePlatform(rawPlatform);
        finalPlatform = rawPlatform;
      } catch (e) {
        return {
          ok: false,
          status: 400,
          error: e instanceof Error ? e.message : "平台 code 不合法",
        };
      }
    }
    const rawOrderNo = input.platformOrderNo;
    if (typeof rawOrderNo === "string") {
      const trimmed = rawOrderNo.trim();
      finalPlatformOrderNo = trimmed.length > 0 ? trimmed : null;
    }
    if (finalPlatformOrderNo && !finalPlatform) {
      return {
        ok: false,
        status: 400,
        error: "填写渠道订单号时需同时选择订单来源平台",
      };
    }
  }

  return {
    ok: true,
    fields: {
      engravingText: trimmedEngraving,
      engravingExposed: finalEngravingExposed,
      leatherColor: finalLeatherColor,
      leatherExposed: finalLeatherExposed,
      pvcProtection: finalPvcProtection,
      remarks: trimmedRemarks,
      platform: finalPlatform,
      platformOrderNo: finalPlatformOrderNo,
    },
  };
}

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

    // 2026-09-14：preview 流 6 步工作台 —— preview_share 优先。
    // 允许状态：pending / uploaded / generating / candidates_ready / selected。
    // preview 流在 confirm 之前 spec 全程可改；confirm 后变终态。
    const preview = await getPreviewShareByToken(token);
    if (preview) {
      const allowedStatuses = new Set([
        "pending",
        "uploaded",
        "generating",
        "candidates_ready",
        "selected",
      ]);
      if (!allowedStatuses.has(preview.status)) {
        return NextResponse.json(
          {
            success: false,
            error: `当前状态（${preview.status}）不允许修改定制信息`,
          },
          { status: 400 }
        );
      }
      const result = validateAndFinalize(preview.productTypeCode, input);
      if (!result.ok) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: result.status }
        );
      }
      await db
        .update(previewShare)
        .set({
          ...result.fields,
          updatedAt: new Date(),
        })
        .where(eq(previewShare.id, preview.id));
      return NextResponse.json({
        success: true,
        data: result.fields,
      });
    }

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

    const result = validateAndFinalize(order.productTypeCode, input);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    await db
      .update(promptOrder)
      .set({
        ...result.fields,
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, order.id));

    return NextResponse.json({
      success: true,
      data: result.fields,
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
