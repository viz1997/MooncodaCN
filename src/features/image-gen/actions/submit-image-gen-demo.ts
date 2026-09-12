"use server";

/**
 * /image-gen demo 一键下单 server action（2026-09-09）
 *
 * 用户在 /image-gen demo 流里跑了一张预览图，点结果卡上「选择此效果下单」
 * → SpecModal 选 productSize/accessoryCode/engraving → 确认后调这个 action：
 *
 *   1. 校验模板存在 + active
 *   2. 校验三件套（用 validateProductSpec，全套 null 也合法）
 *   3. 扣个人 credit（template.price=0 跳过；不足抛 InsufficientCreditsError）
 *   4. 写 promptOrder (SELECTED) + 把 demo 预览图 URL 当唯一候选
 *   5. revalidatePath + 返回 { orderId, orderNo, token, creditsConsumed }
 *
 * 设计要点：
 * - **不走异步生图**：用户已经「看过 demo 预览图 + 点了下单」，再跑一遍异步
 *   生成是浪费 token，且 demo 风格强调「提交即完成」。服务端也不需要候选候选
 *   选择轮询，状态直接 SELECTED。
 * - **candidates 写 1 条**：candidates = [[previewUrl]]（外层 imageIdx=0，
 *   内层 candIdx=0），selections = "[0]"（锁定第 0 张第 0 个候选）。admin
 *   后台看到的就是 demo 预览图本身。
 * - **productSpec 三件套**：与 createOrderFromImageGenAction 一致——全 null
 *   通过；非空必须按 catalog 字典合法。
 * - **agentId=null**：代理商概念已砍，订单 createdBy=ctx.userId。
 *
 * 与 createOrderFromImageGenAction + submitPublicOrderAction 两步走的关系：
 *   - 那两个 action 是「未来手动 6 步工作台」备用（用户从头选模板 → 选规格
 *     → 上传 → 生成 → 选候选 → 提交）
 *   - 本 action 是 demo 流「提交即完成」一键路径
 *   - 两者共存：手动流程仍走前者，demo 流程走本 action
 */

import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { promptOrder, promptTemplate } from "@/db/schema";
import {
  consumeCredits,
  InsufficientCreditsError,
} from "@/features/credits/core";
import { generateOrderToken } from "@/features/gpt-image/lib/generation-service";
import {
  getAccessory,
  getLeatherColor,
  getProductType,
  validateLeatherColor,
  validatePlatform,
  validateProductSpec,
} from "@/features/gpt-image/lib/product-catalog";
import { findEffect } from "@/features/image-gen/lib/effects-store";
import { computePromptOrderCredits } from "@/features/image-gen/lib/price-calculator";
import { protectedAction } from "@/lib/safe-action";

const withDemoAction = (name: string) =>
  protectedAction.metadata({ action: `imageGen.demo.${name}` });

const submitDemoSchema = z.object({
  /** 模板 id（= productEffect.id / maskId；通过 productEffect.promptTemplateId 间接查 prompt_template） */
  templateId: z.string().min(1),
  /**
   * 2026-09-12：用户上传的原图 R2 publicUrl（"原图"）。
   * 落 promptOrder.uploadedImages[0] —— "用户上传了什么图"。
   * 必传，且必须已在 R2。
   */
  referenceImageUrl: z.string().url(),
  /**
   * 2026-09-12：demo 预览图 R2 publicUrl（"效果图"）。
   * - Lingting 异步生成返回的 URL，是用户在 demo 流看到的「选择此效果下单」那张图
   * - 落 promptOrder.candidates[0][0] —— 订单详情展示这张"已选效果"，不是原图
   * - 必传；与 referenceImageUrl 是两张不同的图（一个是用户上传，一个是 AI 生成）
   * - 旧版写错了把 referenceImageUrl 当 candidates，订单详情显示原图，2026-09-12 修
   */
  demoPreviewUrl: z.string().url(),
  /**
   * 模板绑定的 productTypeCode（来自 productEffect.productTypeCode）。
   * null 表示老 ToC 模板，不显示规格窗、订单 spec 全 null。
   */
  productTypeCode: z.string().min(1).max(8).nullable().optional(),
  productSize: z.string().min(1).max(8).nullable().optional(),
  accessoryCode: z.string().min(1).max(16).nullable().optional(),
  engravingText: z.string().trim().max(40).nullable().optional(),
  engravingExposed: z.boolean().nullable().optional(),
  // 2026-09-10：LB 皮革徽章扩展定制（capability-gated）
  leatherColor: z.string().min(1).max(32).nullable().optional(),
  leatherExposed: z.boolean().nullable().optional(),
  pvcProtection: z.boolean().nullable().optional(),
  remarks: z.string().trim().min(0).max(500).nullable().optional(),
  /**
   * 2026-09-11：订单来源平台（PLATFORMS 字典 code）。
   * - null/undefined = 用户未选 → 落 null
   * - 非空 → 服务端用 validatePlatform 二次校验，字典外的 code 抛错
   */
  platform: z.string().min(1).max(32).nullable().optional(),
  /**
   * 2026-09-11：渠道订单号（与 platform 配对；跨平台异构字符串）。
   * - null/undefined = 用户未填 → 落 null
   * - 非空 → 服务端 trim 后存，max 64 字符
   * - capability-gated：canPlatform=false → 静默落 null
   */
  platformOrderNo: z.string().trim().min(0).max(64).nullable().optional(),
  /**
   * 2026-09-11：用户从宫格里选的 cell 索引（0..N-1，N=template.candidateCount）。
   * - 仅在 outputMode=grid 且 candidateCount>1 时必填（picker 强制要求）
   * - candidateCount=1 → 强制 0（无 picker 场景）
   * - outputMode=separate → 忽略（candidates[i] 是独立 URL，无需选 cell）
   * - 写入 promptOrder.selections = JSON.stringify([finalSelectedCell])
   */
  selectedCell: z.number().int().min(0).max(8).nullable().optional(),
});

/**
 * /image-gen demo 流「选择此效果下单」一键提交：
 * 校验 → 扣 credit → 写订单（SELECTED + 候选锁定为 demo 预览图）→ 返 token
 */
export const submitImageGenDemoAction = withDemoAction("submit")
  .schema(submitDemoSchema)
  .action(async ({ parsedInput, ctx }) => {
    // 1. 2026-09-12：客户端传的 templateId 是 productEffect.id（maskId），不是
    //    promptTemplate.id。两张表 id 列各自独立，productEffect.promptTemplateId
    //    才是引用 promptTemplate.id 的外键。必须先查 productEffect 拿
    //    promptTemplateId，再用它查 promptTemplate —— 直接
    //    `eq(promptTemplate.id, parsedInput.templateId)` 永远查不到。
    const effect = await findEffect(parsedInput.templateId);
    if (!effect || effect.status !== "active") {
      throw new Error("模板不存在或已停用");
    }
    if (!effect.promptTemplateId) {
      // admin 表单已强制必填 promptTemplateId；这里兜底挡 product_effect
      // 历史 null 行（没绑的话 prompt_order.templateId FK 也会拒）
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
        size: true,
        allowedSizes: true,
        allowedAccessories: true,
        // 2026-09-11：demo 流按 outputMode 决定 selectedCell 校验策略
        outputMode: true,
      },
    });
    if (!template) throw new Error("模板不存在或已停用");

    // 2. 三件套校验（NULL 全套合法）
    validateProductSpec(
      parsedInput.productTypeCode ?? null,
      parsedInput.productSize ?? null,
      parsedInput.accessoryCode ?? null
    );

    // 2026-09-10：解析模板级 allowedSizes/allowedAccessories 子集
    const allowedSizes = parseJsonStringArray(template.allowedSizes);
    const allowedAccessories = parseJsonStringArray(
      template.allowedAccessories
    );

    // 3. 按 catalog defaults 填 size/accessory（如未传）；同时受 allowed 子集过滤
    let finalProductSize = parsedInput.productSize ?? null;
    let finalAccessoryCode = parsedInput.accessoryCode ?? null;
    if (parsedInput.productTypeCode) {
      const type = getProductType(parsedInput.productTypeCode);
      if (type) {
        // 3a. 计算可用 size/accessory 列表（字典 ∩ 模板子集）
        const sizesAvailable = type.sizes.filter((s) =>
          allowedSizes ? allowedSizes.includes(s) : true
        );
        const accessoriesAvailable = type.accessories.filter((a) =>
          allowedAccessories ? allowedAccessories.includes(a) : true
        );
        if (!finalProductSize && sizesAvailable.length > 0) {
          finalProductSize = sizesAvailable[0] ?? null;
        }
        if (!finalAccessoryCode && accessoriesAvailable.length > 0) {
          finalAccessoryCode = accessoriesAvailable[0] ?? null;
        }
      }
    }

    // 2026-09-10：兜底校验——若 client 传了 size/accessory 但不在子集内，直接拒
    if (
      finalProductSize &&
      allowedSizes &&
      !allowedSizes.includes(finalProductSize)
    ) {
      throw new Error(
        `模板仅允许尺寸：${allowedSizes.join("/")}cm，当前选择了 ${finalProductSize}cm`
      );
    }
    if (
      finalAccessoryCode &&
      allowedAccessories &&
      !allowedAccessories.includes(finalAccessoryCode)
    ) {
      throw new Error(`模板不允许该配件：${finalAccessoryCode}`);
    }

    // 4. engraving 联动校验（canEngrave=false 时强制 null）
    let finalEngravingText = parsedInput.engravingText ?? null;
    let finalEngravingExposed = parsedInput.engravingExposed ?? null;
    if (parsedInput.productTypeCode) {
      const type = getProductType(parsedInput.productTypeCode);
      if (!type || !type.capabilities.canEngrave) {
        finalEngravingText = null;
        finalEngravingExposed = null;
      } else if (!finalEngravingText || finalEngravingText.trim() === "") {
        finalEngravingText = null;
        finalEngravingExposed = null;
      }
    } else {
      finalEngravingText = null;
      finalEngravingExposed = null;
    }

    // 4b. 2026-09-10：LB 皮革徽章定制联动（capability-gated，关闭的字段静默 collapse 为 null）
    let finalLeatherColor: string | null = null;
    let finalLeatherExposed: boolean | null = null;
    let finalPvcProtection: boolean | null = null;
    let finalRemarks: string | null = null;
    // 2026-09-11：订单来源平台（仅 LB canPlatform=true 接受）
    let finalPlatform: string | null = null;
    // 2026-09-11：渠道订单号（与 platform 配对；capability-gated）
    let finalPlatformOrderNo: string | null = null;
    if (parsedInput.productTypeCode) {
      const capType = getProductType(parsedInput.productTypeCode);
      if (capType) {
        if (capType.capabilities.canLeatherColor) {
          finalLeatherColor = parsedInput.leatherColor ?? null;
          validateLeatherColor(finalLeatherColor); // 字典外的 code 直接抛
        }
        if (capType.capabilities.canLeatherExposed) {
          finalLeatherExposed = parsedInput.leatherExposed === true;
        }
        if (capType.capabilities.canPvcProtection) {
          finalPvcProtection = parsedInput.pvcProtection === true;
        }
        // 2026-09-11：皮革外露 / PVC 保护互斥（二选一）。
        // UI 层 SpecModal 已经做了互斥，server 再兜一次挡绕过前端的脏请求。
        if (finalLeatherExposed === true && finalPvcProtection === true) {
          throw new Error("皮革外露 与 PVC 保护 不能同时勾选");
        }
        if (capType.capabilities.canHaveRemarks) {
          const trimmed = parsedInput.remarks?.trim();
          finalRemarks = trimmed && trimmed.length > 0 ? trimmed : null;
        }
        if (capType.capabilities.canPlatform) {
          finalPlatform = parsedInput.platform ?? null;
          if (finalPlatform) validatePlatform(finalPlatform); // 字典外的 code 抛
          // 渠道订单号：trim 后存；空串视为未填 → null
          const trimmedOrderNo = parsedInput.platformOrderNo?.trim();
          finalPlatformOrderNo =
            trimmedOrderNo && trimmedOrderNo.length > 0 ? trimmedOrderNo : null;
          // 业务规则：用户填了渠道订单号但没选 platform → 提示配对填写
          if (finalPlatformOrderNo && !finalPlatform) {
            throw new Error("填写渠道订单号时需同时选择订单来源平台");
          }
        }
      }
    }

    // 4c. 2026-09-11：selectedCell 校验（demo 流宫格选 cell 提交）
    // 规则：
    //   - candidateCount === 1 → 强制 0（无 picker，无需选）
    //   - outputMode === "separate" → 忽略（candidates[i] 是独立 URL，无 cell 概念）
    //   - outputMode === "grid" && candidateCount > 1 → 必填且 ∈ [0, candidateCount)
    const templateCandidateCount = template.candidateCount ?? 1;
    const templateOutputMode = (template.outputMode ?? "grid") as
      | "grid"
      | "separate";
    let finalSelectedCell: number;
    if (templateCandidateCount <= 1) {
      finalSelectedCell = 0;
    } else if (templateOutputMode === "separate") {
      // separate 模式 candidates[i] 是独立 URL，cell 索引无意义 → 默认 0
      finalSelectedCell = parsedInput.selectedCell ?? 0;
    } else {
      // grid + 多候选：picker 必选，未选 / 越界都报错
      if (
        parsedInput.selectedCell === null ||
        parsedInput.selectedCell === undefined
      ) {
        throw new Error("请先在效果图上选一个分镜");
      }
      if (parsedInput.selectedCell >= templateCandidateCount) {
        throw new Error(
          `所选分镜索引 ${parsedInput.selectedCell} 超出范围（候选数 ${templateCandidateCount}）`
        );
      }
      finalSelectedCell = parsedInput.selectedCell;
    }

    // 5. 2026-09-12：按规格价格计算（basePrice + Σ matching rule.delta）。
    //    对账核心：单一 template.price 看不出加价明细；totalCredits 与
    //    breakdown 持久化到 promptOrder.creditsCharged / creditsBreakdown，
    //    代理商对账 + admin UI 单卡展示都用这套口径。
    const basePrice = template.price ?? 0;
    const priceResult = await computePromptOrderCredits(template.id, basePrice, {
      productTypeCode: parsedInput.productTypeCode ?? null,
      productSize: finalProductSize,
      accessoryCode: finalAccessoryCode,
      leatherColor: finalLeatherColor,
      leatherExposed: finalLeatherExposed,
      pvcProtection: finalPvcProtection,
    });
    const { totalCredits, breakdown } = priceResult;
    const creditsBreakdownJson = JSON.stringify(breakdown);

    // 5b. 扣 credit（totalCredits=0 跳过；credit 不足抛 InsufficientCreditsError）
    if (totalCredits > 0) {
      try {
        // description 写规格摘要（对账可见）：
        //   "CM 皮革徽章 6cm + 皮套(已配规则) = 99 积分"
        //   "CM 钥匙扣 4cm (基础价) = 59 积分"
        const specSummary = [
          template.name,
          finalProductSize ? `${finalProductSize}cm` : null,
          finalAccessoryCode
            ? getAccessoryName(finalAccessoryCode)
            : null,
          finalLeatherColor
            ? getLeatherColorName(finalLeatherColor)
            : null,
          finalLeatherExposed === true ? "实物外露" : null,
          finalPvcProtection === true ? "PVC 保护" : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const description = `${specSummary} = ${totalCredits} 积分`;

        await consumeCredits({
          userId: ctx.userId,
          amount: totalCredits,
          serviceName: "image-gen-demo",
          description,
          metadata: {
            templateId: template.id,
            templateName: template.name,
            basePrice,
            deltaTotal: priceResult.deltaTotal,
            totalCredits,
            breakdown,
          },
        });
      } catch (err) {
        if (err instanceof InsufficientCreditsError) {
          throw new Error(
            `个人积分不足（需要 ${err.required}，当前可用 ${err.available}），请充值后再下单`
          );
        }
        throw err;
      }
    }

    // 6. 写 promptOrder（SELECTED）—— demo 预览图当唯一候选
    // uploadedImages 写用户上传的原图 referenceImageUrl；candidates 写 demo 预览图 demoPreviewUrl
    // （两者是不同的图，原图 vs 效果图）。
    const token = generateOrderToken();
    const orderNo = generateOrderNo();

    // candidates 写 [[demoPreviewUrl]]：外层 imageIdx=0，内层 candIdx=0。
    // 2026-09-12：必须是 demo 预览图（AI 生成的图），不是用户上传的 referenceImageUrl
    // （订单详情展示的是"用户选中的效果图"，不是"用户上传的原图"）。
    // selections = "[finalSelectedCell]"：锁定第 0 张第 finalSelectedCell 个候选 =
    // demo 预览图（composite）的第 N 格。composite 仍为 1 张图存在 R2，cell 索引语义
    // 与 /p/[token] admin 详情（CSS background-position 切 cell）一致。
    // 注：candidates 与 selections 都用 JSON 字符串（与 schema.ts promptOrder.candidates/selections 字段一致）
    const candidatesJson = JSON.stringify([[parsedInput.demoPreviewUrl]]);
    const selectionsJson = JSON.stringify([finalSelectedCell]);

    const [created] = await db
      .insert(promptOrder)
      .values({
        id: nanoid(),
        orderNo,
        // 2026-09-12：写 prompt_order.templateId 用 promptTemplate.id（FK 指向
        // prompt_template.id），不是 productEffect.id。原本传 parsedInput.templateId
        // 等同 productEffect.id，sync 来的行能过 FK；admin 手工录入 + promptTemplateId
        // 引用 → productEffect.id 不在 prompt_template 表 → FK 校验拒绝。
        templateId: template.id,
        token,
        status: "SELECTED",
        uploadCount: 1,
        imagesPerUpload: 1,
        regenerateLimit: 5,
        // uploadedImages 直接写用户上传的原图 URL（已在 R2）
        uploadedImages: JSON.stringify([parsedInput.referenceImageUrl]),
        uploadedAt: new Date(),
        generatedAt: new Date(),
        // demo 跳过异步生成，候选就是 demo 预览图本身
        candidates: candidatesJson,
        selections: selectionsJson,
        // selectedAt 设当前，selectedIndex = 0（兼容旧字段）
        selectedAt: new Date(),
        selectedIndex: 0,
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
        // 2026-09-11：订单来源平台（PLATFORMS 字典 code）
        platform: finalPlatform,
        // 2026-09-11：渠道订单号（与 platform 配对）
        platformOrderNo: finalPlatformOrderNo,
        // 2026-09-12：本单实际扣减积分（basePrice + Σ(delta)） + 加价明细
        creditsCharged: totalCredits,
        creditsBreakdown: creditsBreakdownJson,
      })
      .returning({ id: promptOrder.id });

    if (!created) throw new Error("创建订单失败");

    revalidatePath("/image-gen");
    // 2026-09-11：demo 订单不进 /p/[token] 公共页（避免匿名访问撞 404 —
    // candidates 是单张 composite，candIdx>0 时 resolveCandidateUrl 找不到图）。
    // demo 流用户通过 /image-gen/orders 或 /dashboard/prompt-orders 看订单。
    revalidatePath("/image-gen/orders");
    revalidatePath("/dashboard/prompt-orders");

    return {
      orderId: created.id,
      orderNo,
      token,
      creditsConsumed: totalCredits,
    };
  });

// ============================================
// helpers
// ============================================

/**
 * 把 accessory code 翻译成中文名（用于 creditsTransaction.description）。
 * 不在字典里时直接返回 code（罕见情况：脏数据，server action 已 validateProductSpec 兜过）。
 */
function getAccessoryName(code: string): string {
  return getAccessory(code)?.name ?? code;
}

/**
 * 把 leather color code 翻译成中文名（用于 creditsTransaction.description）。
 */
function getLeatherColorName(code: string): string {
  return getLeatherColor(code)?.name ?? code;
}

/**
 * 生成订单号：IG-YYYYMMDD-XXXXXX（IG = ImageGen，XXXXXX = nanoid 6 位大写）
 * 与 actions/order.ts 里的 generateOrderNo 完全一致——保留独立一份避免
 * 跨 server action 文件常量导入（next-safe-action 不允许 server action
 * 互相 import 常量）。
 */
function generateOrderNo(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 8);
  const rand = nanoid(6).toUpperCase();
  return `IG-${ts}-${rand}`;
}

/**
 * 解析 JSON 字符串数组列（与 db-effects.ts 的同名 helper 语义一致）。
 * null/空字符串/解析失败 → null（表示「不限制 / 字典全量」）。
 */
function parseJsonStringArray(raw: string | null | undefined): string[] | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
    return null;
  } catch {
    return null;
  }
}
