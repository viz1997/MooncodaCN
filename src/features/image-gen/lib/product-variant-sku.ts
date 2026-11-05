/**
 * SKU 编码与变体生成 —— 纯函数，无 DB 依赖
 *
 * 2026-10-21 商品目录 DB 化。product_variant 表的初始行由
 * src/db/seed-products.ts 和 admin 的「生成变体」action 共用本模块产出，
 * 保证两条路径生成的 SKU 编码完全一致（product_variant_sku_uniq_idx 兜底）。
 *
 * 与 product_accessory_variant 的分工：
 *  - 那张表回答「某产品的某配件有哪些颜色/尺寸」（AI 规格枚举）
 *  - 本模块回答「这个 (尺寸 × 配件 × 配件变体) 组合能卖多少钱」（真 SKU）
 *
 * 尺寸清单 / 配件清单目前仍是 product-catalog.ts 的 PRODUCT_TYPES 常量
 * （见 CLAUDE.md 范围说明）。将来这两张字典也 DB 化时，只需替换本模块的
 * 入参来源，SKU 编码规则不用动。
 */

import {
  BASE_PRICE_CENTS,
  PRODUCT_TYPES,
  type ProductType,
} from "@/features/gpt-image/lib/product-catalog";

/** 该维度不存在时在 SKU 里占位的段 */
export const NO_SEGMENT = "N-A";

/**
 * 尺寸加价规则（分）—— 与 product-capability.ts 里
 * `sizes[].priceDeltaCents = idx * 500` 保持一致。
 *
 * 抽成常量是为了让 seed 与运行时拼价逻辑不会各写一份然后漂移。
 */
export const SIZE_STEP_CENTS = 500;

/** product_accessory_variant 行的最小结构（本模块只需要这几个字段） */
export interface AccessoryVariantLike {
  accessoryCode: string;
  variantCode: string;
  priceDeltaCents: number;
  sortOrder: number;
}

/** product_variant 插入前的行形状（不含 DB 默认值） */
export interface VariantSeed {
  id: string;
  productCode: string;
  sku: string;
  sizeCode: string;
  accessoryCode: string;
  variantCode: string;
  priceCents: number;
  sortOrder: number;
}

/**
 * 单段规范化：去空格、下划线转连字符、转大写。
 * accessoryCode 用下划线（braided_rope），尺寸是裸数字（6）。
 */
function normalizeSegment(seg: string): string {
  return seg.trim().replace(/_/g, "-").toUpperCase();
}

/**
 * 掐掉配件变体段里与配件重复的头部。
 *
 * `product_accessory_variant.variantCode` 的命名惯例是「短别名_具体值」，
 * 而短别名常常就是配件码本身或它的尾词：
 *   leather + leather_brown  → LEATHER-BROWN   （重复 LEATHER）
 *   stand   + stand_magnetic → STAND-MAGNETIC  （重复 STAND）
 *   braided_rope + rope_red  → BRAIDED-ROPE + ROPE-RED（ROPE 是配件尾词）
 *
 * 直接拼会得到 `R-6-LEATHER-LEATHER-BROWN` 这种读起来像口吃的 SKU。
 * 这里把头部去掉，得到 `R-6-LEATHER-BROWN` / `R-4-BRAIDED-ROPE-RED`。
 *
 * 只在「头部确实是配件的尾词」时才掐 —— 别名对不上时原样保留
 * （如 `glass_cover` + `glass_4` → `M-6-GLASS-COVER-GLASS-4`，
 *  冗余但绝不含糊，warehouse 扫码不会认错）。
 * 掐掉的只是 SKU 字符串；DB 里 `variantCode` 列仍存完整值，join 不受影响。
 */
function stripRedundantPrefix(
  variantSeg: string,
  accessorySeg: string
): string {
  if (!accessorySeg || accessorySeg === NO_SEGMENT) return variantSeg;
  const dash = variantSeg.indexOf("-");
  if (dash <= 0) return variantSeg;

  const head = variantSeg.slice(0, dash);
  const rest = variantSeg.slice(dash + 1);
  const isDuplicate =
    head === accessorySeg || accessorySeg.endsWith(`-${head}`);
  return isDuplicate ? rest : variantSeg;
}

/**
 * 拼 SKU：CODE-SIZE-ACCESSORY-VARIANT
 *
 * 尾部无意义的 N-A 段会被截掉，配件变体段里与配件重复的头部会被掐掉：
 *   R + 6 + leather + leather_brown → "R-6-LEATHER-BROWN"
 *   RM + 6 + 无配件 + 无变体        → "RM-6"
 *
 * 这样 SKU 短且人类可读；缺失段在 DB 里仍显式存 "N-A"，查询不用猜。
 */
export function buildSku(
  productCode: string,
  sizeCode: string,
  accessoryCode: string,
  variantCode: string
): string {
  const accessorySeg = accessoryCode
    ? normalizeSegment(accessoryCode)
    : NO_SEGMENT;
  const variantSeg = variantCode
    ? stripRedundantPrefix(normalizeSegment(variantCode), accessorySeg)
    : NO_SEGMENT;

  const parts = [
    normalizeSegment(productCode),
    normalizeSegment(sizeCode),
    accessorySeg,
    variantSeg,
  ];
  while (parts.length > 2 && parts[parts.length - 1] === NO_SEGMENT) {
    parts.pop();
  }
  return parts.join("-");
}

/**
 * product_variant 主键。用 SKU 本身做 id —— 一对一、可读、幂等重跑不产生
 * 重复行（配合 onConflictDoNothing）。
 */
export function variantIdFromSku(sku: string): string {
  return `pvar_${sku.toLowerCase()}`;
}

/**
 * 生成单个产品的全部 SKU 行。
 *
 * 笛卡尔积：sizes × accessories × (该配件的变体)。
 * 某配件没有变体定义（如 metal / magnet / bracket）时产出 1 行，
 * variantCode 记 N-A；产品完全没有配件（RM）时每个尺寸产出 1 行 N-A 行。
 *
 * 初始价 = 商品 basePriceCents + 尺寸阶梯加价 + 配件变体加价，
 * 与旧的前端拼价公式保持一致，所以 seed 当天线上价格零漂移。
 *
 * @param productCode       产品码
 * @param basePriceCents    该商品的 basePriceCents（DB 行优先，否则取字典）
 * @param productType       PRODUCT_TYPES 里对应的条目（提供 sizes / accessories）
 * @param accessoryVariants product_accessory_variant 全量行（本产品相关的会被过滤）
 * @param startSortOrder    sortOrder 起始值，便于追加
 */
export function buildVariantSeeds(opts: {
  productCode: string;
  /** 显式带 `| undefined`：exactOptionalPropertyTypes 下字典查不到的值要能直接传下去 */
  basePriceCents?: number | undefined;
  productType: ProductType;
  accessoryVariants: readonly AccessoryVariantLike[];
  startSortOrder?: number | undefined;
}): VariantSeed[] {
  const {
    productCode,
    basePriceCents,
    productType,
    accessoryVariants,
    startSortOrder = 0,
  } = opts;

  const base = basePriceCents ?? BASE_PRICE_CENTS[productCode] ?? 0;
  const out: VariantSeed[] = [];
  let sort = startSortOrder;

  // 无配件的产品（RM）也要出 1 行，用 NO_SEGMENT 占位代表「不带配件」
  const accessories: readonly string[] =
    productType.accessories.length > 0 ? productType.accessories : [NO_SEGMENT];

  for (const [sizeIdx, sizeCode] of productType.sizes.entries()) {
    const sizeDelta = sizeIdx * SIZE_STEP_CENTS;

    for (const accessory of accessories) {
      const isNoAccessory = accessory === NO_SEGMENT;
      const relatedVariants = isNoAccessory
        ? []
        : accessoryVariants.filter((v) => v.accessoryCode === accessory);

      if (relatedVariants.length === 0) {
        const sku = buildSku(
          productCode,
          sizeCode,
          isNoAccessory ? "" : String(accessory),
          ""
        );
        out.push({
          id: variantIdFromSku(sku),
          productCode,
          sku,
          sizeCode,
          accessoryCode: isNoAccessory ? NO_SEGMENT : String(accessory),
          variantCode: NO_SEGMENT,
          priceCents: base + sizeDelta,
          sortOrder: sort++,
        });
        continue;
      }

      for (const v of relatedVariants) {
        const sku = buildSku(productCode, sizeCode, accessory, v.variantCode);
        out.push({
          id: variantIdFromSku(sku),
          productCode,
          sku,
          sizeCode,
          accessoryCode: accessory,
          variantCode: v.variantCode,
          priceCents: base + sizeDelta + v.priceDeltaCents,
          sortOrder: sort++,
        });
      }
    }
  }

  return out;
}

/**
 * 生成全部 6 个产品的 SKU 行。
 *
 * @param basePrices        productCode → basePriceCents（DB 行的价，优先于字典）
 * @param accessoryVariants product_accessory_variant 全量行
 * @param productTypes      PRODUCT_TYPES 条目（默认全量字典）
 */
export function buildAllVariantSeeds(opts: {
  basePrices?: Record<string, number>;
  accessoryVariants: ReadonlyArray<
    AccessoryVariantLike & { productTypeCode: string }
  >;
  productTypes?: readonly ProductType[];
}): VariantSeed[] {
  const {
    basePrices = {},
    accessoryVariants,
    productTypes = PRODUCT_TYPES,
  } = opts;

  const out: VariantSeed[] = [];
  for (const pt of productTypes) {
    const mine = accessoryVariants.filter((v) => v.productTypeCode === pt.code);
    out.push(
      ...buildVariantSeeds({
        productCode: pt.code,
        basePriceCents: basePrices[pt.code],
        productType: pt,
        accessoryVariants: mine,
      })
    );
  }
  return out;
}
