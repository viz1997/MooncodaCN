"use server";

/**
 * /image-gen 「分享给客户预览」server action（2026-09-13）
 *
 * 业务流程（代理商 demo 流）：
 *   1. 代理商在 /image-gen 生成预览图 → 结果卡点「分享给客户预览」
 *   2. SpecModal 选 productSize/accessoryCode/engraving 等规格（同 demo 下单）
 *   3. 调本 action → 创建 promptOrder：
 *        status=CANDIDATES_READY（不是 SELECTED —— 待客人确认）
 *        isPreviewShare=true（标记为 preview 凭证，不是普通订单）
 *        regenerateLimit=0（preview 不允许再生图，规格已由代理商定好）
 *        selections=null（客人还没在 /p/[token] 选 cell）
 *   4. 不扣代理商 credit（demo 下单扣的是代理商的；preview 是占位凭证，等客人
 *      确认后再扣，由 /api/orders/[token]/guest-submit 路由负责）
 *   5. 返回 { orderId, orderNo, token } —— 前端拿到 token 拼 /p/{token} 出
 *      ShareCard QR 给客户扫码
 *
 * 客人侧流程（/p/[token]）：
 *   - 客人免登录打开 /p/{token] → 看到预览图 + 「确认下单」按钮
 *   - 选 cell（grid 模式）/ 直接确认（1 candidate 模式）→ POST guest-submit
 *   - guest-submit 校验 isPreviewShare+CANDIDATES_READY → 扣 createdBy (代理商)
 *     credit → UPDATE status=SELECTED + selections + selectedAt
 *   - 防重：再次 submit 时 status=SELECTED → 409 Conflict
 *
 * 与 submitImageGenDemoAction 的关系：
 *   - submitImageGenDemoAction：代理商自己确认 demo 流，扣 credit 立刻写 SELECTED
 *   - createPreviewShareAction：代理商先把 demo 发给客户看，不扣 credit，等客户
 *     在 /p/[token] 上「确认」后才走 guest-submit 扣 credit 转 SELECTED
 *   - 两者共用 preview-helpers.ts fillDefaultsByTemplate()：spec 校验 + 字典
 *     合法性 + capability-gated 处理 engraving / leather / pvc / remarks /
 *     platform 完全一致（对账口径统一）
 *
 * schema 与 submitImageGenDemoAction 一致：templateId / referenceImageUrl /
 * demoPreviewUrl / productTypeCode / productSize / accessoryCode / engravingText /
 * engravingExposed / leatherColor / leatherExposed / pvcProtection / remarks /
 * platform / platformOrderNo / selectedCell。selectedCell 这里仅用于"代理商已选
 * 哪个 cell 写入 preview 的初值"——客人可以在 /p/[token] 改选。
 */

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { promptOrder, promptTemplate } from "@/db/schema";
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
 * 校验 → 算积分（不扣）→ 写 promptOrder（CANDIDATES_READY + isPreviewShare=true
 * + regenerateLimit=0 + selections=null）→ 返 token
 */
export const createPreviewShareAction = withPreviewAction("create")
  .schema(createPreviewSchema)
  .action(async ({ parsedInput, ctx }) => {
    // 1. 查模板（与 submitImageGenDemoAction 同样路径：productEffect → promptTemplate）
    const effect = await findEffect(parsedInput.templateId);
    if (!effect || effect.status !== "active") {
      throw new Error("模板不存在或已停用");
    }
    if (!effect.promptTemplateId) {
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
    if (!template) throw new Error("模板不存在或已停用");

    // 2. fillDefaultsByTemplate —— 与 demo 下单共用同套 spec 校验
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
    } = fillDefaultsByTemplate(
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

    // 3. 算积分（仅记录到 promptOrder.creditsCharged，preview 暂不扣 credit）
    const basePrice = template.price ?? 0;
    const priceResult = await computePromptOrderCredits(
      template.id,
      basePrice,
      {
        productTypeCode: parsedInput.productTypeCode ?? null,
        productSize: finalProductSize,
        accessoryCode: finalAccessoryCode,
        leatherColor: finalLeatherColor,
        leatherExposed: finalLeatherExposed,
        pvcProtection: finalPvcProtection,
      }
    );
    const { totalCredits, breakdown } = priceResult;
    const creditsBreakdownJson = JSON.stringify(breakdown);

    // 4. 写 promptOrder（CANDIDATES_READY + isPreviewShare=true）
    const token = generateOrderToken();
    const orderNo = generatePreviewOrderNo();

    const candidatesJson = JSON.stringify([[parsedInput.demoPreviewUrl]]);

    const [created] = await db
      .insert(promptOrder)
      .values({
        id: nanoid(),
        orderNo,
        templateId: template.id,
        token,
        // 2026-09-13：preview 凭证关键三标志：status=CANDIDATES_READY（未确认）+
        // isPreviewShare=true（与 demo 下单 SELECTED 区分）+ regenerateLimit=0
        // （代理商已填规格，客人不能再改）。guest-submit 路由按这三个标志判定
        // 是否允许"扣 credit 转 SELECTED"。
        status: "CANDIDATES_READY",
        uploadCount: 1,
        imagesPerUpload: 1,
        regenerateLimit: 0,
        uploadedImages: JSON.stringify([parsedInput.referenceImageUrl]),
        uploadedAt: new Date(),
        generatedAt: new Date(),
        candidates: candidatesJson,
        // selections=null —— preview 客人还没选 cell，guest-submit 时写入。
        // 旧 demo 一键下单会写 [selectedCell]，preview 流刻意区分。
        selections: null,
        selectedAt: null,
        selectedIndex: null,
        createdBy: ctx.userId,
        agentId: null,
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
        // 2026-09-13：preview 凭证 creditsCharged / creditsBreakdown 提前算好
        // （用 template.price + matching rules），写入 promptOrder；客人确认
        // 时 guest-submit 路由直接读这俩字段扣 credit，避免客人确认时再重算
        // 价格（template.price 或 matching rule 改动会造成预览价 / 实际价漂移）。
        creditsCharged: totalCredits,
        creditsBreakdown: creditsBreakdownJson,
        isPreviewShare: true,
      })
      .returning({ id: promptOrder.id });

    if (!created) throw new Error("创建预览凭证失败");

    revalidatePath("/image-gen");
    revalidatePath("/image-gen/orders");

    return {
      orderId: created.id,
      orderNo,
      token,
      creditsToChargeOnConfirm: totalCredits,
    };
  });
