/**
 * 载体变体解析:本仓库的商品 → Sellbase 的 `variant_id`
 *
 * ## 「载体」是什么
 *
 * 本仓库的定价维度是「基础价 + 材质 + 尺寸 + AI 风格 + 配件 + 刻字 +
 * 加急」,组合起来上万个 —— 而 Sellbase 的**变体是价格单元**。要让
 * Sellbase 原生购物车跑起来,得把每一种组合都变成一个 Sellbase 变体
 * (一万多个),而且 Sellbase 的购物车行没有 metadata 字段,刻字文字和
 * AI 预览图没地方存。
 *
 * 所以走另一条路:**本仓库算价,Sellbase 只做收银台**。建单时每一行都
 * 指向一个「载体变体」—— 它只负责给 Sellbase 一个合法的 `variant_id`
 * 和一个能看懂的标题(工作室在后台能看懂这单是什么),**真正的价格永远
 * 是 `unit_price_amount`**。
 *
 * ## 载体变体从哪来
 *
 * `product_variant` 表加一列 `sellbase_variant_id`,由
 * `scripts/sync-sellbase-catalog.ts` 写入。所以运行时只是一次本地 DB
 * 查询,不用去问 Sellbase —— 少一次网络往返,也不会有缓存一致性问题。
 *
 * 打印工单不在目录里(它是「来料加工」,没有对应商品),给它一个专用
 * 载体:`product_code = "SERVICE"` 的那行,sku `SB-PRINT-SERVICE`,
 * 由同步脚本创建。
 */

import { and, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { productVariant } from "@/db/schema";

/** 打印工单的载体变体所在的产品码(不是真实商品,专用于收钱) */
export const PRINT_SERVICE_PRODUCT_CODE = "SERVICE";

/** 打印工单载体变体的 SKU */
export const PRINT_SERVICE_SKU = "SB-PRINT-SERVICE";

/** 解析出来的载体 */
export interface CarrierVariant {
  /** Sellbase 的变体 id(uuid) */
  variantId: string;
  /** 本仓库的 SKU —— 同步时用它对账 */
  sku: string;
  /** 本仓库的产品码 */
  productCode: string;
}

/** 找不到载体变体 —— 通常意味着同步脚本还没跑 */
export class CarrierNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CarrierNotFoundError";
  }
}

/**
 * 按产品码(+可选尺寸)解析载体变体
 *
 * 退让顺序:
 * 1. `(productCode, sizeCode)` 精确匹配
 * 2. 该产品码下任意一个已同步的变体
 * 3. 报错
 *
 * 第 2 步的退让是必要的 —— 商城作品的尺寸档位跟 SKU 表不一定一一对应
 * (比如某个尺寸没有单独建 SKU)。
 *
 * 只认 `isActive = true` 的行:同步脚本会把下架 SKU 从 Sellbase 那边的变体
 * 列表里去掉(那等于归档),而 Sellbase 建单时会拒绝归档的变体。
 */
export async function resolveCarrierVariant(input: {
  productCode: string;
  sizeCode?: string | null;
}): Promise<CarrierVariant> {
  const { productCode, sizeCode } = input;

  const baseCondition = and(
    eq(productVariant.productCode, productCode),
    eq(productVariant.isActive, true),
    isNotNull(productVariant.sellbaseVariantId)
  );

  // 1. 精确匹配(产品码 + 尺寸码)
  if (sizeCode) {
    const exact = await db
      .select({
        variantId: productVariant.sellbaseVariantId,
        sku: productVariant.sku,
        productCode: productVariant.productCode,
      })
      .from(productVariant)
      .where(and(baseCondition, eq(productVariant.sizeCode, sizeCode)))
      .limit(1);

    const hit = exact[0];
    if (hit?.variantId) {
      return {
        variantId: hit.variantId,
        sku: hit.sku,
        productCode: hit.productCode,
      };
    }
  }

  // 2. 退到该产品码下任意一个已同步的变体
  const fallback = await db
    .select({
      variantId: productVariant.sellbaseVariantId,
      sku: productVariant.sku,
      productCode: productVariant.productCode,
    })
    .from(productVariant)
    .where(baseCondition)
    .limit(1);

  const hit = fallback[0];
  if (hit?.variantId) {
    return {
      variantId: hit.variantId,
      sku: hit.sku,
      productCode: hit.productCode,
    };
  }

  throw new CarrierNotFoundError(
    `没有找到 ${productCode}${sizeCode ? `/${sizeCode}` : ""} 对应的 Sellbase 载体变体 —— 先跑 scripts/sync-sellbase-catalog.ts 同步目录`
  );
}

/**
 * 打印工单的载体变体
 *
 * 单独一个函数而不是复用上面的 —— 打印工单没有「尺寸」概念,而且它的
 * 载体是我们**造出来**的那一行(SERVICE / SB-PRINT-SERVICE),不该跟
 * 目录商品混在一起退让。
 */
export async function resolvePrintServiceCarrier(): Promise<CarrierVariant> {
  const rows = await db
    .select({
      variantId: productVariant.sellbaseVariantId,
      sku: productVariant.sku,
      productCode: productVariant.productCode,
    })
    .from(productVariant)
    .where(
      and(
        eq(productVariant.productCode, PRINT_SERVICE_PRODUCT_CODE),
        eq(productVariant.sku, PRINT_SERVICE_SKU)
      )
    )
    .limit(1);

  const hit = rows[0];
  if (!hit?.variantId) {
    throw new CarrierNotFoundError(
      "打印工单的 Sellbase 载体变体还没建好 —— 先跑 scripts/sync-sellbase-catalog.ts 同步目录"
    );
  }

  return {
    variantId: hit.variantId,
    sku: hit.sku,
    productCode: hit.productCode,
  };
}

/**
 * 从商城规格里取出尺寸码
 *
 * 规格里的尺寸 id 形如 `size_R_6`(见 `mock-catalog.ts` 的
 * `buildSizesForType`),末段就是 `product_variant.sizeCode` 用的
 * 「4」/「6」/「8」。
 */
export function sizeCodeFromSpecSizeId(
  sizeId: string | null | undefined
): string | null {
  if (!sizeId) return null;
  const parts = sizeId.split("_");
  const last = parts[parts.length - 1];
  return last && /^\d+$/.test(last) ? last : null;
}
