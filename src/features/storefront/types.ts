/**
 * Mock Storefront 类型
 *
 * 形状对齐 atelier 的 store 契约(products / carts / line-items)+ atelier
 * `CustomizationSpec` / `PricingResult`,是**简化版**、不是完整 schema。
 *
 * 商品目录 / 定价 / 购物车都在本仓库(见 architecture-sellbase-integration.md:
 * 本仓库算价,Sellbase 只做收银台),所以改数据来源时只改 Route Handlers
 * 实现,client 端 use-cart / use-products / use-quick-view 一行不改。
 *
 * 参考:
 *  - atelier 的 store 契约(products / carts / line-items 的字段形状)
 *  - D:\下载\atelier-source\src\lib\store\types.ts (Product / CartItem / CustomOption)
 *  - D:\下载\atelier-source\src\lib\store\customization-spec.ts (CustomizationSpec / PricingResult)
 *  - architecture-sellbase-integration.md 集成架构(数据归属边界见 §二)
 */

import type { PRICE_CURRENCY } from "@/config/currency";
import type {
  CouponErrorCode,
  CouponView,
} from "@/features/coupon/lib/coupon-calc";

/* -------------------------------------------------------------------------- */
/*  Product / Variant(对齐 atelier store 的 Product 契约)                     */
/* -------------------------------------------------------------------------- */

/**
 * 商品型号 code 形式:"R" / "A" / "P" / "RM" / "LB" / "M"
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

/**
 * 配件变体(底座 / 玻璃罩 / 皮套 / 编织绳 的具体款)
 *
 * 与「材质」维度不同:材质是**本体材料**(一件只能一种),配件是**加购项**
 * (可以同时要一个底座和一个玻璃罩),每组内单选、组间可多选。
 *
 * 数据源:product-accessory-variants.ts 的 PRODUCT_ACCESSORY_VARIANTS
 * (与 product_accessory_variant 表同源)。
 */
export interface AccessoryVariant {
  /** 全局唯一 id(存进 cart metadata) */
  id: string;
  /** 变体 code,如 "stand_wooden" */
  code: string;
  name: string;
  nameEn: string;
  /** 色卡 hex;非颜色类变体(尺寸 / 材质款)为 null */
  swatch: string | null;
  /** 加价(分) */
  surchargeCents: number;
  /** 适用的主体尺寸(cm);空数组 = 不限 */
  appliesToSizesCm: number[];
}

/** 配件分组(同一 accessoryCode 下的可选款,组内单选) */
export interface AccessoryGroup {
  /** 配件 code(stand / glass_cover / leather / braided_rope) */
  code: string;
  name: string;
  nameEn: string;
  /** 可选变体(按 sortOrder 升序) */
  variants: AccessoryVariant[];
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
 * Mock Product(对齐 atelier store 的 Product 契约,简化版)
 * 一个 product 对应 atelier 的一个"作品"(4 keychain + 4 figure + 4 magnet)
 */
export interface StorefrontProduct {
  id: string;
  /** URL 友好 slug,atelier 用 handle */
  handle: string;
  title: string;
  titleEn: string;
  subtitle: string;
  /** 英文副标题 —— 2026-11-01 补:商城网格的卡片副标题在 en locale
   *  之前一直是中文(标题有 titleEn,副标题没有),首页改网格后这行在
   *  en 页上刺眼得没法忽略。 */
  subtitleEn: string;
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
  /** 英文系列名 */
  seriesNameEn: string;
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
  /**
   * 该型号是否支持刻字。
   *
   * 取自 PRODUCT_TYPES[code].capabilities.canEngrave —— 真理源在
   * product-catalog.ts。定制工作台的刻字输入框按它开合:手办(M)与
   * 冰箱贴(P)是 3D 造型件,不做表面刻字;钥匙扣 / 相框 / 皮革徽章支持。
   */
  canEngrave: boolean;
  /**
   * 默认选中尺寸(cm)—— 商品文案里的「标准款」。
   *
   * 以前规格屏默认选 sizes[0](最小档),跟文案说的标准款对不上;
   * 现在按商品实际标准款选,没有标准款的取最小档。
   */
  defaultSizeCm: number;
  /** 关联材质 */
  materials: Material[];
  /** 关联尺寸 */
  sizes: Size[];
  /** 可选配件分组(底座 / 玻璃罩 / 皮套 / 编织绳);无数据的型号是空数组 */
  accessoryGroups: AccessoryGroup[];
  /** 关联 AI 风格 */
  aiStyles: AiStyle[];
  /** typeLabel(用于 UI 显示 "钥匙扣" / "手办" / "冰箱贴") */
  typeLabel: string;
  typeLabelEn: string;
}

/* -------------------------------------------------------------------------- */
/*  Cart / CartLineItem(对齐 atelier store 的 Cart 契约)                      */
/* -------------------------------------------------------------------------- */

/**
 * CartLineItem.metadata 存的 customize 规格(来自 CustomizationSpec)
 * 与 atelier src/lib/store/customization-spec.ts 的 specToMetadata() 兼容
 *
 * **车里只有目录商品**(2026-11-08)—— 打印服务不进商城购物袋,工单自己建、
 * 自己收款(见 `POST /api/print-orders`)。所以这里没有「打印服务规格」那一项。
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
  /** 加急(2026-11-02 起工作台有开关:+¥15,发货天数减半) */
  rushOrder: boolean;
  /** 选中的配件变体 id(空数组 = 不加配件) */
  accessoryVariantIds: string[];
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
  /** 单位价(分)—— **折扣前** */
  unitPriceCents: number;
  /**
   * 折后单价(分)—— 阶梯折扣后的单价
   *
   * 这才是真正要收的数:Sellbase 的行合计 = `unit_price_amount × quantity`,
   * 所以「先折单价再乘数量」才能跟 Sellbase 逐分相等(见 `pricing.ts`)。
   */
  discountedUnitPriceCents: number;
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
  currencyCode: typeof PRICE_CURRENCY;
  /** 区域代码 */
  regionId: string;
  items: CartLineItem[];
  /**
   * 车上的优惠码(2026-11-08)—— 大写归一化后的码
   *
   * **只存码,不存折扣金额** —— 折扣每次读车时现算(车里的行数会变,
   * 存的金额会过期)。
   */
  couponCode: string | null;
  /**
   * 服务端算好的优惠效果 —— null = 没有券,或者券不可用
   *
   * **折扣金额是服务端算的** —— 客户端一个加法都不做。
   */
  coupon: CouponView | null;
  /**
   * 上次应用失败的原因码 —— null = 没有码,或者券完全可用
   *
   * 界面拿它渲染一句人话(「这个券过期了」),并给一个「去掉优惠码」按钮 ——
   * **不能悄悄按原价收**:用户会问「我的码呢」。
   */
  couponError: CouponErrorCode | null;
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
  /** 选中的配件变体 id(可空数组 = 不加配件) */
  accessoryVariantIds: string[];
  quantity: number;
  /** R2 URL(transform 后) */
  previewImageUrl: string;
  /** R2 URL(transform 前,客户上传原图) */
  originalImageUrl: string;
}

export interface PricingResult {
  /** 单价(分)—— **折扣前** */
  unitPriceCents: number;
  /**
   * 折后单价(分)—— 阶梯折扣后的单价
   *
   * `totalPriceCents = discountedUnitPriceCents × quantity`。Sellbase 的
   * `items[].unit_price_amount` 填的就是这个数。
   */
  discountedUnitPriceCents: number;
  /** 总价(分) */
  totalPriceCents: number;
  /** 拆分明细 */
  breakdown: {
    baseCents: number;
    materialCents: number;
    sizeCents: number;
    aiStyleCents: number;
    accessoryCents: number;
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
