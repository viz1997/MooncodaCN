/**
 * 2026-09-13：demo 流与 preview 分享凭证共享的 spec 填默认 + 校验 helper。
 *
 * 起因：代理商 demo 流一键下单（submitImageGenDemoAction）+ 分享凭证创建
 * （createPreviewShareAction）+ 客人免登录提交（guest-submit）三处都套同
 * 一套「按模板默认填 size/accessory + capability-gated 处理 engraving /
 * leather / pvc / remarks / platform」逻辑。原 submitImageGenDemoAction
 * 内联实现 100+ 行，本 helper 抽出后两边共用，避免对账口径 / 校验口径漂移。
 *
 * 三处复用关系：
 *   - submitImageGenDemoAction：fillDefaultsByTemplate + 自己 selectedCell
 *     校验 + 扣 credit + INSERT SELECTED
 *   - createPreviewShareAction：fillDefaultsByTemplate（代理商已选 cell 透传）
 *     + INSERT CANDIDATES_READY（不扣 credit）
 *   - guest-submit 路由：preview 已填的 final* 直接消费，不重复调用本 helper
 *
 * 设计：
 *   - 纯函数：入参 (template, parsedInput) → 出参 FilledSpec
 *   - 抛错语义沿用 submitImageGenDemoAction 原文：allowed 子集越界 / 皮革
 *     外露互斥 / 平台与订单号不配对 都直接抛 Error（前端可读）
 *   - 不做 selectedCell 校验（每处 caller 自己处理：demo 流按 candidateCount，
 *     preview 不校验只透传，guest-submit 按 normalizeSelections 后 batchIdx 维度）
 *   - 不写 DB、不扣 credit（持久化由各 caller 决定）
 */

import { nanoid } from "nanoid";

import {
  getProductType,
  validateLeatherColor,
  validatePlatform,
  validateProductSpec,
} from "@/features/gpt-image/lib/product-catalog";

/**
 * helper 接受的 promptTemplate 最小子集（不耦合 Drizzle row 类型，
 * 避免 helper 跟着 DB schema 变而重写）。
 */
export interface TemplateLike {
  allowedSizes: string | null;
  allowedAccessories: string | null;
}

/**
 * 入参（demo 流 / preview 流都共用此 shape）。
 * 全部 optional + nullable —— caller 透传 Zod parsedInput 即可。
 */
export interface ParsedSpecInput {
  productTypeCode?: string | null;
  productSize?: string | null;
  accessoryCode?: string | null;
  engravingText?: string | null;
  engravingExposed?: boolean | null;
  leatherColor?: string | null;
  leatherExposed?: boolean | null;
  pvcProtection?: boolean | null;
  remarks?: string | null;
  platform?: string | null;
  platformOrderNo?: string | null;
}

/**
 * helper 出参：可直接用于 INSERT promptOrder.* 与 computePromptOrderCredits。
 */
export interface FilledSpec {
  finalProductSize: string | null;
  finalAccessoryCode: string | null;
  finalEngravingText: string | null;
  finalEngravingExposed: boolean | null;
  finalLeatherColor: string | null;
  finalLeatherExposed: boolean | null;
  finalPvcProtection: boolean | null;
  finalRemarks: string | null;
  finalPlatform: string | null;
  finalPlatformOrderNo: string | null;
}

/**
 * 解析模板级 allowedSizes/allowedAccessories JSON 字符串列。
 * 与 submitImageGenDemoAction / db-effects.ts 同名 helper 语义一致：
 *   - null/空字符串/解析失败 → null（表示「不限制 / 字典全量」）
 *   - 解析成功返回 string[]
 */
function parseJsonStringArray(
  raw: string | null | undefined
): string[] | null {
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

/**
 * 按模板默认填全部 spec 字段 + capability-gated 联动校验。
 *
 * 校验（与 submitImageGenDemoAction 内联逻辑等价）：
 *   1. validateProductSpec —— 型号 + 尺寸 + 配件字典合法性（client 传脏值直接拒）
 *   2. 模板级 allowedSizes / allowedAccessories 子集越界 → 抛错
 *   3. engraving：canEngrave=false 时强制 null；空字符串视为未填
 *   4. leatherColor：canLeatherColor=false 时强制 null；非空则 validateLeatherColor
 *   5. leatherExposed+pvcProtection 互斥：UI 已做，server 再兜一次
 *   6. remarks：trim 后空字符串视为 null
 *   7. platform：canPlatform=false 时强制 null；非空则 validatePlatform
 *   8. platformOrderNo：trim 后空字符串视为 null；填了但 platform=null → 抛错
 */
export function fillDefaultsByTemplate(
  template: TemplateLike,
  parsedInput: ParsedSpecInput
): FilledSpec {
  // 1. 字典合法性（三件套）—— client 传脏值直接拒
  validateProductSpec(
    parsedInput.productTypeCode ?? null,
    parsedInput.productSize ?? null,
    parsedInput.accessoryCode ?? null
  );

  // 2. 解析模板子集
  const allowedSizes = parseJsonStringArray(template.allowedSizes);
  const allowedAccessories = parseJsonStringArray(template.allowedAccessories);

  // 3. 按 catalog defaults 填 size/accessory（如未传）；同时受 allowed 子集过滤
  let finalProductSize = parsedInput.productSize ?? null;
  let finalAccessoryCode = parsedInput.accessoryCode ?? null;
  if (parsedInput.productTypeCode) {
    const type = getProductType(parsedInput.productTypeCode);
    if (type) {
      // 字典 ∩ 模板子集
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

  // 4. 兜底校验：client 传了但不在子集内 → 拒
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

  // 5. engraving 联动校验（canEngrave=false 时强制 null）
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

  // 6. LB 皮革徽章定制联动（capability-gated，关闭的字段静默 collapse 为 null）
  let finalLeatherColor: string | null = null;
  let finalLeatherExposed: boolean | null = null;
  let finalPvcProtection: boolean | null = null;
  let finalRemarks: string | null = null;
  let finalPlatform: string | null = null;
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
      // 皮革外露 / PVC 保护互斥（二选一）
      if (finalLeatherExposed === true && finalPvcProtection === true) {
        throw new Error("皮革外露 与 PVC 保护 不能同时勾选");
      }
      if (capType.capabilities.canHaveRemarks) {
        const trimmed = parsedInput.remarks?.trim();
        finalRemarks = trimmed && trimmed.length > 0 ? trimmed : null;
      }
      if (capType.capabilities.canPlatform) {
        finalPlatform = parsedInput.platform ?? null;
        if (finalPlatform) validatePlatform(finalPlatform);
        const trimmedOrderNo = parsedInput.platformOrderNo?.trim();
        finalPlatformOrderNo =
          trimmedOrderNo && trimmedOrderNo.length > 0 ? trimmedOrderNo : null;
        // 业务规则：填了渠道订单号但没选 platform → 提示配对填写
        if (finalPlatformOrderNo && !finalPlatform) {
          throw new Error("填写渠道订单号时需同时选择订单来源平台");
        }
      }
    }
  }

  return {
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
  };
}

/**
 * 生成订单号：IG-YYYYMMDD-XXXXXX（IG = ImageGen，XXXXXX = nanoid 6 位大写）。
 *
 * 与 submit-image-gen-demo.ts 的私有 generateOrderNo 实现一致——
 * 这里重新导出一份给 create-preview-share.ts 用，避免跨 server action 文件
 * 互相 import 私有常量（next-safe-action 不允许 server action 互相 import）。
 */
export function generatePreviewOrderNo(): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 8);
  const rand = nanoid(6).toUpperCase();
  return `IG-${ts}-${rand}`;
}