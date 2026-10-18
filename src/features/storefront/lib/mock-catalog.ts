/**
 * Mock 产品目录(对齐 Medusa Store API 简化版)
 *
 * 从 PRODUCT_TYPES 字典(R/A/P/RM/LB/M)+ WJP_SERIES 3 系列生成 12 个
 * 静态产品(对齐 atelier 4 keychain + 4 figure + 4 magnet 计数)。
 *
 * 切真 Medusa 时:此文件作废,/api/store/products 直接转发到 Medusa。
 *
 * 数据来源:
 *  - PRODUCT_TYPES: src/features/gpt-image/lib/product-catalog.ts
 *  - WJP_SERIES: src/features/marketing/components/storefront/wjp-store-data.ts
 */

import {
  type AccessoryCode,
  BASE_PRICE_CENTS,
  getProductType,
  PRODUCT_TYPES,
} from "@/features/gpt-image/lib/product-catalog";
import {
  DEFAULT_TEMPLATE_STYLES,
  findStyleInList,
} from "@/features/image-gen/lib/ai-styles";
import {
  WJP_SERIES,
  type WjpSeries,
} from "@/features/marketing/components/storefront/wjp-store-data";

import type {
  AiStyle,
  Material,
  ProductTypeCode,
  Size,
  StorefrontProduct,
} from "../types";

/* -------------------------------------------------------------------------- */
/*  全局字典                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 2026-10-16 v1.5.0:AI 视觉字典的设计改为「每个 promptTemplate 自带
 * styles 数组」(语义对齐「替换关键提示词」)。原 AiStyle 真理源
 * DEFAULT_TEMPLATE_STYLES 现在落在 src/features/image-gen/lib/ai-styles.ts
 * 当默认种子使用。
 *
 * 这里 re-export 保持 storefront mock 流的所有调用(`AI_STYLES` 全局数组、
 * `findAiStyle` 查询函数)不断。注意:storefront mock 出的 aiStyles 用
 * 的是同一份 5 项种子,但概念上 storefront 这边是「mock commerce
 * product 的可叠加 AI 风格」,与 image-gen 那边的「生图替换关键提示词」
 * 不是一回事 —— 切真 Medusa 时 storefront 这条链路会独立走 Medusa
 * metadata,届时一起清理。
 */
const AI_STYLES: AiStyle[] = DEFAULT_TEMPLATE_STYLES.map((s) => ({
  id: s.id,
  name: s.name,
  nameEn: s.nameEn,
  prompt: s.prompt,
  surchargeCents: s.surchargeCents,
  outputSize: s.outputSize,
  swatch: s.swatch,
  estimatedLatencySec: s.estimatedLatencySec,
}));
export { AI_STYLES };
export type { AiStyle };

/**
 * 材质字典(按 productTypeCode 过滤)
 */
const MATERIALS_BY_TYPE: Record<ProductTypeCode, Material[]> = {
  R: [
    {
      id: "mat_resin",
      name: "树脂",
      nameEn: "Resin",
      surchargeCents: 0,
      appliesTo: ["R"],
    },
    {
      id: "mat_metal",
      name: "金属",
      nameEn: "Metal",
      surchargeCents: 800,
      appliesTo: ["R"],
    },
  ],
  A: [
    {
      id: "mat_resin",
      name: "树脂",
      nameEn: "Resin",
      surchargeCents: 0,
      appliesTo: ["A"],
    },
  ],
  P: [
    {
      id: "mat_resin",
      name: "树脂",
      nameEn: "Resin",
      surchargeCents: 0,
      appliesTo: ["P"],
    },
  ],
  RM: [
    {
      id: "mat_resin",
      name: "树脂",
      nameEn: "Resin",
      surchargeCents: 0,
      appliesTo: ["RM"],
    },
  ],
  LB: [
    {
      id: "mat_leather",
      name: "真皮",
      nameEn: "Leather",
      surchargeCents: 600,
      appliesTo: ["LB"],
    },
    {
      id: "mat_synthetic",
      name: "合成皮",
      nameEn: "Synthetic",
      surchargeCents: 0,
      appliesTo: ["LB"],
    },
  ],
  M: [
    {
      id: "mat_resin_premium",
      name: "高级树脂",
      nameEn: "Premium Resin",
      surchargeCents: 0,
      appliesTo: ["M"],
    },
  ],
};

/**
 * 尺寸加价字典(超过基准尺寸按 cm 加价)
 * 基准:每个型号最小尺寸。超过 1cm +¥5
 */
function buildSizesForType(code: ProductTypeCode): Size[] {
  const type = getProductType(code);
  if (!type) return [];
  return type.sizes.map((sizeStr, idx) => {
    const cm = Number(sizeStr);
    const surchargeCents = idx * 500; // 4cm 基准 +0, 5cm +¥5, 6cm +¥10 ...
    return {
      id: `size_${code}_${cm}`,
      cm,
      surchargeCents,
      appliesTo: [code],
    };
  });
}

const SIZES_BY_TYPE: Record<ProductTypeCode, Size[]> = {
  R: buildSizesForType("R"),
  A: buildSizesForType("A"),
  P: buildSizesForType("P"),
  RM: buildSizesForType("RM"),
  LB: buildSizesForType("LB"),
  M: buildSizesForType("M"),
};

/* -------------------------------------------------------------------------- */
/*  12 个 mock products(对齐 atelier 4+4+4)                                 */
/* -------------------------------------------------------------------------- */

// 产品基价(分)字典 —— 真理源在 product-catalog.ts 的 BASE_PRICE_CENTS,
// 这里直接 import 用(切真 Medusa 时统一改成读 Medusa 价格)。

interface MockProductSeed {
  handle: string;
  title: string;
  titleEn: string;
  subtitle: string;
  description: string;
  thumbnail: string;
  images: string[];
  productTypeCode: ProductTypeCode;
  seriesHandle: string;
  accent: string;
  tags: string[];
  rating: number;
  ratingCount: number;
  badge?: string;
  leadTimeDays: number;
  cover: string;
}

const SEEDS: MockProductSeed[] = [
  // ── Keychain 系列(R + A,4 个)──────────────────────────────────────
  {
    handle: "keychain-pet-portrait",
    title: "萌宠肖像钥匙扣",
    titleEn: "Pet Portrait Keychain",
    subtitle: "把爱宠挂在书包上",
    description:
      "WJP 全彩树脂钥匙扣,激光切割按照片轮廓,5cm 标准款,支持皮套/金属配件,适合日常随身携带。",
    thumbnail:
      "https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=1200&q=80",
    ],
    productTypeCode: "R",
    seriesHandle: "keychain",
    accent: "#B07A5B",
    tags: ["宠物", "钥匙扣", "礼物"],
    rating: 4.9,
    ratingCount: 1280,
    badge: "Best Seller",
    leadTimeDays: 5,
    cover:
      "https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=600&q=80",
  },
  {
    handle: "keychain-couple",
    title: "情侣合影钥匙扣",
    titleEn: "Couple Portrait Keychain",
    subtitle: "两个人的日常",
    description:
      "WJP 全彩树脂钥匙扣,4cm 紧凑款,适合情侣互换佩戴,激光切割双面印图,金属配件质感。",
    thumbnail:
      "https://images.unsplash.com/photo-1518621736915-f3b1c41bfd00?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1518621736915-f3b1c41bfd00?auto=format&fit=crop&w=1200&q=80",
    ],
    productTypeCode: "R",
    seriesHandle: "keychain",
    accent: "#B07A5B",
    tags: ["情侣", "钥匙扣"],
    rating: 4.8,
    ratingCount: 956,
    leadTimeDays: 5,
    cover:
      "https://images.unsplash.com/photo-1518621736915-f3b1c41bfd00?auto=format&fit=crop&w=600&q=80",
  },
  {
    handle: "keychain-baby-shape",
    title: "宝宝异形钥匙扣",
    titleEn: "Baby Silhouette Keychain",
    subtitle: "按轮廓剪切,独一无二",
    description: "异性款钥匙扣,按宝宝/宠物照片轮廓激光切割,支架配件,适合送礼。",
    thumbnail:
      "https://images.unsplash.com/photo-1519689680058-324335c77eba?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1519689680058-324335c77eba?auto=format&fit=crop&w=1200&q=80",
    ],
    productTypeCode: "A",
    seriesHandle: "keychain",
    accent: "#B07A5B",
    tags: ["宝宝", "异形", "钥匙扣"],
    rating: 4.9,
    ratingCount: 612,
    badge: "New",
    leadTimeDays: 5,
    cover:
      "https://images.unsplash.com/photo-1519689680058-324335c77eba?auto=format&fit=crop&w=600&q=80",
  },
  {
    handle: "keychain-travel",
    title: "旅行纪念钥匙扣",
    titleEn: "Travel Memory Keychain",
    subtitle: "把旅行记忆随身带",
    description: "风景照钥匙扣,4cm 紧凑款,皮套配件,适合旅行纪念。",
    thumbnail:
      "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=80",
    ],
    productTypeCode: "A",
    seriesHandle: "keychain",
    accent: "#B07A5B",
    tags: ["旅行", "钥匙扣"],
    rating: 4.7,
    ratingCount: 423,
    leadTimeDays: 5,
    cover:
      "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=600&q=80",
  },

  // ── Figure 系列(M,4 个)───────────────────────────────────────
  {
    handle: "figure-portrait-statue",
    title: "真人 Q 版手办",
    titleEn: "Portrait Q-Version Figure",
    subtitle: "照片雕塑,8cm 标准款",
    description:
      "WJP 全彩树脂 3D 打印,真人照片雕塑化,8cm 高,手工上色,底座配件,送礼最个性。",
    thumbnail:
      "https://images.unsplash.com/photo-1558997767-920fa5b75e6e?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1558997767-920fa5b75e6e?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=1200&q=80",
    ],
    productTypeCode: "M",
    seriesHandle: "figure",
    accent: "#7A5A8C",
    tags: ["手办", "雕塑", "礼物"],
    rating: 4.95,
    ratingCount: 743,
    badge: "Best Seller",
    leadTimeDays: 10,
    cover:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=600&q=80",
  },
  {
    handle: "figure-couple-statue",
    title: "情侣雕塑手办",
    titleEn: "Couple Statue Figure",
    subtitle: "两个人的纪念",
    description: "WJP 全彩树脂 3D 打印,情侣合影雕塑化,10cm 标准款,底座配件。",
    thumbnail:
      "https://images.unsplash.com/photo-1525338078858-d762b5e32f2c?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1525338078858-d762b5e32f2c?auto=format&fit=crop&w=1200&q=80",
    ],
    productTypeCode: "M",
    seriesHandle: "figure",
    accent: "#7A5A8C",
    tags: ["情侣", "手办"],
    rating: 4.9,
    ratingCount: 512,
    leadTimeDays: 10,
    cover:
      "https://images.unsplash.com/photo-1525338078858-d762b5e32f2c?auto=format&fit=crop&w=600&q=80",
  },
  {
    handle: "figure-pet-statue",
    title: "宠物雕塑手办",
    titleEn: "Pet Statue Figure",
    subtitle: "爱宠永远陪在身边",
    description: "WJP 全彩树脂 3D 打印,宠物照片雕塑化,8cm 标准款,底座配件。",
    thumbnail:
      "https://images.unsplash.com/photo-1543465077-db45d34b88a5?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1543465077-db45d34b88a5?auto=format&fit=crop&w=1200&q=80",
    ],
    productTypeCode: "M",
    seriesHandle: "figure",
    accent: "#7A5A8C",
    tags: ["宠物", "手办"],
    rating: 4.85,
    ratingCount: 389,
    badge: "Limited",
    leadTimeDays: 10,
    cover:
      "https://images.unsplash.com/photo-1543465077-db45d34b88a5?auto=format&fit=crop&w=600&q=80",
  },
  {
    handle: "figure-baby-statue",
    title: "宝宝周岁雕塑",
    titleEn: "Baby First-Year Statue",
    subtitle: "周岁纪念礼物",
    description:
      "WJP 全彩树脂 3D 打印,宝宝周岁照雕塑化,12cm 标准款,底座刻字配件。",
    thumbnail:
      "https://images.unsplash.com/photo-1492725764893-90b379c2b6e7?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1492725764893-90b379c2b6e7?auto=format&fit=crop&w=1200&q=80",
    ],
    productTypeCode: "M",
    seriesHandle: "figure",
    accent: "#7A5A8C",
    tags: ["宝宝", "手办", "周岁"],
    rating: 4.92,
    ratingCount: 267,
    badge: "New",
    leadTimeDays: 10,
    cover:
      "https://images.unsplash.com/photo-1492725764893-90b379c2b6e7?auto=format&fit=crop&w=600&q=80",
  },

  // ── Magnet 系列(P + RM + LB,4 个)──────────────────────────────
  {
    handle: "magnet-pet-fridge",
    title: "萌宠冰箱贴",
    titleEn: "Pet Fridge Magnet",
    subtitle: "每天都能看到",
    description: "WJP 全彩树脂冰箱贴 5cm,适合合影/宠物照/孩子画作,磁铁配件。",
    thumbnail:
      "https://images.unsplash.com/photo-1611923134239-b9be5816e23d?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1611923134239-b9be5816e23d?auto=format&fit=crop&w=1200&q=80",
      "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=1200&q=80",
    ],
    productTypeCode: "P",
    seriesHandle: "magnet",
    accent: "#8FA873",
    tags: ["宠物", "冰箱贴"],
    rating: 4.8,
    ratingCount: 832,
    badge: "Best Seller",
    leadTimeDays: 4,
    cover:
      "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=600&q=80",
  },
  {
    handle: "magnet-couple-fridge",
    title: "情侣合影冰箱贴",
    titleEn: "Couple Fridge Magnet",
    subtitle: "记录每个纪念日",
    description: "WJP 全彩树脂冰箱贴 6cm,适合情侣/夫妻合影,磁铁配件。",
    thumbnail:
      "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?auto=format&fit=crop&w=1200&q=80",
    ],
    productTypeCode: "P",
    seriesHandle: "magnet",
    accent: "#8FA873",
    tags: ["情侣", "冰箱贴"],
    rating: 4.75,
    ratingCount: 421,
    leadTimeDays: 4,
    cover:
      "https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?auto=format&fit=crop&w=600&q=80",
  },
  {
    handle: "magnet-frame-6",
    title: "相框摆件",
    titleEn: "Photo Frame Magnet",
    subtitle: "桌面纪念摆件",
    description: "WJP 全彩树脂相框 8cm,无配件,适合桌面摆放,刻字祝福。",
    thumbnail:
      "https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?auto=format&fit=crop&w=1200&q=80",
    ],
    productTypeCode: "RM",
    seriesHandle: "magnet",
    accent: "#8FA873",
    tags: ["相框", "摆件"],
    rating: 4.7,
    ratingCount: 234,
    leadTimeDays: 6,
    cover:
      "https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?auto=format&fit=crop&w=600&q=80",
  },
  {
    handle: "magnet-leather-badge",
    title: "真皮徽章",
    titleEn: "Leather Badge Magnet",
    subtitle: "皮具工艺纪念",
    description:
      "WJP 真皮徽章 6cm,皮套/金属配件,可刻字,适合企业 logo / 团队纪念。",
    thumbnail:
      "https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?auto=format&fit=crop&w=800&q=80",
    images: [
      "https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?auto=format&fit=crop&w=1200&q=80",
    ],
    productTypeCode: "LB",
    seriesHandle: "magnet",
    accent: "#8FA873",
    tags: ["皮革", "徽章", "企业"],
    rating: 4.85,
    ratingCount: 187,
    badge: "Limited",
    leadTimeDays: 7,
    cover:
      "https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?auto=format&fit=crop&w=600&q=80",
  },
];

/* -------------------------------------------------------------------------- */
/*  派生                                                                    */
/* -------------------------------------------------------------------------- */

function findSeries(handle: string): WjpSeries | undefined {
  return WJP_SERIES.find((s) => s.handle === handle);
}

function buildTypeLabel(code: ProductTypeCode, lang: "zh" | "en"): string {
  const type = PRODUCT_TYPES.find((t) => t.code === code);
  if (!type) return code;
  return lang === "zh" ? type.name : code;
}

function buildMockProducts(): StorefrontProduct[] {
  return SEEDS.map((seed) => {
    const series = findSeries(seed.seriesHandle);
    const basePriceCents = BASE_PRICE_CENTS[seed.productTypeCode] ?? 0;
    return {
      id: `prod_${seed.handle}`,
      handle: seed.handle,
      title: seed.title,
      titleEn: seed.titleEn,
      subtitle: seed.subtitle,
      description: seed.description,
      thumbnail: seed.thumbnail,
      images: seed.images,
      originalPhoto: seed.cover,
      finishedPhoto: seed.thumbnail,
      productTypeCode: seed.productTypeCode,
      seriesId: series?.id ?? "",
      seriesName: series?.name ?? "",
      accent: seed.accent,
      tags: seed.tags,
      rating: seed.rating,
      ratingCount: seed.ratingCount,
      badge: seed.badge,
      basePriceCents,
      leadTimeDays: seed.leadTimeDays,
      materials: MATERIALS_BY_TYPE[seed.productTypeCode],
      sizes: SIZES_BY_TYPE[seed.productTypeCode],
      aiStyles: AI_STYLES,
      typeLabel: buildTypeLabel(seed.productTypeCode, "zh"),
      typeLabelEn: buildTypeLabel(seed.productTypeCode, "en"),
    };
  });
}

/**
 * Mock 产品目录(12 个,server-side 只读)
 */
export const MOCK_PRODUCTS = buildMockProducts();

/* -------------------------------------------------------------------------- */
/*  查询函数                                                                 */
/* -------------------------------------------------------------------------- */

export function findProductByHandle(handle: string): StorefrontProduct | null {
  return MOCK_PRODUCTS.find((p) => p.handle === handle) ?? null;
}

export function findProductById(id: string): StorefrontProduct | null {
  return MOCK_PRODUCTS.find((p) => p.id === id) ?? null;
}

export function findAiStyle(aiStyleId: string): AiStyle | null {
  // 2026-10-16 v1.5.0:字典源已迁到 image-gen/lib/ai-styles.ts 的
  // DEFAULT_TEMPLATE_STYLES,通过 findStyleInList 查找(返回
  // TemplateStyle | undefined)。这里 wrap 一层 undefined → null 保持
  // storefront 旧消费方(`/api/store/ai/transform`、`pricing.ts`、
  // `customization-spec.ts` 等)签名兼容。切真 Medusa 时一并清理。
  const found = findStyleInList(DEFAULT_TEMPLATE_STYLES, aiStyleId);
  if (!found) return null;
  return {
    id: found.id,
    name: found.name,
    nameEn: found.nameEn,
    prompt: found.prompt,
    surchargeCents: found.surchargeCents,
    outputSize: found.outputSize,
    swatch: found.swatch,
    estimatedLatencySec: found.estimatedLatencySec,
  };
}

export function findMaterial(materialId: string): Material | null {
  for (const list of Object.values(MATERIALS_BY_TYPE)) {
    const m = list.find((mat) => mat.id === materialId);
    if (m) return m;
  }
  return null;
}

export function findSize(sizeId: string): Size | null {
  for (const list of Object.values(SIZES_BY_TYPE)) {
    const s = list.find((sz) => sz.id === sizeId);
    if (s) return s;
  }
  return null;
}

/**
 * 按系列 handle 过滤(用于 /api/store/products?series=keychain)
 */
export function filterBySeries(
  products: StorefrontProduct[],
  seriesHandle: string
): StorefrontProduct[] {
  return products.filter((p) => {
    const series = WJP_SERIES.find((s) => s.id === p.seriesId);
    return series?.handle === seriesHandle;
  });
}

/**
 * 按 productTypeCode 过滤(用于 /api/store/products?type=R)
 */
export function filterByTypeCode(
  products: StorefrontProduct[],
  code: ProductTypeCode | AccessoryCode
): StorefrontProduct[] {
  return products.filter((p) => p.productTypeCode === code);
}

/**
 * 找相关产品(同系列,排除自己,取前 4 个)
 */
export function findRelatedProducts(
  handle: string,
  limit = 4
): StorefrontProduct[] {
  const product = findProductByHandle(handle);
  if (!product) return [];
  return MOCK_PRODUCTS.filter(
    (p) => p.seriesId === product.seriesId && p.handle !== handle
  ).slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/*  2026-10-18 v1.6.0:配件变体字典                                            */
/* -------------------------------------------------------------------------- */
// 与 /api/image-gen/products 路由 + productAccessoryVariant DB 行对齐的
// mock 数据,供 storefront UI（如未来想展示「编织绳 8 色」「玻璃罩 3 尺寸」）
// 直接消费。真数据从 /api/image-gen/products 拉,这里只是 mock 兜底。
//
// 不并入 MATERIALS_BY_TYPE —— 那是「材质」单选项（一件钥匙扣只能选皮或
// 金属），新加的「变体」是多选项（一件钥匙扣选 braided_rope 后还要再选
// 8 个颜色）。语义不同,分开维护。

/** R 钥匙扣 + 编织绳 8 色 mock(与 DB seed 一致) */
export const BRAIDED_ROPE_COLORS: Array<{
  code: string;
  name: { zh: string; en: string };
  swatch: string;
}> = [
  { code: "rope_red", name: { zh: "正红", en: "Red" }, swatch: "#C0392B" },
  { code: "rope_black", name: { zh: "墨黑", en: "Black" }, swatch: "#1A1A1A" },
  {
    code: "rope_blue",
    name: { zh: "宝蓝", en: "Royal Blue" },
    swatch: "#1F4E79",
  },
  {
    code: "rope_green",
    name: { zh: "森林绿", en: "Forest Green" },
    swatch: "#2E5E3A",
  },
  {
    code: "rope_yellow",
    name: { zh: "明黄", en: "Yellow" },
    swatch: "#E8C547",
  },
  {
    code: "rope_purple",
    name: { zh: "丁香紫", en: "Lilac" },
    swatch: "#8B5A9F",
  },
  {
    code: "rope_white",
    name: { zh: "米白", en: "Off-White" },
    swatch: "#F5F0E8",
  },
  {
    code: "rope_brown",
    name: { zh: "焦糖棕", en: "Caramel" },
    swatch: "#A0734A",
  },
];

/** M 手办 + 底座 3 种材质 mock(与 DB seed 一致) */
export const STAND_TYPES: Array<{
  code: string;
  name: { zh: string; en: string };
}> = [
  { code: "stand_magnetic", name: { zh: "磁性底座", en: "Magnetic" } },
  { code: "stand_wooden", name: { zh: "木质底座", en: "Wooden" } },
  { code: "stand_clear", name: { zh: "透明亚克力底座", en: "Clear Acrylic" } },
];

/** M 手办 + 玻璃罩 3 种尺寸 mock(与 DB seed 一致) */
export const GLASS_COVER_SIZES: Array<{
  code: string;
  name: { zh: string; en: string };
}> = [
  { code: "glass_4", name: { zh: "4cm 玻璃罩", en: "4cm Glass Cover" } },
  { code: "glass_6", name: { zh: "6cm 玻璃罩", en: "6cm Glass Cover" } },
  { code: "glass_8", name: { zh: "8cm 玻璃罩", en: "8cm Glass Cover" } },
];
