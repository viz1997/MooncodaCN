/**
 * 公共免登录 - preview 凭证客人「终态确认下单」（2026-09-14）
 *
 * POST /api/orders/[token]/guest-confirm
 *
 * body: `{ selectedCell?: number }` —— 选中的 cell 索引（grid 多 cell 模式）
 *
 * ## 业务定位（2026-09-14 preview 流升级）
 *
 * 之前 `guest-submit` 是「一次性确认」—— 客人扫码进来只看预览图 + 点确认。
 * 现在 `/p/[token]` 走完整 6 步工作台（upload → generate → select → regenerate
 * → configure → confirm）。本路由只承担最后一步「确认下单」。
 *
 * 上传环节走 `POST /api/orders/[token]/upload`（preview 分支已经接好），选择
 * 环节走 `POST /api/orders/[token]/select`（preview 分支已经接好），配置走
 * `POST /api/orders/[token]/configure`（preview 分支已经接好）。本路由只在
 * 终态把 preview_share 转成正式 promptOrder + 释放多余的 credit 锁定。
 *
 * ## 状态机校验
 *
 *   - status='selected' + expiresAt > now → 可提交（客人已选 cell）
 *   - status='confirmed' → 409 防重，返回 linkedOrderId
 *   - status='pending' / 'uploaded' / 'generating' / 'candidates_ready' →
 *     400（客人还没走完流程）
 *   - status='cancelled' / 'expired' → 410（凭证已失效）
 *   - status='failed' → 400（生成失败，需先 regenerate 复活）
 *
 * ## Credit 处理
 *
 * 升级后 createPreviewShareAction 已预扣 `creditsLocked = basePrice × (1 + regenerateLimit)`
 * （含 regenerate 预算）。本路由终态时：
 *   - 扣 `basePrice`（用 computePromptOrderCredits 重新算，避免预览价 / 实际价漂移）
 *   - 释放剩余 = `creditsLocked - basePrice`（grantCredits refund）
 *
 * 防重：status='confirmed' 直接 409，不重复扣 / 释放。
 *
 * ## 错误码
 *
 * - 404 凭证不存在
 * - 410 链接已过期
 * - 409 已确认（confirmed）→ 返回 linkedOrderId
 * - 400 状态异常 / 校验失败
 * - 402 代理商积分不足（理论上不会：createPreviewShare 时已预扣 ≥ basePrice，但
 *   若 regenerateLimit=0 / 取消后又改价格等边界条件，confirm 时 basePrice 可能
 *   高于 creditsLocked。此时 402 + "代理商积分不足"）
 * - 500 服务端异常
 */

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { previewShare, promptOrder } from "@/db/schema";
import { consumeCredits } from "@/features/credits/core";
import { InsufficientCreditsError } from "@/features/credits/errors";
import { grantCredits } from "@/features/credits/grant";
import { generateOrderToken } from "@/features/gpt-image/lib/generation-service";
import { computePromptOrderCredits } from "@/features/image-gen/lib/price-calculator";
import { withApiLogging } from "@/lib/api-logger";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * 生成订单号 IG-YYYYMMDD-XXXXXX（IG = ImageGen, XXXXXX = nanoid 6 位大写）。
 * 与 submit-image-gen-demo.ts 的私有 generateOrderNo 实现一致 —— 本地复刻一份
 * 避免跨 server action 文件 import 常量（next-safe-action 限制）。
 */
function generatePromptOrderNo(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 8);
  const rand = nanoid(6).toUpperCase();
  return `IG-${ts}-${rand}`;
}

async function postHandler(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      selectedCell?: unknown;
    };

    // 1. 校验 selectedCell（可选，1 candidate 模式强制 0）
    let selectedCell: number;
    if (
      typeof body.selectedCell === "number" &&
      Number.isInteger(body.selectedCell)
    ) {
      if (body.selectedCell < 0 || body.selectedCell > 8) {
        return NextResponse.json(
          { success: false, error: "selectedCell 超出范围（应在 0-8 之间）" },
          { status: 400 }
        );
      }
      selectedCell = body.selectedCell;
    } else if (body.selectedCell === undefined || body.selectedCell === null) {
      // 兼容老客户端：未传 → 默认 0（preview 流 batchCount=1，cell 默认第 0 个）
      selectedCell = 0;
    } else {
      return NextResponse.json(
        { success: false, error: "selectedCell 必须是 0-8 的整数" },
        { status: 400 }
      );
    }

    // 2. 查 preview_share（不是 promptOrder —— 分享链接 ≠ 下单）
    const share = await db.query.previewShare.findFirst({
      where: eq(previewShare.token, token),
      with: {
        template: {
          columns: {
            id: true,
            name: true,
            candidateCount: true,
            outputMode: true,
            price: true,
          },
        },
      },
    });
    if (!share) {
      return NextResponse.json(
        { success: false, error: "分享链接无效或已被删除" },
        { status: 404 }
      );
    }

    // 3. 防重：confirmed 终态 → 409 + 返回 linkedOrderId
    if (share.status === "confirmed") {
      return NextResponse.json(
        {
          success: false,
          error: "此预览凭证已被确认下单，无需重复提交",
          data: {
            status: share.status,
            linkedOrderId: share.linkedOrderId,
            confirmedAt: share.confirmedAt?.toISOString() ?? null,
            alreadyConfirmed: true,
          },
        },
        { status: 409 }
      );
    }

    // 4. 已过期 → 410
    if (
      share.status === "expired" ||
      (share.expiresAt && share.expiresAt.getTime() < Date.now())
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "分享链接已过期，请联系代理商重新分享",
          data: {
            status: "expired",
            expiresAt: share.expiresAt?.toISOString() ?? null,
          },
        },
        { status: 410 }
      );
    }

    // 5. 必须是 selected —— 客人已走完 6 步
    if (share.status !== "selected") {
      return NextResponse.json(
        {
          success: false,
          error: `当前状态为 ${share.status}，请先完成上传与选择`,
        },
        { status: 400 }
      );
    }

    // 6. 校验 selectedCell 与 template candidateCount 兼容性
    const templateCandidateCount = share.template.candidateCount ?? 1;
    if (templateCandidateCount <= 1 && selectedCell !== 0) {
      return NextResponse.json(
        {
          success: false,
          error: "该预览只有 1 个候选，selectedCell 必须为 0",
        },
        { status: 400 }
      );
    }
    if (selectedCell >= templateCandidateCount) {
      return NextResponse.json(
        {
          success: false,
          error: `selectedCell ${selectedCell} 超出范围（应在 0-${templateCandidateCount - 1} 之间）`,
        },
        { status: 400 }
      );
    }

    // 7. 校验代理商有 createdBy（preview 凭证必须由代理商创建）
    if (!share.createdBy) {
      return NextResponse.json(
        {
          success: false,
          error: "预览凭证缺失代理商身份，无法扣积分",
        },
        { status: 500 }
      );
    }

    // 8. 算 basePrice（与 createPromptOrderAction 一致：computePromptOrderCredits
    //    按 promptTemplate + promptTemplatePrice 加价规则计算）
    const templateBasePrice = share.template.price ?? 0;
    const priceCalc = await computePromptOrderCredits(
      share.template.id,
      templateBasePrice,
      {
        productTypeCode: share.productTypeCode,
        productSize: share.productSize,
        accessoryCode: share.accessoryCode,
        leatherColor: share.leatherColor,
        leatherExposed: share.leatherExposed,
        pvcProtection: share.pvcProtection,
      }
    );
    const basePrice = priceCalc.totalCredits;
    const creditsLocked = share.creditsLocked ?? 0;
    const refundAmount = Math.max(0, creditsLocked - basePrice);

    // 9. 扣 basePrice（consumeCredits 走 FIFO 真扣 balance）
    //    理论上不会 InsufficientCredits —— createPreviewShare 时 creditsLocked ≥ basePrice
    //    （lockAmount = basePrice × (1 + regenerateLimit)）。但 regenerateLimit=0 或
    //    价格上调等边界 → confirm 时 basePrice > creditsLocked → InsufficientCredits
    //    暴露给客人。
    if (basePrice > 0) {
      try {
        await consumeCredits({
          userId: share.createdBy,
          amount: basePrice,
          serviceName: "image-gen-preview-confirm",
          description: `${share.template.name} = ${basePrice} 积分（预览确认）`,
          metadata: {
            previewShareId: share.id,
            previewOrderNo: share.orderNo,
            templateId: share.template.id,
            templateName: share.template.name,
            trigger: "guest_confirm",
            usedRegenerateCount: share.usedRegenerateCount ?? 0,
            creditsLocked,
            basePrice,
            refundAmount,
          },
        });
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          return NextResponse.json(
            {
              success: false,
              error: `代理商积分不足（需要 ${err.required}，当前可用 ${err.available}），请联系代理商充值后再分享预览`,
              data: {
                agentHasInsufficientCredits: true,
                required: err.required,
                available: err.available,
              },
            },
            { status: 402 }
          );
        }
        throw err;
      }
    }

    // 10. 释放剩余 credit（grantCredits refund）—— 包括未使用的 regenerate 预算
    if (refundAmount > 0) {
      try {
        await grantCredits({
          userId: share.createdBy,
          amount: refundAmount,
          sourceType: "refund",
          transactionType: "refund",
          debitAccount: "SYSTEM:preview_release",
          description: `预览确认完成，释放多余锁定积分（凭证 ${share.orderNo}）`,
          metadata: {
            trigger: "preview_release",
            previewShareId: share.id,
            previewOrderNo: share.orderNo,
            creditsLocked,
            basePrice,
            refundAmount,
          },
        });
      } catch (err) {
        logger.error(
          { err, previewShareId: share.id, refundAmount },
          "guest-confirm: 释放剩余积分失败"
        );
        // 不让 confirm 翻车：释放失败时 creditsLocked 字段置 0 让后续 reconcile 兜底
      }
    }

    // 11. NEW INSERT promptOrder（status='SELECTED'）
    //     preview 流 batchCount=1：uploadedImages = [referenceImageUrl + 客人上传的图]
    //     candidates = preview 流 4 张生成图（cell 选一）
    //     selections = [selectedCell]
    const now = new Date();
    const selectionsJson = JSON.stringify([selectedCell]);
    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      null;

    // 解析客人上传的原图列表（preview_share.uploadedImages 是 JSON 数组）
    let uploadedImagesArr: string[] = [];
    if (share.uploadedImages) {
      try {
        const parsed = JSON.parse(share.uploadedImages);
        if (Array.isArray(parsed)) {
          uploadedImagesArr = parsed.filter(
            (s): s is string => typeof s === "string"
          );
        }
      } catch {
        // ignore
      }
    }

    const [newOrder] = await db
      .insert(promptOrder)
      .values({
        id: nanoid(),
        orderNo: generatePromptOrderNo(),
        token: generateOrderToken(),
        templateId: share.template.id,
        // preview 阶段客人已确认规格，直接落 promptOrder
        productTypeCode: share.productTypeCode,
        productSize: share.productSize,
        accessoryCode: share.accessoryCode,
        engravingText: share.engravingText,
        engravingExposed: share.engravingExposed,
        leatherColor: share.leatherColor,
        leatherExposed: share.leatherExposed,
        pvcProtection: share.pvcProtection,
        remarks: share.remarks,
        platform: share.platform,
        platformOrderNo: share.platformOrderNo,
        // status=SELECTED：终态，已确认提交
        status: "SELECTED",
        // preview 流 batchCount=1
        uploadCount: share.uploadCount ?? 1,
        imagesPerUpload: share.imagesPerUpload ?? 1,
        regenerateLimit: 0, // preview 流不允许再生图（客人终态已选）
        uploadedImages: JSON.stringify(uploadedImagesArr),
        uploadedAt: share.uploadedAt ?? share.createdAt,
        generatedAt: share.generatedAt,
        candidates: share.candidates,
        selections: selectionsJson,
        selectedAt: now,
        selectedIndex: selectedCell,
        // 镜像终态扣款明细
        creditsCharged: basePrice,
        creditsBreakdown: priceCalc.breakdown
          ? JSON.stringify(priceCalc.breakdown)
          : null,
        // preview 凭证创建的订单 → createdBy=代理商
        createdBy: share.createdBy,
        agentId: null,
      })
      .returning({ id: promptOrder.id, orderNo: promptOrder.orderNo });

    if (!newOrder) {
      throw new Error("新建订单失败");
    }

    // 12. UPDATE preview_share → confirmed + linkedOrderId + 清零 creditsLocked
    await db
      .update(previewShare)
      .set({
        status: "confirmed",
        linkedOrderId: newOrder.id,
        selectedCell,
        confirmedAt: now,
        confirmedByIp: clientIp,
        creditsLocked: 0,
        updatedAt: now,
      })
      .where(eq(previewShare.id, share.id));

    return NextResponse.json({
      success: true,
      message:
        basePrice > 0
          ? `已确认下单，扣除代理商 ${basePrice} 积分${refundAmount > 0 ? `，释放 ${refundAmount} 积分` : ""}。`
          : "已确认下单。",
      data: {
        status: "confirmed" as const,
        previewOrderNo: share.orderNo,
        orderId: newOrder.id,
        orderNo: newOrder.orderNo,
        token: null as string | null,
        selections: [selectedCell],
        selectedAt: now.toISOString(),
        creditsCharged: basePrice,
        refundedCredits: refundAmount,
        linkedOrderId: newOrder.id,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "提交失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler);
