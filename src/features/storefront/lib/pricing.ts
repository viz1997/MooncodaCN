/**
 * Mock 商品定价逻辑(对齐 atelier src/lib/store/pricing.config.ts)
 *
 * 切真 Medusa 时:此文件作废,/api/store/pricing/calculate 转发到 Medusa
 * pricing API。
 */

import type { CustomizationSpec, PricingResult } from "../types";
import {
  findAiStyle,
  findMaterial,
  findProductById,
  findSize,
} from "./mock-catalog";

/* -------------------------------------------------------------------------- */
/*  全局定价常量                                                             */
/* -------------------------------------------------------------------------- */

export const PRICING_CONSTANTS = {
  /** 刻字费用(分),即 ¥3 */
  ENGRAVING_FEE_CENTS: 300,
  /** 刻字最大长度 */
  MAX_ENGRAVING_LENGTH: 30,
  /** 单 line item 最大数量 */
  MAX_QUANTITY: 100,
  /** 加急订单加价(分),¥15 */
  RUSH_ORDER_FEE_CENTS: 1500,
  /** 免运费门槛(分),¥99 */
  FREE_SHIPPING_THRESHOLD_CENTS: 9900,
  /** 默认运费(分),¥8 */
  DEFAULT_SHIPPING_CENTS: 800,
  /** 货币代码 */
  CURRENCY_CODE: "CNY",
  /** 区域 */
  REGION_ID: "china",
} as const;

/**
 * 数量阶梯折扣(对齐 atelier `quantityTiers`)
 */
export const QUANTITY_TIERS = [
  { minQty: 50, discountRate: 0.2 },
  { minQty: 10, discountRate: 0.1 },
  { minQty: 1, discountRate: 0 },
] as const;

/* -------------------------------------------------------------------------- */
/*  定价计算                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 计算 custom line item 价格
 *
 * unit = base + material + size + aiStyle + engraving + rush
 * total = unit * quantity * (1 - quantityTierDiscount)
 */
export function calculatePricing(spec: CustomizationSpec): PricingResult {
  // 校验 quantity
  if (
    !Number.isInteger(spec.quantity) ||
    spec.quantity < 1 ||
    spec.quantity > PRICING_CONSTANTS.MAX_QUANTITY
  ) {
    throw new Error(
      `quantity 必须在 1-${PRICING_CONSTANTS.MAX_QUANTITY} 之间,收到 ${spec.quantity}`
    );
  }

  // 校验 engraving 长度
  if (spec.engravingText.length > PRICING_CONSTANTS.MAX_ENGRAVING_LENGTH) {
    throw new Error(
      `刻字长度不能超过 ${PRICING_CONSTANTS.MAX_ENGRAVING_LENGTH} 字符`
    );
  }

  const material = findMaterial(spec.materialId);
  const size = findSize(spec.sizeId);
  const aiStyle = findAiStyle(spec.aiStyleId);

  if (!material) throw new Error(`未知材质: ${spec.materialId}`);
  if (!size) throw new Error(`未知尺寸: ${spec.sizeId}`);
  if (!aiStyle) throw new Error(`未知 AI 风格: ${spec.aiStyleId}`);

  // 校验 material / size 适用于该 productType
  if (!material.appliesTo.includes(spec.productTypeCode)) {
    throw new Error(
      `材质 ${material.name} 不适用于产品型号 ${spec.productTypeCode}`
    );
  }
  if (!size.appliesTo.includes(spec.productTypeCode)) {
    throw new Error(
      `尺寸 ${size.cm}cm 不适用于产品型号 ${spec.productTypeCode}`
    );
  }

  // 从 mock-catalog 拿 basePriceCents
  const product = findProductById(spec.productId);
  if (!product) throw new Error(`未知产品: ${spec.productId}`);
  const baseCents = product.basePriceCents;

  const materialCents = material.surchargeCents;
  const sizeCents = size.surchargeCents;
  const aiStyleCents = aiStyle.surchargeCents;
  const engravingFeeCents =
    spec.engravingText.length > 0 ? PRICING_CONSTANTS.ENGRAVING_FEE_CENTS : 0;
  const rushOrderCents = spec.rushOrder
    ? PRICING_CONSTANTS.RUSH_ORDER_FEE_CENTS
    : 0;

  const unitPriceCents =
    baseCents +
    materialCents +
    sizeCents +
    aiStyleCents +
    engravingFeeCents +
    rushOrderCents;

  // 数量阶梯折扣
  const tier =
    QUANTITY_TIERS.find((t) => spec.quantity >= t.minQty) ??
    QUANTITY_TIERS[QUANTITY_TIERS.length - 1]!;
  const subtotalCents = unitPriceCents * spec.quantity;
  const quantityTierDiscountCents = Math.round(
    subtotalCents * tier.discountRate
  );

  const totalPriceCents = subtotalCents - quantityTierDiscountCents;

  // 估算发货天数(quantity 越大越久)
  const baseShipDays = product.leadTimeDays;
  const rushReduction = spec.rushOrder ? Math.ceil(baseShipDays / 2) : 0;
  const estimatedShipDays = Math.max(1, baseShipDays - rushReduction);

  return {
    unitPriceCents,
    totalPriceCents,
    breakdown: {
      baseCents,
      materialCents,
      sizeCents,
      aiStyleCents,
      engravingFeeCents,
      rushOrderCents,
      quantityTierDiscountCents,
    },
    estimatedShipDays,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * 计算小计(用于 cart drawer 显示)
 */
export function calculateSubtotalCents(
  items: Array<{ unitPriceCents: number; quantity: number }>
): number {
  return items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0
  );
}

/**
 * 计算运费(到达免运费门槛则 0)
 */
export function calculateShippingCents(subtotalCents: number): number {
  return subtotalCents >= PRICING_CONSTANTS.FREE_SHIPPING_THRESHOLD_CENTS
    ? 0
    : PRICING_CONSTANTS.DEFAULT_SHIPPING_CENTS;
}

/**
 * 距离免运费还差多少(用于 cart drawer 进度条)
 */
export function calculateRemainingForFreeShipping(
  subtotalCents: number
): number {
  return Math.max(
    0,
    PRICING_CONSTANTS.FREE_SHIPPING_THRESHOLD_CENTS - subtotalCents
  );
}
