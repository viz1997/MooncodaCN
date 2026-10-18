/**
 * 产品能力接口数据拼装层 —— 2026-10-18 v1.6.0
 *
 * 给 /api/image-gen/products 路由用的核心逻辑：把硬编码字典
 * (PRODUCT_TYPES / ACCESSORIES / PRODUCT_META / ACCESSORY_META)
 * + productAccessoryVariant DB 行
 * + productEffect + promptTemplate 数据
 * 拼成对外暴露的 ProductCapability[] 响应。
 *
 * 设计要点：
 * - 单次请求内 in-memory join,DB 读全部走 SQL 层一次拿完
 * - productAccessoryVariant 用 Map 索引,O(1) 查变体
 * - productEffect 的 allowedCapabilities 覆盖合并到 catalog 默认上
 *   (parseJsonCapabilities 只识别 4 个 LB flag,这里只覆盖 LB 关心的 flag;
 *    新加的 flag 如 canBraidedRopeColor 走 catalog 默认)
 * - 视觉风格按 (templateId, styleId) 去重聚合
 * - 零改动兼容老 productEffect 数据(productTypeCode=NULL 或 status=inactive
 *   自动跳过)
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import type {
  AccessoryDef,
  AccessoryVariantDef,
  ProductCapability,
  ProductCategory,
  ProductSizeDef,
  ProductTemplateSummary,
  TemplateStyle,
} from "@/db/image-gen-types";
import {
  productAccessoryVariant,
  productEffect,
  type promptTemplate,
} from "@/db/schema";
import {
  ACCESSORY_META,
  type AccessoryCode,
  getAccessoryMeta,
  getProductMeta,
  getProductType,
  PRODUCT_META,
} from "@/features/gpt-image/lib/product-catalog";

/* -------------------------------------------------------------------------- */
/*  字典读取                                                                  */
/* -------------------------------------------------------------------------- */

/** productAccessoryVariant 行 → AccessoryVariantDef(空 swatch 转 null) */
function mapVariantRow(
  row: typeof productAccessoryVariant.$inferSelect
): AccessoryVariantDef {
  return {
    code: row.variantCode,
    name: { zh: row.name, en: row.nameEn },
    swatch: row.swatch ?? null,
    priceDeltaCents: row.priceDeltaCents,
  };
}

/**
 * 一次性把 productAccessoryVariant 表的全量 active 行拉出来
 * 按 (productTypeCode, accessoryCode) 二维分组。路由层一次 query 复用。
 */
export async function getActiveVariantsByProduct(): Promise<
  Map<string, Map<AccessoryCode, AccessoryVariantDef[]>>
> {
  const rows = await db
    .select()
    .from(productAccessoryVariant)
    .where(eq(productAccessoryVariant.isActive, true));
  const out = new Map<string, Map<AccessoryCode, AccessoryVariantDef[]>>();
  for (const row of rows) {
    const productKey = row.productTypeCode;
    const accKey = row.accessoryCode as AccessoryCode;
    let inner = out.get(productKey);
    if (!inner) {
      inner = new Map();
      out.set(productKey, inner);
    }
    let arr = inner.get(accKey);
    if (!arr) {
      arr = [];
      inner.set(accKey, arr);
    }
    arr.push(mapVariantRow(row));
    // sortOrder 升序
    arr.sort((a, b) => a.code.localeCompare(b.code));
  }
  return out;
}

/**
 * 拉 active productEffect 列表 + 关联 promptTemplate 元数据
 * (outputMode / candidateCount / styles)
 *
 * 复用 db-effects.ts 的解析逻辑,本模块不做重复实现。这里直接走 Drizzle
 * query,自己 JOIN promptTemplate;不调 getActiveEffectsFromDb() 因为它的
 * mapper 是面向 ProductEffect 运行时类型,本模块需要原始的
 * allowedCapabilities JSON 字符串字段做覆盖合并。
 */
export async function getActiveProductEffectsWithTemplates(): Promise<
  Array<{
    effect: typeof productEffect.$inferSelect;
    template: typeof promptTemplate.$inferSelect | null;
  }>
> {
  const effects = await db.query.productEffect.findMany({
    where: eq(productEffect.status, "active"),
  });
  const templateIds = Array.from(
    new Set(
      effects
        .map((e) => e.promptTemplateId)
        .filter((id): id is string => Boolean(id))
    )
  );
  const templates =
    templateIds.length > 0
      ? await db.query.promptTemplate.findMany({
          where: (t, { inArray: ia }) => ia(t.id, templateIds),
        })
      : [];
  const tplMap = new Map(templates.map((t) => [t.id, t]));
  return effects
    .filter((e) => e.productTypeCode !== null && e.productTypeCode !== "")
    .map((e) => ({
      effect: e,
      template: e.promptTemplateId
        ? (tplMap.get(e.promptTemplateId) ?? null)
        : null,
    }));
}

/* -------------------------------------------------------------------------- */
/*  Query param 解析                                                          */
/* -------------------------------------------------------------------------- */

/**
 * 解析 ?productTypeCode=R,M,P 形式的过滤参数。
 * - 空 → null(返回全部)
 * - 包含未知 code → 抛错(防止拼错静默走全集)
 */
export function parseProductTypeCodes(raw: string | null): string[] | null {
  if (!raw) return null;
  const codes = raw
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (codes.length === 0) return null;
  for (const c of codes) {
    if (!getProductMeta(c)) {
      throw new Error(`未知的产品码: ${c}`);
    }
  }
  return codes;
}

/**
 * 推断 locale —— query 优先,再 Accept-Language,默认 zh。
 */
export function resolveLocale(
  request: Request,
  queryParam: string | null
): "zh" | "en" {
  if (queryParam === "zh" || queryParam === "en") return queryParam;
  const accept = request.headers.get("accept-language") ?? "";
  if (/\ben\b/i.test(accept)) return "en";
  return "zh";
}

/* -------------------------------------------------------------------------- */
/*  Assemble                                                                  */
/* -------------------------------------------------------------------------- */

/** 把 allowedCapabilities JSON 字符串解析为 Partial<ProductCapabilities>。
 * 与 db-effects.ts:parseJsonCapabilities 等价但不走 ProductEffect mapper */
function parseAllowedCapabilities(raw: string | null): Partial<{
  canLeatherColor: boolean;
  canPvcProtection: boolean;
  canLeatherExposed: boolean;
  canHaveRemarks: boolean;
}> {
  if (!raw) return {};
  try {
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Partial<{
      canLeatherColor: boolean;
      canPvcProtection: boolean;
      canLeatherExposed: boolean;
      canHaveRemarks: boolean;
    }> = {};
    const o = obj as Record<string, unknown>;
    if (typeof o.canLeatherColor === "boolean")
      out.canLeatherColor = o.canLeatherColor;
    if (typeof o.canPvcProtection === "boolean")
      out.canPvcProtection = o.canPvcProtection;
    if (typeof o.canLeatherExposed === "boolean")
      out.canLeatherExposed = o.canLeatherExposed;
    if (typeof o.canHaveRemarks === "boolean")
      out.canHaveRemarks = o.canHaveRemarks;
    return out;
  } catch {
    return {};
  }
}

/** JSON 字符串数组列解析(允许 accessary/size 白名单) */
function parseJsonStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/** 把模板 styles 数组(已经 Drizzle 类型化为 TemplateStyle[]) 规范化为
 * 严格 TemplateStyle 数组,过滤无效项 */
function sanitizeStyles(raw: unknown): TemplateStyle[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is TemplateStyle =>
      !!s &&
      typeof s === "object" &&
      typeof (s as TemplateStyle).id === "string"
  );
}

/**
 * 拼装最终响应:把 effects + 字典 + 变体表 → ProductCapability[]
 *
 * @param effects          active productEffect + promptTemplate 列表
 * @param variantsByProduct  productAccessoryVariant 按 (product, accessory) 索引
 * @param filterCodes      query 过滤;null = 全量
 * @param keyScope         externalApiKey 白名单(maskId 列表);null = 不过滤
 * @returns                按 productTypeCode 升序的产品数组
 */
export function assembleProductCapabilities(
  effects: Awaited<ReturnType<typeof getActiveProductEffectsWithTemplates>>,
  variantsByProduct: Awaited<ReturnType<typeof getActiveVariantsByProduct>>,
  filterCodes: string[] | null,
  keyScope: string[] | null
): ProductCapability[] {
  // 按 productTypeCode 分组 effects
  const grouped = new Map<
    string,
    Awaited<ReturnType<typeof getActiveProductEffectsWithTemplates>>
  >();
  for (const entry of effects) {
    const code = entry.effect.productTypeCode;
    if (!code) continue;
    // 白名单过滤(per-template)
    if (
      keyScope &&
      keyScope.length > 0 &&
      !keyScope.includes(entry.effect.id)
    ) {
      continue;
    }
    let arr = grouped.get(code);
    if (!arr) {
      arr = [];
      grouped.set(code, arr);
    }
    arr.push(entry);
  }

  const out: ProductCapability[] = [];

  // 按 productTypeCode 字母序输出(稳定)
  const sortedCodes = Array.from(grouped.keys()).sort();
  for (const code of sortedCodes) {
    if (filterCodes && !filterCodes.includes(code)) continue;

    const productType = getProductType(code);
    const productMeta = getProductMeta(code);
    if (!productType || !productMeta) continue; // 字典过期,跳过

    const entries = grouped.get(code) ?? [];

    // ----- sizes -----
    const sizes: ProductSizeDef[] = productType.sizes.map((sizeCode, idx) => ({
      code: sizeCode,
      label: {
        zh: `${sizeCode}${productType.unit}`,
        en: `${sizeCode} ${productType.unit}`,
      },
      // 与 mock-catalog.ts:buildSizesForType 同款加价规则(>基准 cm ×¥5),
      // 统一在 /api/store/products 也有此模式。
      priceDeltaCents: idx * 500,
    }));

    // ----- accessories + variants -----
    const variantsInner = variantsByProduct.get(code) ?? new Map();
    const accessories: AccessoryDef[] = productType.accessories.map(
      (accCode) => {
        const meta = getAccessoryMeta(accCode) ?? {
          category: "decor" as const,
          name: { zh: accCode, en: accCode },
        };
        const variants = (variantsInner.get(accCode) ?? []).slice();
        // 默认价差:有变体时价差由变体决定,无变体时给 0(允许后续从 catalog 扩展)
        const defaultPrice = variants.length > 0 ? 0 : 0;
        return {
          code: accCode,
          name: meta.name,
          category: meta.category,
          priceDeltaCents: defaultPrice,
          variants,
          requiresCapability: null,
        } satisfies AccessoryDef;
      }
    );

    // ----- templates -----
    const visualStylesSet = new Map<string, TemplateStyle>();
    const templates: ProductTemplateSummary[] = entries.map((entry) => {
      const e = entry.effect;
      const t = entry.template;
      const styles = sanitizeStyles(t?.styles ?? []);
      for (const s of styles) {
        if (!visualStylesSet.has(s.id)) visualStylesSet.set(s.id, s);
      }
      return {
        templateId: e.id,
        name: { zh: e.name, en: e.name },
        cover: e.previewUrl ?? "",
        costCredits: e.price ?? 0,
        outputMode: (t?.outputMode ?? "grid") as "grid" | "separate",
        candidateCount: t?.candidateCount ?? 1,
        visualStyles: styles,
        allowedAccessories: parseJsonStringArray(e.allowedAccessories),
      };
    });

    // ----- capabilities(合并 catalog 默认 + 模板级覆盖) -----
    // 先取 catalog 默认
    const baseCaps = productType.capabilities;
    // 合并所有模板的 allowedCapabilities 覆盖(取交集:任一模板显式 false 即 false)
    const overrideKeys = [
      "canLeatherColor",
      "canPvcProtection",
      "canLeatherExposed",
      "canHaveRemarks",
    ] as const;
    const merged = { ...baseCaps };
    for (const entry of entries) {
      const ov = parseAllowedCapabilities(entry.effect.allowedCapabilities);
      for (const k of overrideKeys) {
        if (k in ov && ov[k] === false) merged[k] = false;
      }
    }

    out.push({
      productTypeCode: code,
      category: productMeta.category as ProductCategory,
      displayName: productMeta.displayName,
      description: productMeta.description,
      cover: templates[0]?.cover ?? "",
      sizes,
      visualStyles: Array.from(visualStylesSet.values()),
      accessories,
      capabilities: merged,
      templates,
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/*  路由装配(one-shot)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 路由层调用入口:一次拿 DB 数据 + 拼装 + 过滤。
 * 避免路由层处理两阶段(先 await 再调 assemble)。
 */
export async function loadProductCapabilities(opts: {
  filterCodes: string[] | null;
  keyScope: string[] | null;
}): Promise<ProductCapability[]> {
  const [effects, variantsByProduct] = await Promise.all([
    getActiveProductEffectsWithTemplates(),
    getActiveVariantsByProduct(),
  ]);
  return assembleProductCapabilities(
    effects,
    variantsByProduct,
    opts.filterCodes,
    opts.keyScope
  );
}

/* -------------------------------------------------------------------------- */
/*  内部细节校验(单元测试可单独引)                                            */
/* -------------------------------------------------------------------------- */
export const _internals = {
  parseAllowedCapabilities,
  parseJsonStringArray,
  sanitizeStyles,
};

/** re-export 给路由层用(便于单行 import) */
export { getProductMeta, PRODUCT_META, ACCESSORY_META };
