/**
 * 生图相关持久化数据类型
 *
 * 用于 db/schema.ts 中 json 列的 $type<...> 类型标注，
 * 放在 db 目录以避免 db → features 的反向依赖。
 *
 * 共享类型 PromptVariable / PromptVersion / TemplateStyle 现在定义在本文件，
 * features/image-gen 与 features/gpt-image 都从这里导入。
 * （原 product-effect-types.ts 仅作为兼容期 re-export 壳，Phase D 退役时删）
 */

import type { PromptVersion as FeaturePromptVersion } from "@/features/image-gen/lib/product-effect-types";

/** 提示词变量定义（持久化为 JSON） */
export interface PromptVariable {
  key: string; // 变量名，如 photo_style
  label: string; // 显示名，如 照片风格
  defaultValue: string;
  required: boolean;
  description?: string | undefined;
  options?: string[] | undefined; // 候选取值；有则渲染下拉，无则渲染文本框
}

/**
 * 模板视觉风格（2026-10-16 v1.5.0 新增）
 *
 * 概念：每个 promptTemplate 自带一组样式。提交生图时用户选某个样式，
 * 服务端把样式里 `prompt` 字段替换到模板 prompt 内的 `{{style}}` 占位符
 * 上 —— 这是「替换关键提示词」语义，与 variables 系统的占位符替换共用
 * 一套替换引擎。
 *
 * 与 productEffect.config.style 的关系：前者是「工艺风格」(relief /
 * engraving / 3d-figurine),后者是「视觉风格」(Q版/写实/动漫),完全独立,
 * 没有迁移关系。
 *
 * 数据流向：
 *   DB:promptTemplate.styles: json → 后端 route 读 → SDK wire 形态
 *     → mp 端 UI chip 渲染
 *
 * shape 与前端 AiStyle(storefront 已有)保持同形,便于 mock 数据共享。
 */
export interface TemplateStyle {
  /** 稳定唯一 id,模板内唯一。如 "q-version"、"anime"、"lineart"。 */
  id: string;
  /** 中文名,展示用,如 "Q 版萌系"。 */
  name: string;
  /** 英文名,如 "Q-Version"。mp 端多语言切换用。 */
  nameEn: string;
  /**
   * 关键提示词 —— 替换 promptTemplate.prompt 里的 `{{style}}` 占位符的
   * 实际内容。如 "Q-version chibi figurine with big eyes and pastel tones"。
   *
   * 注意：若模板 prompt 不含 `{{style}}` 占位符,服务端会 fallback 把这段
   * prompt 拼到模板 prompt 后面(与 v1.4.0 prepend 行为一致),业务方
   * 写模板时建议显式加 `{{style}}` 占位符以更精确控制拼接位置。
   */
  prompt: string;
  /** 加价(分);0 = 不加价。admin 配模板时手填,mp 端做「+¥15」展示。 */
  surchargeCents: number;
  /** 输出尺寸(server 端参考,目前所有风格都用 1024x1024)。 */
  outputSize: "1024x1024" | "1536x1024" | "1024x1536";
  /** UI swatch 颜色 hex,如 "#7A5A8C"。 */
  swatch: string;
  /** 预计耗时(秒);直通类(如原图保留)写 0。 */
  estimatedLatencySec: number;
}

/** 提示词版本历史（持久化为 JSON） */
export type PromptVersion = FeaturePromptVersion;

// ============================================
// 产品能力接口（/api/image-gen/products）—— 2026-10-18 v1.6.0
// ============================================
//
// 给小程序 / 网页端用的「产品 + 配件 + 视觉风格 + 模板」一站式元数据契约。
// 数据源：硬编码 PRODUCT_TYPES / ACCESSORIES 字典 + productAccessoryVariant
// DB 行 + productEffect / promptTemplate 表拼装，由
// `src/features/image-gen/lib/product-capability.ts` 的 assemble 流程产出。
//
// 设计要点：
// - 字段命名对齐 SDK 风格：camelCase，金额为 cents 整数，i18n 字段统一用
//   `{ zh, en }` 形态（客户端按 locale 切换）
// - capabilities 来自 PRODUCT_TYPES + productEffect.allowedCapabilities 覆盖
// - accessories[].variants 来自 productAccessoryVariant 表（空数组 = 无变体）
// - templates[] 是该 productTypeCode 下的 productEffect 列表，每条带 styles[]

/** 配件维度（material 材质 / protection 保护 / mount 装配 / decor 装饰） */
export type AccessoryCategory = "material" | "protection" | "mount" | "decor";

/** 产品分类（与 mock-catalog STOREFRONT productTypeCode 概念对齐） */
export type ProductCategory =
  | "keychain"
  | "shape-keychain"
  | "magnet"
  | "frame"
  | "leather-badge"
  | "figure";

/** 配件变体（如 leather 棕色 / 编织绳红色 / 玻璃罩 4cm） */
export interface AccessoryVariantDef {
  /** 变体 code，模板内唯一，如 "leather_brown" / "rope_red" / "glass_4" */
  code: string;
  /** i18n 名称 */
  name: { zh: string; en: string };
  /** swatch hex（颜色类变体）；尺寸类变体为 null */
  swatch?: string | null;
  /** 加价（分）；0 = 不加价 */
  priceDeltaCents: number;
}

/** 配件定义 */
export interface AccessoryDef {
  /** 配件 code（leather / pvc / bracket / metal / magnet / stand / glass_cover / braided_rope） */
  code: string;
  /** i18n 名称 */
  name: { zh: string; en: string };
  /** 配件维度分类 */
  category: AccessoryCategory;
  /** 默认加价（分）；变体可覆盖 */
  priceDeltaCents: number;
  /** 该配件要求的产品能力（启用门控；未定义 = 无门控） */
  requiresCapability?: keyof ProductCapabilities | null;
  /** 该配件的变体列表；空数组 = 无变体（如 magnet） */
  variants: AccessoryVariantDef[];
}

/** 产品能力位（与 PRODUCT_TYPES.capabilities 对齐 + 模板级覆盖合并后） */
export interface ProductCapabilities {
  canEngrave: boolean;
  canLeatherColor: boolean;
  canPvcProtection: boolean;
  canLeatherExposed: boolean;
  canHaveRemarks: boolean;
  canPlatform: boolean;
}

/** 产品尺寸档 */
export interface ProductSizeDef {
  /** 尺寸 code（cm 数字字符串，如 "4" / "6"） */
  code: string;
  /** i18n 标签 */
  label: { zh: string; en: string };
  /** 加价（分）；0 = 基准价 */
  priceDeltaCents: number;
}

/** 产品下的 AI 模板摘要（嵌套在 ProductCapability.templates[]） */
export interface ProductTemplateSummary {
  /** 等同 maskId（productEffect.id），喂给 submitGenerate.maskId */
  templateId: string;
  /** i18n 名称 */
  name: { zh: string; en: string };
  /** 封面图 URL */
  cover: string;
  /** 模板基础积分（cents）；ui 展示时 /100 */
  costCredits: number;
  /** 候选输出模式 */
  outputMode: "grid" | "separate";
  /** 单次生图候选数（1/2/4/9） */
  candidateCount: number;
  /** 该模板自带的视觉风格数组（来自 promptTemplate.styles） */
  visualStyles: TemplateStyle[];
  /** 该模板允许的配件子集（来自 productEffect.allowedAccessories）；空 = 全量 */
  allowedAccessories: string[];
}

/** 单个产品的完整能力定义（/api/image-gen/products 顶层数组元素） */
export interface ProductCapability {
  /** 产品码（R / A / P / RM / LB / M） */
  productTypeCode: string;
  /** 产品分类（与 mock-catalog 一致） */
  category: ProductCategory;
  /** i18n 显示名 */
  displayName: { zh: string; en: string };
  /** i18n 描述 */
  description: { zh: string; en: string };
  /** 产品封面图 URL */
  cover: string;
  /**
   * 产品基价（分）—— 来自 product-catalog.ts 的 BASE_PRICE_CENTS。
   * 前端拼 totalPrice = basePriceCents + sizes[].priceDeltaCents +
   * accessories[].variants[].priceDeltaCents + style.surchargeCents。
   */
  basePriceCents: number;
  /** 该产品可选尺寸档 */
  sizes: ProductSizeDef[];
  /** 该产品聚合自 templates[].visualStyles 的去重集合（仅展示用） */
  visualStyles: TemplateStyle[];
  /** 该产品可选配件（含变体） */
  accessories: AccessoryDef[];
  /** 该产品能力位（catalog + 模板覆盖合并后） */
  capabilities: ProductCapabilities;
  /** 该产品可用的 AI 模板列表 */
  templates: ProductTemplateSummary[];
}

/** GET /api/image-gen/products 响应 */
export interface ProductListResponse {
  success: true;
  /** 当前 API key 作用域（无 key = null）；前端可据此灰掉白名单外的产品 */
  keyScope?: { keyName: string; allowedMasks: string[] } | null;
  /** 响应 locale（"zh" | "en"），便于客户端核对 */
  locale: "zh" | "en";
  products: ProductCapability[];
}
