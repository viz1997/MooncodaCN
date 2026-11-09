/**
 * 商品定价逻辑(对齐 atelier src/lib/store/pricing.config.ts)
 *
 * ## 定价永远是本仓库的事
 *
 * Sellbase 只做收银台(见 `architecture-sellbase-integration.md`):它那边
 * 的目录价只是给工作室看的参考值,真正收多少是本仓库算出来的
 * `unit_price_amount`。
 *
 * ## 阶梯折扣口径:先折单价,再乘数量
 *
 * ```
 * discountedUnitPrice = round(unitPrice * (1 - rate))
 * total               = discountedUnitPrice * quantity
 * ```
 *
 * 为什么不按「先乘数量再折总价」:那会跟 Sellbase 的行合计
 * (`unit_price_amount × quantity`)差最多 ⌊qty/2⌋ 分 —— 结算页显示的价跟
 * 实际收的价不是同一个数。先折单价再乘数量,两边**逐分相等**。
 *
 * ## 价从哪儿来 —— `priceSource` 这个可选第二参
 *
 * 后台 `/admin/products` 改的是 DB,但这个函数**不查库**(它是同步纯函数)。
 * DB 的价由外面查好、当参数传进来 —— 见 `price-source.ts`。
 *
 * **不传就退回代码常量**(`BASE_PRICE_CENTS` / `PRODUCT_ACCESSORY_VARIANTS`),
 * 所以纯函数调用、单测、离线脚本都还照旧能用。
 *
 * ## 这个文件**不 import `@/db`**
 *
 * `PriceSource` 这个**类型**住在纯文件 `price-source-types.ts` 里,
 * 这里只 `import type` —— 编译期就被抹掉,不会把 `@/db` 拖进任何
 * 客户端 bundle。
 */

import type { CustomizationSpec, PricingResult } from "../types";
import {
  findAccessoryVariant,
  findAiStyle,
  findMaterial,
  findProductById,
  findSize,
} from "./mock-catalog";
import type { PriceSource } from "./price-source-types";
import {
  calculateRemainingForFreeShipping,
  calculateShippingCents,
  getQuantityTier,
  PRICING_CONSTANTS,
  QUANTITY_TIERS,
} from "./pricing-constants";

/* -------------------------------------------------------------------------- */
/*  常量 re-export(老 import 路径继续能用)                                    */
/* -------------------------------------------------------------------------- */

export {
  calculateRemainingForFreeShipping,
  calculateShippingCents,
  getQuantityTier,
  PRICING_CONSTANTS,
  QUANTITY_TIERS,
};
export type { QuantityTier } from "./pricing-constants";

/* -------------------------------------------------------------------------- */
/*  数量阶梯折扣                                                              */
/* -------------------------------------------------------------------------- */

/** 数量阶梯折扣的结果 */
export interface QuantityDiscount {
  /** 折后单价(分)—— Sellbase 的 `unit_price_amount` 填的就是这个 */
  discountedUnitPriceCents: number;
  /** 行合计(分)—— `discountedUnitPriceCents × quantity` */
  totalPriceCents: number;
  /** 折扣额(分)—— 折前合计 − 折后合计 */
  discountCents: number;
}

/**
 * 数量阶梯折扣 —— **先折单价,再乘数量**
 *
 * ```
 * discountedUnitPrice = round(unitPrice × (1 - rate))
 * total               = discountedUnitPrice × quantity
 * discount            = unitPrice × quantity - total
 * ```
 *
 * 单独拆出来是为了能**直接**测「行合计 = 折后单价 × 数量」这条恒等式:目录里
 * 现有的价都是 100 的倍数,两种口径碰巧相等,光靠目录数据测不出「顺序反了
 * 会差几分」。这个函数接受任意单价,拿个奇数就能测出来。
 */
export function computeQuantityDiscount(
  unitPriceCents: number,
  quantity: number
): QuantityDiscount {
  const tier = getQuantityTier(quantity);
  const discountedUnitPriceCents = Math.round(
    unitPriceCents * (1 - tier.discountRate)
  );
  const totalPriceCents = discountedUnitPriceCents * quantity;
  return {
    discountedUnitPriceCents,
    totalPriceCents,
    discountCents: unitPriceCents * quantity - totalPriceCents,
  };
}

/* -------------------------------------------------------------------------- */
/*  定价计算                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 计算 custom line item 价格
 *
 * unit = base + material + size + aiStyle + accessory + engraving + rush
 * total = round(unit * (1 - tierRate)) * quantity
 *
 * ## `priceSource` —— DB 里的价(可选)
 *
 * 传了就用 DB 的基础价 / 配件加价;**没传就退回代码常量**。
 * 详见文件头。
 */
export function calculatePricing(
  spec: CustomizationSpec,
  priceSource?: PriceSource
): PricingResult {
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

  // 材质 id 在多个型号下重名("mat_resin" 挂在 R/A/P/RM 上),
  // 必须按型号限定查找范围,否则 A/P/RM 商品会拿到 R 的材质而被判不适用
  const material = findMaterial(spec.materialId, spec.productTypeCode);
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

  // 基础价 —— DB 优先,查不到就退回代码常量(mock-catalog 里那个)
  const product = findProductById(spec.productId);
  if (!product) throw new Error(`未知产品: ${spec.productId}`);
  const baseCents =
    priceSource?.basePriceCentsByTypeCode.get(spec.productTypeCode) ??
    product.basePriceCents;

  // 刻字能力按型号走 —— 手办(M)/冰箱贴(P)不做表面刻字,前端不渲染刻字框,
  // 这里再挡一道:有人直接调 API 塞刻字文本也不能收进钱。
  if (spec.engravingText.length > 0 && !product.canEngrave) {
    throw new Error(
      `${product.typeLabel}不支持刻字(该型号的 capabilities.canEngrave = false)`
    );
  }

  const materialCents = material.surchargeCents;
  const sizeCents = size.surchargeCents;
  const aiStyleCents = aiStyle.surchargeCents;
  const engravingFeeCents =
    spec.engravingText.length > 0 ? PRICING_CONSTANTS.ENGRAVING_FEE_CENTS : 0;
  const rushOrderCents = spec.rushOrder
    ? PRICING_CONSTANTS.RUSH_ORDER_FEE_CENTS
    : 0;

  // 配件加价 + 校验(2026-11-02 新增):
  //  - 变体必须存在、必须属于该商品的配件分组
  //  - 同一分组只能选一个(底座要么木质要么磁性,不能都要)
  //  - 玻璃罩这类按尺寸限定的变体,主体尺寸必须匹配(8cm 罩配 8cm 手办)
  const accessoryIds = spec.accessoryVariantIds ?? [];
  let accessoryCents = 0;
  const pickedGroups = new Set<string>();
  for (const variantId of accessoryIds) {
    const variant = findAccessoryVariant(variantId);
    if (!variant) throw new Error(`未知配件: ${variantId}`);
    const group = product.accessoryGroups.find((g) =>
      g.variants.some((v) => v.id === variantId)
    );
    if (!group) {
      throw new Error(
        `配件 ${variant.name} 不适用于产品型号 ${spec.productTypeCode}`
      );
    }
    if (pickedGroups.has(group.code)) {
      throw new Error(`配件 ${group.name} 只能选一个`);
    }
    pickedGroups.add(group.code);
    if (
      variant.appliesToSizesCm.length > 0 &&
      !variant.appliesToSizesCm.includes(size.cm)
    ) {
      throw new Error(`配件 ${variant.name} 不适用于 ${size.cm}cm 尺寸`);
    }
    // 配件加价 —— DB 优先,查不到就退回代码常量
    accessoryCents +=
      priceSource?.accessoryDeltaCentsByVariantId.get(variantId) ??
      variant.surchargeCents;
  }

  const unitPriceCents =
    baseCents +
    materialCents +
    sizeCents +
    aiStyleCents +
    accessoryCents +
    engravingFeeCents +
    rushOrderCents;

  // 数量阶梯折扣 —— 先折单价,再乘数量(见文件头)
  const { discountedUnitPriceCents, totalPriceCents, discountCents } =
    computeQuantityDiscount(unitPriceCents, spec.quantity);
  const quantityTierDiscountCents = discountCents;

  // 估算发货天数(quantity 越大越久)
  const baseShipDays = product.leadTimeDays;
  const rushReduction = spec.rushOrder ? Math.ceil(baseShipDays / 2) : 0;
  const estimatedShipDays = Math.max(1, baseShipDays - rushReduction);

  return {
    unitPriceCents,
    discountedUnitPriceCents,
    totalPriceCents,
    breakdown: {
      baseCents,
      materialCents,
      sizeCents,
      aiStyleCents,
      accessoryCents,
      engravingFeeCents,
      rushOrderCents,
      quantityTierDiscountCents,
    },
    estimatedShipDays,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * 按**折前**单价算小计
 *
 * 注意:这是折扣**前**的合计。真正要收的钱是
 * `discountedUnitPriceCents × quantity` 的和(见 `calculatePricing`)。
 */
export function calculateSubtotalCents(
  items: Array<{ unitPriceCents: number; quantity: number }>
): number {
  return items.reduce(
    (sum, item) => sum + item.unitPriceCents * item.quantity,
    0
  );
}
