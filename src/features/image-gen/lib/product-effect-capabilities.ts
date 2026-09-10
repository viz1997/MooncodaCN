// 产品效果（productEffect）模板级 capability 覆盖的合并 helper。
//
// 单一职责：把 catalog 默认能力（PRODUCT_TYPES 字典） + admin 在产品效果管理里
// 配的模板级 override 合并成"用户实际能看到的"effective capability。
//
// 2026-09-10：随 LB 皮革徽章加工选项（皮革色/外露/PVC/备注）一同落地。
// 见 [[image-gen-product-effect-capabilities]] 决策：
// - 模板级 override 只在创建时（SpecModal）生效；
// - /p/[token] 仍按 catalog 默认能力，避免"已生成订单被追溯关能力"的歧义。

import {
  getLeatherColor,
  getProductType,
  LEATHER_COLORS,
  type LeatherColor,
  type ProductCapabilities,
} from "@/features/gpt-image/lib/product-catalog";

/**
 * 合并 catalog 默认 + 模板级覆盖，返回 effective capability。
 *
 * 规则：
 * - productTypeCode 找不到 → 返回 null（让 caller 自己决定怎么处理"无型号"情况）
 * - override 缺省 → 用 catalog 默认
 * - override 非空 → 用 override（override 是"覆盖式"：admin 选 false 就关掉
 *   catalog 默认的 true，而不是合并；只对 override 里出现的 key 应用）
 * - canEngrave 始终跟随 catalog（不在 override 范围，避免和现有刻字字段冲突）
 */
export function getEffectiveCapabilities(
  productTypeCode: string | null | undefined,
  override: Partial<ProductCapabilities> | null | undefined
): ProductCapabilities | null {
  const type = getProductType(productTypeCode);
  if (!type) return null;
  if (!override) return type.capabilities;
  return {
    ...type.capabilities,
    canEngrave: type.capabilities.canEngrave, // 不参与覆盖
    canLeatherColor:
      override.canLeatherColor ?? type.capabilities.canLeatherColor,
    canLeatherExposed:
      override.canLeatherExposed ?? type.capabilities.canLeatherExposed,
    canPvcProtection:
      override.canPvcProtection ?? type.capabilities.canPvcProtection,
    canHaveRemarks: override.canHaveRemarks ?? type.capabilities.canHaveRemarks,
  };
}

/**
 * 模板级皮革色子集 → 实际给用户展示的 LeatherColor[]。
 * - allowedColors null/空 → LEATHER_COLORS 全量（catalog 默认）
 * - 非空 → 按 code 过滤；不在字典里的 code 静默丢弃
 *   （与 validateLeatherColor 的思路一致——脏数据被吞掉而不是抛错）
 */
export function getEffectiveLeatherColors(
  allowedColors: string[] | null | undefined
): LeatherColor[] {
  if (!allowedColors || allowedColors.length === 0) return [...LEATHER_COLORS];
  return allowedColors
    .map((code) => getLeatherColor(code))
    .filter((c): c is LeatherColor => c !== null);
}
