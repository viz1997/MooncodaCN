"use server";

/**
 * /image-gen 「分享给客户预览」server action（2026-09-13）
 *
 * 业务流程（代理商 demo 流）：
 *   1. 代理商在 /image-gen 生成预览图 → 结果卡点「分享给客户预览」
 *   2. SpecModal 选 productSize/accessoryCode/engraving 等规格（同 demo 下单）
 *   3. 调本 action → 创建 preview_share 凭证（status='pending'）：
 *        **不**写 promptOrder —— 分享链接 ≠ 下单
 *        expiresAt = now + 7 天
 *        creditsCharged / credits_breakdown 提前算好（避免客人确认时重算漂移）
 *   4. 不扣代理商 credit（preview 凭证是占位，客人确认后才扣）
 *   5. 返回 { shareId, orderNo, token, creditsToChargeOnConfirm }
 *      —— 前端拿 token 拼 /p/{token} 出 ShareCard QR 给客户扫码
 *
 * 客人侧流程（/p/[token]）：
 *   - 客人免登录打开 /p/{token} → page.tsx 入口先查 preview_share
 *     → 命中走 PreviewConfirmStep（共享 demo 流 spec 字段）
 *   - 选 cell（grid 模式）/ 直接确认（1 candidate 模式）→ POST guest-submit
 *   - guest-submit 路由按 token 查 preview_share → 扣 createdBy credit
 *     → **新建** promptOrder(status='SELECTED', selections=[selectedCell])
 *     → UPDATE preview_share.status='confirmed' + linkedOrderId=新订单 id
 *   - 防重：preview_share.status='confirmed' → 409 Conflict
 *
 * 与 submitImageGenDemoAction 的关系：
 *   - submitImageGenDemoAction：代理商自己确认 demo 流，扣 credit 立刻写 SELECTED
 *   - createPreviewShareAction：代理商先把 demo 发给客户看，不扣 credit，
 *     等客户在 /p/[token] 上「确认」后由 guest-submit 扣 credit 转 SELECTED
 *   - 两者共用 preview-helpers.ts fillDefaultsByTemplate()：spec 校验 + 字典
 *     合法性 + capability-gated 处理 engraving / leather / pvc / remarks /
 *     platform 完全一致（对账口径统一）
 *
 * schema 与 submitImageGenDemoAction 一致：templateId / referenceImageUrl /
 * demoPreviewUrl / productTypeCode / productSize / accessoryCode / engravingText /
 * engravingExposed / leatherColor / leatherExposed / pvcProtection / remarks /
 * platform / platformOrderNo / selectedCell。
 */

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { previewShare, promptTemplate } from "@/db/schema";
import { consumeCredits } from "@/features/credits/core";
import { InsufficientCreditsError } from "@/features/credits/errors";
import { generateOrderToken } from "@/features/gpt-image/lib/generation-service";
import { findEffect } from "@/features/image-gen/lib/effects-store";
import {
  fillDefaultsByTemplate,
  generatePreviewOrderNo,
} from "@/features/image-gen/lib/preview-helpers";
import { computePromptOrderCredits } from "@/features/image-gen/lib/price-calculator";
import { protectedAction } from "@/lib/safe-action";

const withPreviewAction = (name: string) =>
  protectedAction.metadata({ action: `imageGen.preview.${name}` });

// preview 凭证 7 天过期（默认）
const PREVIEW_EXPIRES_DAYS = 7;
// 重新生成次数上限（2026-09-14 MVP 硬编码 3，PM 拍板后改 admin 可配置）
const REGENERATE_LIMIT = 3;

const createPreviewSchema = z.object({
  templateId: z.string().min(1),
  referenceImageUrl: z.string().url(),
  demoPreviewUrl: z.string().url(),
  productTypeCode: z.string().min(1).max(8).nullable().optional(),
  productSize: z.string().min(1).max(8).nullable().optional(),
  accessoryCode: z.string().min(1).max(16).nullable().optional(),
  engravingText: z.string().trim().max(40).nullable().optional(),
  engravingExposed: z.boolean().nullable().optional(),
  leatherColor: z.string().min(1).max(32).nullable().optional(),
  leatherExposed: z.boolean().nullable().optional(),
  pvcProtection: z.boolean().nullable().optional(),
  remarks: z.string().trim().min(0).max(500).nullable().optional(),
  platform: z.string().min(1).max(32).nullable().optional(),
  platformOrderNo: z.string().trim().min(0).max(64).nullable().optional(),
  /**
   * 代理商在 demo 流宫格里选的 cell（仅 grid+candidateCount>1 时必填）。
   * preview 不强制（客人可在 /p/[token] 改选），这里只用作"代理商初值"。
   * 1 candidate / separate 模式 → 强制 0。
   */
  selectedCell: z.number().int().min(0).max(8).nullable().optional(),
});

/**
 * /image-gen demo 流「分享给客户预览」创建凭证：
 * 校验 → 算积分（不扣）→ 写 preview_share（status='pending'）→ 返 token
 */
export const createPreviewShareAction = withPreviewAction("create")
  .schema(createPreviewSchema)
  .action(async ({ parsedInput, ctx }) => {
    // 1. 查模板（与 submitImageGenDemoAction 同样路径：productEffect → promptTemplate）
    const effect = await findEffect(parsedInput.templateId);
    if (!effect || effect.status !== "active") {
      // eslint-disable-next-line no-console
      console.error("[preview-share] effect lookup failed", {
        templateId: parsedInput.templateId,
        effect,
      });
      throw new Error("模板不存在或已停用");
    }
    if (!effect.promptTemplateId) {
      // eslint-disable-next-line no-console
      console.error("[preview-share] effect has no promptTemplateId", {
        templateId: parsedInput.templateId,
      });
      throw new Error("模板未关联提示词模板，请联系管理员补一个");
    }
    const template = await db.query.promptTemplate.findFirst({
      where: and(
        eq(promptTemplate.id, effect.promptTemplateId),
        eq(promptTemplate.isActive, true)
      ),
      columns: {
        id: true,
        name: true,
        price: true,
        candidateCount: true,
        outputMode: true,
        allowedSizes: true,
        allowedAccessories: true,
      },
    });
    if (!template) {
      // eslint-disable-next-line no-console
      console.error("[preview-share] template lookup failed", {
        promptTemplateId: effect.promptTemplateId,
      });
      throw new Error("模板不存在或已停用");
    }

    // 2. fillDefaultsByTemplate —— 与 demo 下单共用同套 spec 校验
    let filledSpec: ReturnType<typeof fillDefaultsByTemplate>;
    try {
      filledSpec = fillDefaultsByTemplate(
        {
          allowedSizes: template.allowedSizes,
          allowedAccessories: template.allowedAccessories,
        },
        {
          productTypeCode: parsedInput.productTypeCode ?? null,
          productSize: parsedInput.productSize ?? null,
          accessoryCode: parsedInput.accessoryCode ?? null,
          engravingText: parsedInput.engravingText ?? null,
          engravingExposed: parsedInput.engravingExposed ?? null,
          leatherColor: parsedInput.leatherColor ?? null,
          leatherExposed: parsedInput.leatherExposed ?? null,
          pvcProtection: parsedInput.pvcProtection ?? null,
          remarks: parsedInput.remarks ?? null,
          platform: parsedInput.platform ?? null,
          platformOrderNo: parsedInput.platformOrderNo ?? null,
        }
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[preview-share] fillDefaultsByTemplate failed:", {
        err: err instanceof Error ? err.message : String(err),
        parsedInput,
        template: { id: template.id, name: template.name },
      });
      throw err;
    }
    const {
      finalProductSize,
      finalAccessoryCode,
      finalEngravingText,
      finalEngravingExposed,
      finalLeatherColor,
      finalLeatherExposed,
      finalPvcProtection,
      finalRemarks,
      finalPlatform,
      finalPlatformOrderNo,
    } = filledSpec;

    // 3. 算积分（仅记录到 preview_share.creditsCharged，preview 暂不扣 credit）
    const basePrice = template.price ?? 0;
    let priceResult: Awaited<ReturnType<typeof computePromptOrderCredits>>;
    try {
      priceResult = await computePromptOrderCredits(template.id, basePrice, {
        productTypeCode: parsedInput.productTypeCode ?? null,
        productSize: finalProductSize,
        accessoryCode: finalAccessoryCode,
        leatherColor: finalLeatherColor,
        leatherExposed: finalLeatherExposed,
        pvcProtection: finalPvcProtection,
      });
      // 上一步返回的 priceResult.totalCredits 即为本单总价（基础价 + 加价）。
      // 后续 credit 锁定 = totalCredits × (1 + regenerateLimit)。
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[preview-share] computePromptOrderCredits failed:", {
        err: err instanceof Error ? err.message : String(err),
        parsedInput,
        template: { id: template.id, name: template.name },
        filledSpec: filledSpec,
      });
      throw err;
    }
    const { totalCredits, breakdown } = priceResult;
    const creditsBreakdownJson = JSON.stringify(breakdown);

    // 4. 2026-09-14 升级：预扣代理商 credit（creditsLocked = basePrice × (1 + regenerateLimit)）。
    //    客人走完 6 步 regenerate 不再真扣 balance，终态 confirm 才扣 basePrice。
    //    totalCredits=0（免费模板）→ lockAmount=0，跳过预扣。
    const lockAmount = totalCredits * (1 + REGENERATE_LIMIT);
    if (lockAmount > 0) {
      try {
        await consumeCredits({
          userId: ctx.userId,
          amount: lockAmount,
          serviceName: "image-gen-preview-lock",
          description: `锁定 ${lockAmount} 积分（凭证待创建，含 ${REGENERATE_LIMIT} 次重新生成预算）`,
          metadata: {
            trigger: "preview_lock",
            basePrice: totalCredits,
            regenerateLimit: REGENERATE_LIMIT,
          },
        });
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          throw new Error(
            `代理商积分不足（需要 ${err.required}，当前可用 ${err.available}），无法创建预览凭证`
          );
        }
        throw err;
      }
    }

    // 5. 写 preview_share 凭证（**不**写 promptOrder —— 分享链接 ≠ 下单）
    const token = generateOrderToken();
    const orderNo = generatePreviewOrderNo();
    const expiresAt = new Date(
      Date.now() + PREVIEW_EXPIRES_DAYS * 24 * 60 * 60 * 1000
    );
    const now = new Date();

    const candidatesJson = JSON.stringify([[parsedInput.demoPreviewUrl]]);
    // 2026-09-14：把代理商 demo 阶段的 referenceImageUrl 当作客人侧 uploadedImages[0]
    // 写库 —— 让客户打开链接直接看到代理商生成的效果图（SelectStep 渲染时通过
    // uploadedImages[0] 拿原图缩略图、通过 candidates[0][0] 拿效果图）。
    //
    // 历史 bug：之前只写 status="pending" + uploadedImages=null，PreviewOrderContent
    // 渲染 UploadStep（要求客户上传图），候选图藏在 candidates 列但 PENDING 状态下
    // 不渲染 SelectStep → 客户根本看不到代理商生成的效果图。
    //
    // 客人后续若要传自己的图重新生成：/upload 路由（preview 分支）会按 status=
    // "uploaded"/"failed" 覆盖 uploadedImages[0]（preview 是单批单图硬编码，无追加）。
    const initialUploadedImages = JSON.stringify([parsedInput.referenceImageUrl]);

    try {
      const [created] = await db
        .insert(previewShare)
        .values({
          id: nanoid(),
          orderNo,
          token,
          templateId: template.id,
          // 原图 / 效果图 R2 URL（demo 阶段已生成）
          referenceImageUrl: parsedInput.referenceImageUrl,
          demoPreviewUrl: parsedInput.demoPreviewUrl,
          // 候选集（[[demoPreviewUrl]]）—— /api/orders/[token]/candidates/0/0
          // 路由按 token 查 preview_share 返图
          candidates: candidatesJson,
          // 2026-09-14：客人侧 uploadedImages[0] 直接填代理商 referenceImageUrl，
          // 跳过 PENDING + upload 阶段；详见上方注释。
          uploadedImages: initialUploadedImages,
          uploadedAt: now,
          // preview 流硬编码单批单图：imagesPerUpload=1, uploadCount=1
          // 显式 set 而非依赖 schema default —— 防御 schema migration 默认值漂移
          imagesPerUpload: 1,
          uploadCount: 1,
          // 客人确认时由 guest-confirm 路由写入
          selectedCell: null,
          // 规格字段（CONFIRMED 时镜像写入新建 promptOrder）
          productTypeCode: parsedInput.productTypeCode ?? null,
          productSize: finalProductSize,
          accessoryCode: finalAccessoryCode,
          engravingText: finalEngravingText,
          engravingExposed: finalEngravingExposed,
          leatherColor: finalLeatherColor,
          leatherExposed: finalLeatherExposed,
          pvcProtection: finalPvcProtection,
          remarks: finalRemarks,
          platform: finalPlatform,
          platformOrderNo: finalPlatformOrderNo,
          // 提前算好的应扣积分（客人确认时直接读，避免重算漂移）
          creditsCharged: totalCredits,
          creditsBreakdown: creditsBreakdownJson,
          // 2026-09-14：credit 锁定字段
          creditsLocked: lockAmount,
          creditsLockedAt: lockAmount > 0 ? now : null,
          regenerateLimit: REGENERATE_LIMIT,
          usedRegenerateCount: 0,
          // 2026-09-14：状态机直接从 candidates_ready 起步（demo 图已生成），
          // 客人侧 SelectStep 渲染代理商生成的候选图。后续路径：
          //   selected → confirmed（客人直接确认）/ 客人上传新图后走
          //   uploaded → generating → candidates_ready → ...
          status: "candidates_ready",
          generatedAt: now,
          createdBy: ctx.userId,
          // CONFIRMED 后指向新建 promptOrder.id（创建时 null）
          linkedOrderId: null,
          confirmedAt: null,
          expiresAt,
        })
        .returning({ id: previewShare.id });

      if (!created) throw new Error("创建预览凭证失败");

      revalidatePath("/image-gen");

      return {
        // preview_share.id —— UI 层不区分"订单/凭证"实体，统一叫 orderId
        orderId: created.id,
        orderNo,
        token,
        creditsToChargeOnConfirm: totalCredits,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[preview-share] insert preview_share failed:", {
        err: err instanceof Error ? err.message : String(err),
        // eslint-disable-next-line no-console
        detail: err instanceof Error ? err.stack : undefined,
        orderNo,
        token,
        templateId: template.id,
        createdBy: ctx.userId,
      });
      throw err;
    }
  });
