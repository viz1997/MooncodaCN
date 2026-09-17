/**
 * Mock Medusa Storefront 类型
 *
 * 形状严格对齐 Medusa Store API(products / carts / line-items)+ atelier
 * `CustomizationSpec` / `PricingResult`,切真 Medusa 时只改 Route Handlers
 * 实现,client 端 use-cart / use-products / use-quick-view 一行不改。
 *
 * 参考:
 *  - https://docs.medusajs.com/api/store (products, carts, line-items)
 *  - D:\下载\atelier-source\src\lib\store\types.ts (Product / CartItem / CustomOption)
 *  - D:\下载\atelier-source\src\lib\store\customization-spec.ts (CustomizationSpec / PricingResult)
 *  - [[mooncada-medusa-integration]] Medusa 集成架构
 */

/* -------------------------------------------------------------------------- */
/*  Product / Variant(对齐 Medusa Store Product schema)                       */
/* -------------------------------------------------------------------------- */

/**
 * Medusa ProductType.value 形式:"R" / "A" / "P" / "RM" / "LB" / "M"
 * 来自 src/features/gpt-image/lib/product-catalog.ts 的 PRODUCT_TYPES 字典
 */
export type ProductTypeCode = "R" | "A" | "P" | "RM" | "LB" | "M";

export type ProductCategory =
  | "keychain" // 钥匙扣 — R + A
  | "figure" // Q 版手办 — M
  | "magnet"; // 冰箱贴 — P + RM + LB

/** 实物材质(对齐 atelier Material) */
export interface Material {
  id: string;
  name: string;
  nameEn: string;
  /** 加价(分),0 表示不加价 */
  surchargeCents: number;
  /** 适用 productTypeCode 列表 */
  appliesTo: ProductTypeCode[];
}

/** 尺寸(对齐 atelier Size) */
export interface Size {
  id: string;
  /** 厘米,数字 */
  cm: number;
  /** 加价(分) */
  surchargeCents: number;
  /** 适用 productTypeCode 列表 */
  appliesTo: ProductTypeCode[];
}

/** AI 风格(对齐 atelier AiStyle) */
export interface AiStyle {
  id: string; // "ai_original" | "ai_qversion" | "ai_anime" | "ai_watercolor" | "ai_lineart"
  name: string;
  nameEn: string;
  /** 加价(分) */
  surchargeCents: number;
  /** 提示词(供 lingting 复用) */
  prompt: string;
  /** 输出尺寸 */
  outputSize: "1024x1024" | "1536x1024" | "1024x1536";
  /** UI swatch 颜色 hex */
  swatch: string;
  /** 预计耗时(秒) */
  estimatedLatencySec: number;
}

/**
 * Mock Product(对齐 Medusa Product 简化版)
 * 一个 product 对应 atelier 的一个"作品"(4 keychain + 4 figure + 4 magnet)
 */
export interface StorefrontProduct {
  id: string;
  /** URL 友好 slug,atelier 用 handle */
  handle: string;
  title: string;
  titleEn: string;
  subtitle: string;
  description: string;
  /** 主图(URL) */
  thumbnail: string;
  /** gallery 图列表 */
  images: string[];
  /** 渲染前原图(用于 customize 流程) */
  originalPhoto: string;
  /** 渲染后成图(用于 customize 默认 preview) */
  finishedPhoto: string;
  productTypeCode: ProductTypeCode;
  /** 所属系列(钥匙扣 / 手办 / 冰箱贴) */
  seriesId: string;
  seriesName: string;
  /** 系列强调色(用于 chip / accent) */
  accent: string;
  /** 标签(用于搜索) */
  tags: string[];
  /** 评分(0-5) */
  rating: number;
  /** 评分人数 */
  ratingCount: number;
  /** 徽章 "New" | "Best Seller" | "Limited" */
  badge?: string | undefined;
  /** 基础价(分) */
  basePriceCents: number;
  /** 制作天数 */
  leadTimeDays: number;
  /** 关联材质 */
  materials: Material[];
  /** 关联尺寸 */
  sizes: Size[];
  /** 关联 AI 风格 */
  aiStyles: AiStyle[];
  /** typeLabel(用于 UI 显示 "钥匙扣" / "手办" / "冰箱贴") */
  typeLabel: string;
  typeLabelEn: string;
}

/* -------------------------------------------------------------------------- */
/*  Cart / CartLineItem(对齐 Medusa Store Cart schema)                        */
/* -------------------------------------------------------------------------- */

/**
 * CartLineItem.metadata 存的 customize 规格(来自 CustomizationSpec)
 * 与 atelier src/lib/store/customization-spec.ts 的 specToMetadata() 兼容
 */
export interface CartLineItemMetadata {
  productId: string;
  productHandle: string;
  productTitle: string;
  productThumbnail: string;
  materialId: string;
  sizeId: string;
  sizeCm: number;
  aiStyleId: string;
  engravingText: string;
  /** 加急(暂未启用,保留字段) */
  rushOrder: boolean;
  /** 渲染后图 URL(R2) */
  previewImage: string;
  /** 渲染前原图 URL(R2) */
  originalImage: string;
}

export interface CartLineItem {
  id: string;
  cartId: string;
  productId: string;
  productHandle: string;
  productTitle: string;
  productThumbnail: string;
  /** 单位价(分) */
  unitPriceCents: number;
  quantity: number;
  /** customize 元数据,固化到 line item */
  metadata: CartLineItemMetadata;
  /** ISO 时间戳 */
  createdAt: string;
  updatedAt: string;
}

export interface Cart {
  id: string;
  /** 单币种 CNY(简化,见 plan) */
  currencyCode: "CNY";
  /** 区域代码 */
  regionId: string;
  items: CartLineItem[];
  /** ISO 时间戳 */
  createdAt: string;
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/*  CustomizationSpec / PricingResult(atelier 对齐)                            */
/* -------------------------------------------------------------------------- */

/** 客户端 → 服务端的 customize spec(用于 AI transform 与 pricing) */
export interface CustomizationSpec {
  productId: string;
  productHandle: string;
  productTypeCode: ProductTypeCode;
  materialId: string;
  sizeId: string;
  aiStyleId: string;
  engravingText: string;
  rushOrder: boolean;
  quantity: number;
  /** R2 URL(transform 后) */
  previewImageUrl: string;
  /** R2 URL(transform 前,客户上传原图) */
  originalImageUrl: string;
}

export interface PricingResult {
  /** 单价(分) */
  unitPriceCents: number;
  /** 总价(分) */
  totalPriceCents: number;
  /** 拆分明细 */
  breakdown: {
    baseCents: number;
    materialCents: number;
    sizeCents: number;
    aiStyleCents: number;
    engravingFeeCents: number;
    rushOrderCents: number;
    quantityTierDiscountCents: number;
  };
  estimatedShipDays: number;
  calculatedAt: string;
}

/* -------------------------------------------------------------------------- */
/*  AI Transform Request / Response                                            */
/* -------------------------------------------------------------------------- */

export interface AiTransformRequest {
  /** base64 data URL(客户端 FileReader 输出) */
  imageDataUrl: string;
  aiStyleId: string;
  productTypeCode: ProductTypeCode;
}

export interface AiTransformResponse {
  /** R2 永久 URL */
  previewImageUrl: string;
  /** R2 URL(原图备份) */
  originalImageUrl: string;
  aiStyleId: string;
  estimatedLatencyMs: number;
}
