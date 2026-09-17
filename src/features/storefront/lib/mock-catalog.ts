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
  getProductType,
  PRODUCT_TYPES,
} from "@/features/gpt-image/lib/product-catalog";

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
 * AI 风格字典(对齐 atelier `pricing.config.aiStyles`)
 * `ai_original` 短路(不调 AI);其他 4 种委托 lingting/wellapi
 */
export const AI_STYLES: AiStyle[] = [
  {
    id: "ai_original",
    name: "原图保留",
    nameEn: "Original",
    surchargeCents: 0,
    prompt: "", // 不调用 AI
    outputSize: "1024x1024",
    swatch: "#9CA3AF",
    estimatedLatencySec: 0,
  },
  {
    id: "ai_qversion",
    name: "Q 版萌系",
    nameEn: "Q-Version",
    surchargeCents: 1500, // +¥15
    prompt:
      "Transform the photo into a cute Q-version anime-style figurine with simplified features, big eyes, and soft pastel tones. Keep the subject's identity recognizable.",
    outputSize: "1024x1024",
    swatch: "#7A5A8C",
    estimatedLatencySec: 25,
  },
  {
    id: "ai_anime",
    name: "日漫风",
    nameEn: "Anime",
    surchargeCents: 2000, // +¥20
    prompt:
      "Convert the photo into a Japanese anime illustration style with vibrant colors, clean line art, and detailed shading. Preserve facial features and hairstyle.",
    outputSize: "1024x1024",
    swatch: "#E879F9",
    estimatedLatencySec: 28,
  },
  {
    id: "ai_watercolor",
    name: "水彩手绘",
    nameEn: "Watercolor",
    surchargeCents: 1500, // +¥15
    prompt:
      "Render the photo as a soft watercolor painting with visible brushstrokes, gentle color bleeds, and warm light. Maintain recognizable silhouette.",
    outputSize: "1024x1024",
    swatch: "#60A5FA",
    estimatedLatencySec: 22,
  },
  {
    id: "ai_lineart",
    name: "线稿简笔",
    nameEn: "Line Art",
    surchargeCents: 1000, // +¥10
    prompt:
      "Convert the photo into clean black-and-white line art suitable for engraving. Bold outlines, no shading, simplified details for laser-cut reproduction.",
    outputSize: "1024x1024",
    swatch: "#1F2937",
    estimatedLatencySec: 18,
  },
];

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

/**
 * 产品基价(分)字典
 */
const BASE_PRICE_CENTS: Record<ProductTypeCode, number> = {
  R: 1900, // ¥19 钥匙扣
  A: 2400, // ¥24 异性钥匙扣
  P: 3900, // ¥39 冰箱贴
  RM: 4900, // ¥49 相框
  LB: 5900, // ¥59 皮革徽章
  M: 19900, // ¥199 手办
};

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
    const basePriceCents = BASE_PRICE_CENTS[seed.productTypeCode];
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
  return AI_STYLES.find((s) => s.id === aiStyleId) ?? null;
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
