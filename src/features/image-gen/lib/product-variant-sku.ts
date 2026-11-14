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
 * ## 尺寸 / 配件清单从哪来（2026-11-14 起是 DB）
 *
 * 尺寸清单 / 配件清单原先是 product-catalog.ts 的 PRODUCT_TYPES 常量。
 * 现在它们是**字典**（`catalog-dictionary.ts` —— 从 DB 读、代码常量兜底），
 * 后台能改尺寸加价、能加新尺寸 / 新配件。
 *
 * **SKU 编码规则一个字都没动** —— 变的只是「尺寸加价从哪儿来」：
 *
 * | | 以前 | 现在 |
 * |---|---|---|
 * | 尺寸加价 | `idx * 500`（按**下标**算） | 字典里的**显式** `priceDeltaCents` |
 * | 尺寸清单 | `PRODUCT_TYPES[].sizes` | `dictionary.sizesByType` |
 * | 配件清单 | `PRODUCT_TYPES[].accessories` | `dictionary.accessoryOptionsByType` |
 * | 配件变体加价 | `product_accessory_variant` 行 | 同左（**没变**） |
 *
 * ⚠️ **为什么尺寸加价必须改成显式的** —— 下标算出来的价，在尺寸数组中间插
 * 一档，后面每一档的价会**静默全变**（而且商城显示的加价跟 SKU 表里真实的
 * 绝对价会对不上）。显式的加价由后台决定，改哪一档只动哪一档。
 *
 * ⚠️ `SIZE_STEP_CENTS` 现在住在 `catalog-dictionary.ts`（那边要拿它生成
 * 兜底字典）—— **单一出处**，别在别处再写一份 500。
 */

import { BASE_PRICE_CENTS } from "@/features/gpt-image/lib/product-catalog";
import {
  type CatalogDictionary,
  accessoryCodesForType,
  sizeDeltaCentsFor,
} from "@/features/image-gen/lib/catalog-dictionary";

/** 该维度不存在时在 SKU 里占位的段 */
export const NO_SEGMENT = "N-A";

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
 * 初始价 = 商品 basePriceCents + **尺寸的显式加价** + 配件变体加价，
 * 与旧的前端拼价公式保持一致，所以 seed 当天线上价格零漂移。
 *
 * @param productCode       产品码
 * @param basePriceCents    该商品的 basePriceCents（DB 行优先，否则取字典）
 * @param dictionary        尺寸 / 配件字典（DB 优先，代码常量兜底）
 * @param accessoryVariants product_accessory_variant 全量行（本产品相关的会被过滤）
 * @param startSortOrder    sortOrder 起始值，便于追加
 */
export function buildVariantSeeds(opts: {
  productCode: string;
  /** 显式带 `| undefined`：exactOptionalPropertyTypes 下字典查不到的值要能直接传下去 */
  basePriceCents?: number | undefined;
  /** 尺寸 / 配件字典 —— 尺寸加价是**显式**的，不靠下标算 */
  dictionary: CatalogDictionary;
  accessoryVariants: readonly AccessoryVariantLike[];
  startSortOrder?: number | undefined;
}): VariantSeed[] {
  const {
    productCode,
    basePriceCents,
    dictionary,
    accessoryVariants,
    startSortOrder = 0,
  } = opts;

  const base = basePriceCents ?? BASE_PRICE_CENTS[productCode] ?? 0;
  const out: VariantSeed[] = [];
  let sort = startSortOrder;

  // 无配件的产品（RM）也要出 1 行，用 NO_SEGMENT 占位代表「不带配件」
  const accessoryCodes = accessoryCodesForType(dictionary, productCode);
  const accessories: readonly string[] =
    accessoryCodes.length > 0 ? accessoryCodes : [NO_SEGMENT];

  // 尺寸清单 —— 加价是**显式**的（字典里那一档写多少就是多少）
  const sizes = dictionary.sizesByType.get(productCode) ?? [];

  for (const size of sizes) {
    const sizeCode = size.code;
    const sizeDelta = size.priceDeltaCents;

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
 * 生成**全部**型号的 SKU 行。
 *
 * @param basePrices        productCode → basePriceCents（DB 行的价，优先于字典）
 * @param accessoryVariants product_accessory_variant 全量行
 * @param dictionary        尺寸 / 配件字典
 * @param productCodes      只生成这几个型号（默认 = 字典里的全部型号，按字典顺序）
 */
export function buildAllVariantSeeds(opts: {
  basePrices?: Record<string, number>;
  accessoryVariants: ReadonlyArray<
    AccessoryVariantLike & { productTypeCode: string }
  >;
  dictionary: CatalogDictionary;
  productCodes?: readonly string[];
}): VariantSeed[] {
  const {
    basePrices = {},
    accessoryVariants,
    dictionary,
    productCodes,
  } = opts;

  // ⚠️ 顺序 = 字典的 `typeOrder`（R / A / P / RM / LB / M）—— 跟今天的
  // `PRODUCT_TYPES` 顺序**逐字一致**。`buildAllVariantSeeds` 产出的行靠
  // `sortOrder` 排序,顺序变了 ⇒ 商城里 SKU 的摆法变了。
  const typeOrder = productCodes ?? dictionary.typeOrder;

  const out: VariantSeed[] = [];
  for (const code of typeOrder) {
    const mine = accessoryVariants.filter((v) => v.productTypeCode === code);
    out.push(
      ...buildVariantSeeds({
        productCode: code,
        basePriceCents: basePrices[code],
        dictionary,
        accessoryVariants: mine,
      })
    );
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  重算已有 SKU 行的价                                                        */
/* -------------------------------------------------------------------------- */

/** 已存在的 product_variant 行 —— 重算只需要这几个字段 */
export interface ExistingVariantRow {
  readonly id: string;
  readonly sizeCode: string;
  readonly accessoryCode: string;
  readonly variantCode: string;
}

/** 重算结果 —— 只回 id 和新价,调用方自己决定怎么落库 */
export interface RecomputedVariantPrice {
  readonly id: string;
  readonly priceCents: number;
}

/**
 * 按**新的基础价**重算已有 SKU 行的绝对价 —— 纯函数
 *
 * ## 为什么需要它
 *
 * 基础价是**唯一**的价源(工作室 2026-11-08 拍板)。后台改基础价,
 * `product_variant.price_cents` 必须跟着变 —— 否则小程序按 SKU 拿到的
 * 绝对价跟商城的价对不上,又是一轮「改了不生效」。
 *
 * ## 为什么不是「重新播种」
 *
 * `buildVariantSeeds()` 是**生成全部行**,重算要动的是**已经在库里的那些行** ——
 * 重新播种会丢 `sellbase_variant_id`(Sellbase 那边认这个 id)、会丢
 * `is_active` 的软下架状态、还会跟唯一的 SKU 索引打架。
 *
 * ## 算式跟播种完全一致
 *
 * ```
 * price = 基础价 + 尺寸加价(字典里的**显式**值) + 配件变体加价
 * ```
 *
 * 跟 `buildVariantSeeds()` 里的公式逐字一致 —— 两处算出来的价必须相同。
 *
 * ## 查不到就**跳过那一行**,不当成 0
 *
 * - **尺寸码不在字典里** —— 当成 0 会把那一行的尺寸加价**悄悄抹掉**,
 *   价直接算错。跳过 = 那一行保持原价(宁可不改,也不能改错)。
 * - **配件变体查不到加价** —— 同理,跳过。
 *
 * 「配件有码但没有变体行」(`variantCode = N-A`)**不是**查不到 ——
 * 播种时它就是 `base + 尺寸加价`,不加配件价。这条要跟播种口径一致。
 */
export function recomputeVariantPrices(opts: {
  basePriceCents: number;
  productCode: string;
  dictionary: CatalogDictionary;
  accessoryVariants: readonly AccessoryVariantLike[];
  existingRows: readonly ExistingVariantRow[];
}): RecomputedVariantPrice[] {
  const {
    basePriceCents,
    productCode,
    dictionary,
    accessoryVariants,
    existingRows,
  } = opts;

  // (配件码, 变体码) → 加价
  const deltaByKey = new Map<string, number>();
  for (const v of accessoryVariants) {
    deltaByKey.set(`${v.accessoryCode}::${v.variantCode}`, v.priceDeltaCents);
  }

  const out: RecomputedVariantPrice[] = [];
  for (const row of existingRows) {
    // 尺寸加价 —— 字典里的**显式**值(不是下标算出来的)
    const sizeDelta = sizeDeltaCentsFor(dictionary, productCode, row.sizeCode);
    if (sizeDelta === null) continue; // 尺寸不在字典里 → 跳过,别当成 0

    let accessoryDelta = 0;
    const hasVariant = row.variantCode !== NO_SEGMENT && row.variantCode !== "";
    if (hasVariant) {
      const found = deltaByKey.get(`${row.accessoryCode}::${row.variantCode}`);
      if (found === undefined) continue; // 配件变体查不到 → 跳过,别当成 0
      accessoryDelta = found;
    }

    out.push({
      id: row.id,
      priceCents: basePriceCents + sizeDelta + accessoryDelta,
    });
  }
  return out;
}
