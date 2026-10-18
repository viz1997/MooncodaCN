/**
 * 产品型号字典（飞书 docx "链接生成管理系统"）
 *
 * 2026-08-23 引入 ToB 代理商业务后，订单要绑"产品型号 + 尺寸 + 配件"三件套。
 * 字典先 hardcoded 在代码里：4 个产品型号 × 多个尺寸 + 3 个配件，
 * 不上 DB（量小、改动少、admin 后台挑 select 不需要动态）。等真到"代理
 * 商自己配置 SKU"那一步再迁到 prompt_template 或独立 product 表。
 *
 * 2026-09-07 扩展：每个型号加 `capabilities` 标记（皮革徽章 / 刻字能力），
 * 用于 /p/[token] 上"用户定制"区按能力动态渲染输入。无能力的字段根本不
 * 出现，后端 /configure 路由也会拒。
 *
 * 命名约定：
 * - productTypeCode: 'R' | 'A' | 'P' | 'RM' | 'LB' | 'M'（单字母为主，跟 PDF 二维码表格一致；
 *   M 是 2026-09-15 新增的手办型号；具体见 PRODUCT_TYPES 字典）
 * - productSize: '4' | '5' | '6' | '8' | '10' | '11' | '12' | '15' | '18'
 *   （厘米，纯数字字符串，便于拼接；尺寸档全集由各型号 sizes 字段决定）
 * - accessoryCode: 'leather' | 'pvc' | 'bracket' | 'metal' | 'magnet' | 'stand' | null
 *
 * 与 promptOrder.product_type_code / product_size / accessory_code 列 1:1 对应。
 */

import type { AccessoryCategory, ProductCategory } from "@/db/image-gen-types";

/**
 * 产品能力标记 —— 决定 /p/[token] 上"产品定制"区哪些输入项渲染。
 * - canEngrave：是否支持刻字（皮革徽章 / 钥匙扣 / 异性钥匙扣 / 相框都支持）
 * - canLeatherColor / canPvcProtection / canLeatherExposed / canHaveRemarks：
 *   2026-09-10 LB 皮革徽章扩展（颜色 / PVC 保护 / 皮革外露 / 备注）。
 *   仅 LB 打开；其他型号全 false，/configure 路由会静默 collapse 为 null。
 *
 * 历史说明：2026-09-07 初版曾把"皮革徽章"作为 R 钥匙扣的 hasLeatherBadge
 * capability，让用户在 /p/[token] 上勾选。但用户原意是把它作为独立产品型号，
 * 所以 2026-09-07 同日重构：LB（皮革徽章）独立进 PRODUCT_TYPES，R 不再
 * 拥有此能力，hasLeatherBadge 字段从 schema / /configure 路由 / UI 全删。
 *
 * 2026-09-15：新增 M（手办 figure）—— 完整尺寸档 4/5/6/8/10/12/15/18cm
 * （用户原话「手办规格 4cm、5cm、6cm、8cm、10cm、12cm、15cm、18cm」）。
 * 配件默认底座（stand），不开刻字 / 颜色 / 外露 / PVC / 备注 —— 手办是定制
 * 造型，刻字和表面处理一律关，保留 canPlatform 给 ToB 渠道订单归因。
 */
export interface ProductCapabilities {
  canEngrave: boolean;
  /** 是否可选择皮革颜色（仅 LB） */
  canLeatherColor: boolean;
  /** 是否可选 PVC 保护加工（仅 LB） */
  canPvcProtection: boolean;
  /** 是否可填皮革实物外露（仅 LB；与 engravingExposed 独立语义） */
  canLeatherExposed: boolean;
  /** 是否可填备注（仅 LB；不参与生图，仅内部沟通） */
  canHaveRemarks: boolean;
  /**
   * 是否可选择订单来源平台（仅 LB 皮革徽章）。
   * 2026-09-11：业务侧 ToB 渠道归因，下单时用户告诉代理商从哪个渠道
   * 来的（淘宝 / 小红书 / 抖音 / 独立站 / 国内红人 / 国外红人 / 合作方 /
   * 营销推广），用于结算与活动复盘。字典见 PLATFORMS。
   */
  canPlatform: boolean;
}

export interface ProductType {
  code: string;
  name: string;
  /**
   * 尺寸单位（展示用，2026-09-14 用户原话「为什么硬编码 cm」——
   * 单位应来自型号字典，不是 buildSpecSummary 里硬写）。
   * 当前所有 SKU 都是 cm；后续如果加"英寸 / 毫米"型号直接扩字典。
   */
  unit: string;
  /** 该型号下可选的尺寸（数字字符串，无单位；单位来自 unit 字段） */
  sizes: readonly string[];
  /** 该型号下可选的配件；null 表示该型号无配件选项 */
  accessories: readonly AccessoryCode[];
  /** 产品能力 —— /p/[token] 定制区按这个动态渲染输入 */
  capabilities: ProductCapabilities;
}

export const PRODUCT_TYPES: readonly ProductType[] = [
  {
    code: "R",
    name: "CM 钥匙扣",
    unit: "cm",
    // 2026-09-14：加 5cm（用户原话「钥匙扣规格有 4cm、5cm、6cm」）。
    // 字典给全集；具体 productEffect 还可以在 allowedSizes 缩窄（皮革 only 4/6，
    // 金属 only 4）。
    sizes: ["4", "5", "6"],
    // 2026-09-14：accessories 从 [leather, pvc] 改成 [leather, metal]
    // （用户原话「钥匙扣有无套、皮革、金属」）。无套 = accessoryCode=null
    // （null 永远允许），pvc accessory 移除（PVC 改用 leatherExposed/pvcProtection
    // 标志位表达，与皮革徽章 LB 对齐）。龙虾扣是 UI 显示提示（见
    // preview-order-view.tsx buildSpecSummary），不加独立 accessory code。
    //
    // 2026-10-18 v1.6.0：加 "braided_rope" —— 用户原话「钥匙扣配件可选编
    // 织绳颜色」。挂在 R 钥匙扣上，给 8 色变体（红/黑/蓝/绿/黄/紫/白/棕）。
    accessories: ["leather", "metal", "braided_rope"],
    // 2026-09-14：开 canLeatherExposed + canPvcProtection（用户原话「皮革的
    // 有实物外露和 PVC 保护，金属的只有实物外露」—— capability 是
    // productType 级开关，per-accessory 互斥在 fillDefaultsByTemplate 校验：
    // accessoryCode='metal' + pvcProtection=true → 拒）。
    capabilities: {
      canEngrave: true,
      canLeatherColor: false,
      canPvcProtection: true,
      canLeatherExposed: true,
      canHaveRemarks: false,
      canPlatform: false,
    },
  },
  {
    code: "A",
    name: "CM 异性钥匙扣",
    unit: "cm",
    sizes: ["4", "6"],
    accessories: ["bracket"],
    // 异性款以支架为主；刻字仍支持
    capabilities: {
      canEngrave: true,
      canLeatherColor: false,
      canPvcProtection: false,
      canLeatherExposed: false,
      canHaveRemarks: false,
      canPlatform: false,
    },
  },
  {
    code: "P",
    name: "CM 冰箱贴",
    unit: "cm",
    // 2026-09-14：加 5cm（用户原话「头部浮雕冰箱贴规格 4cm、5cm、6cm」）。
    // 字典提供「可做尺寸」全集；具体 productEffect 还可以在 allowedSizes
    // 进一步缩窄（比如只做 4/5/6 不做 8）。
    sizes: ["4", "5", "6", "8"],
    // 2026-09-14：冰箱贴默认带「磁铁」配件（字典档位）。
    // 实际默认配件仍由 productEffect.allowedAccessories 决定——这里只
    // 是声明「P 型号可以配磁铁」，具体哪些效果挂磁铁由 admin 配。
    accessories: ["magnet"],
    // 冰箱贴不在表面刻字
    capabilities: {
      canEngrave: false,
      canLeatherColor: false,
      canPvcProtection: false,
      canLeatherExposed: false,
      canHaveRemarks: false,
      canPlatform: false,
    },
  },
  {
    code: "RM",
    name: "CM 相框",
    unit: "cm",
    sizes: ["6", "8", "11"],
    accessories: [],
    // 相框可在底座刻字（祝福语/日期）
    capabilities: {
      canEngrave: true,
      canLeatherColor: false,
      canPvcProtection: false,
      canLeatherExposed: false,
      canHaveRemarks: false,
      canPlatform: false,
    },
  },
  {
    code: "LB",
    name: "CM 皮革徽章",
    unit: "cm",
    sizes: ["4", "6"],
    // 2026-09-12：LB 皮革徽章加「皮革 / 金属」二选一配件（用户原话"配件要显示对应的而不是默认，皮革还是金属"）。
    // 字典补 metal；老订单 accessoryCode=null 时详情页不再渲染"配件：默认"行。
    accessories: ["leather", "metal"],
    // 2026-09-10：LB 全加工能力开启（颜色 / 外露 / PVC / 备注 + 原有的刻字）
    // 2026-09-11：再加 canPlatform（业务侧 ToB 渠道归因）
    capabilities: {
      canEngrave: true,
      canLeatherColor: true,
      canPvcProtection: true,
      canLeatherExposed: true,
      canHaveRemarks: true,
      canPlatform: true,
    },
  },
  {
    code: "M",
    name: "CM 手办",
    unit: "cm",
    // 2026-09-15：手办完整尺寸档（用户原话「手办规格 4cm、5cm、6cm、8cm、
    // 10cm、12cm、15cm、18cm」）—— 从桌面摆件到中大型收藏件全档。具体
    // productEffect 仍可在 allowedSizes 缩窄（比如只做 8cm 小摆件）。
    sizes: ["4", "5", "6", "8", "10", "12", "15", "18"],
    // 2026-09-15：手办默认带底座（stand）。手办作为定制造型不走刻字 / 颜色 /
    // 外露 / PVC 表面处理能力，但底座是物理结构上的配件选项。
    //
    // 2026-10-18 v1.6.0：加 "glass_cover" —— 用户原话「3D手办配件可选
    // 底座、玻璃罩等」。挂在 M 上，给 3 个尺寸变体（4cm / 6cm / 8cm）。
    accessories: ["stand", "glass_cover"],
    // 2026-09-15：手办能力开 canPlatform（ToB 渠道订单归因与 LB 对齐），
    // 关刻字 / 颜色 / 外露 / PVC / 备注。手办是 3D 定制造型，不走表面加工。
    capabilities: {
      canEngrave: false,
      canLeatherColor: false,
      canPvcProtection: false,
      canLeatherExposed: false,
      canHaveRemarks: false,
      canPlatform: true,
    },
  },
];

export type AccessoryCode =
  | "leather"
  | "pvc"
  | "bracket"
  | "metal"
  | "magnet"
  | "stand"
  // 2026-10-18 v1.6.0：M 手办配件——玻璃罩（3 种尺寸变体：4/6/8cm）
  | "glass_cover"
  // 2026-10-18 v1.6.0：R 钥匙扣配件——编织绳（8 色变体）
  | "braided_rope";

export interface Accessory {
  code: AccessoryCode;
  name: string;
}

export const ACCESSORIES: readonly Accessory[] = [
  { code: "leather", name: "皮套" },
  { code: "pvc", name: "PVC 皮套" },
  { code: "bracket", name: "支架" },
  // 2026-09-12：LB 皮革徽章用「金属」配件选项（与皮套二选一）
  { code: "metal", name: "金属" },
  // 2026-09-14：「头部浮雕冰箱贴」专用配件——背面磁铁槽 + 磁铁。
  // 2026-09-14 用户原话「默认背面挖磁铁槽配件磁铁」——只挂头部浮雕冰箱贴
  // 类 productEffect（allowedAccessories=["magnet"]），其他产品效果图的
  // allowedAccessories 不包含此项就不会出。
  { code: "magnet", name: "磁铁" },
  // 2026-09-15：M 手办专用配件——底座/展台。
  { code: "stand", name: "底座" },
  // 2026-10-18 v1.6.0：M 手办配件——玻璃罩（用户原话「3D手办配件可选
  // 底座、玻璃罩等」）。3 种尺寸变体由 productAccessoryVariant 表驱动。
  { code: "glass_cover", name: "玻璃罩" },
  // 2026-10-18 v1.6.0：R 钥匙扣配件——编织绳（用户原话「钥匙扣配件
  // 可选编织绳颜色」）。8 色变体由 productAccessoryVariant 表驱动。
  { code: "braided_rope", name: "编织绳" },
];

// ============================================
// 2026-09-10：皮革颜色字典（仅 LB 皮革徽章用）
// 前端 hardcoded 与 PRODUCT_TYPES 同模式：量小（5 色）先不上 DB。
// swatch 仅供 UI 渲染色卡，不存 DB；DB 只存 code。
// ============================================
export interface LeatherColor {
  code: string;
  name: string;
  /** UI 渲染色卡用的 CSS 颜色；不进 DB */
  swatch: string;
}

export const LEATHER_COLORS: readonly LeatherColor[] = [
  { code: "natural", name: "皮革原色", swatch: "#c19a6b" },
  { code: "brown", name: "棕色", swatch: "#6b4423" },
  { code: "black", name: "黑色", swatch: "#1a1a1a" },
  { code: "red", name: "酒红", swatch: "#722f37" },
  { code: "navy", name: "藏青", swatch: "#1f2d4d" },
];

export function getLeatherColor(
  code: string | null | undefined
): LeatherColor | null {
  if (!code) return null;
  return LEATHER_COLORS.find((c) => c.code === code) ?? null;
}

/**
 * 校验皮革颜色 code 在字典里。code 为 null / undefined 通过（用户不选 = 不定制）。
 * 抛错信息给客户端 / 日志直接可读。
 */
export function validateLeatherColor(code: string | null | undefined): void {
  if (!code) return;
  if (!LEATHER_COLORS.some((c) => c.code === code)) {
    throw new Error(`未知的皮革颜色：${code}`);
  }
}

// ============================================
// 2026-09-11：订单来源平台字典（仅 LB 皮革徽章）
// 业务侧 ToB 渠道归因：代理商想知道这单从哪儿来的，用于活动复盘 + 结算。
// 字典量小（8 项）不上 DB；DB 只存 code，名称走 PLATFORMS 字典渲染。
// 顺序按"自营 → 第三方电商 → 内容/网红 → 合作/营销"排列，UI 顺序与之一致。
// ============================================
export type PlatformCode =
  | "taobao"
  | "xiaohongshu"
  | "douyin"
  | "independent_site"
  | "domestic_influencer"
  | "foreign_influencer"
  | "partner"
  | "marketing";

export interface Platform {
  code: PlatformCode;
  name: string;
}

export const PLATFORMS: readonly Platform[] = [
  { code: "taobao", name: "淘宝" },
  { code: "xiaohongshu", name: "小红书" },
  { code: "douyin", name: "抖音" },
  { code: "independent_site", name: "独立站" },
  { code: "domestic_influencer", name: "国内红人" },
  { code: "foreign_influencer", name: "国外红人" },
  { code: "partner", name: "合作方" },
  { code: "marketing", name: "营销推广" },
];

export function getPlatform(code: string | null | undefined): Platform | null {
  if (!code) return null;
  return PLATFORMS.find((p) => p.code === code) ?? null;
}

/**
 * 校验平台 code 在字典里。code 为 null / undefined 通过（用户不选 = 默认走代理商统计 unknown）。
 */
export function validatePlatform(code: string | null | undefined): void {
  if (!code) return;
  if (!PLATFORMS.some((p) => p.code === code)) {
    throw new Error(`未知的订单来源平台：${code}`);
  }
}

/**
 * 找产品型号。找不到返回 null。
 */
export function getProductType(
  code: string | null | undefined
): ProductType | null {
  if (!code) return null;
  return PRODUCT_TYPES.find((t) => t.code === code) ?? null;
}

/**
 * 找配件。找不到返回 null。
 */
export function getAccessory(
  code: string | null | undefined
): Accessory | null {
  if (!code) return null;
  return ACCESSORIES.find((a) => a.code === code) ?? null;
}

/**
 * 把三件套渲染成一行可读的展示字符串：
 * "4cm 钥匙扣 · 皮套" / "6cm 冰箱贴"（无配件时省略）
 */
export function formatProductSpec(opts: {
  productTypeCode?: string | null;
  productSize?: string | null;
  accessoryCode?: string | null;
}): string {
  const type = getProductType(opts.productTypeCode);
  if (!type) return "-";
  const size = opts.productSize ? `${opts.productSize}${type.name}` : type.name;
  const acc = getAccessory(opts.accessoryCode);
  return acc ? `${size} · ${acc.name}` : size;
}

/**
 * Spec 字段展示文案（2026-09-14 用户原话「不要硬编码规格文案，
 * 按照设置好的来获取」—— 单一来源，spec-modal / formatCustomization /
 * buildSpecSummary 三处都从这里读，避免文案漂移）。
 *
 * - leatherExposed: 保护套类型 pill 的「实物外露」标签
 *   （spec-modal.tsx:628 客户配置的视觉文案）。
 * - pvcProtection: 保护套类型 pill 的「PVC 保护」标签
 *   （spec-modal.tsx:657）。
 * - leatherColorPrefix: formatCustomization 输出的「皮革色：」前缀。
 *   注：颜色名走 LEATHER_COLORS 字典 name，不写在这里。
 */
export const SPEC_LABELS = {
  leatherExposed: "实物外露",
  pvcProtection: "PVC 保护",
  leatherColorPrefix: "皮革色",
} as const;

/**
 * 把"产品定制"区渲染成一行可读字符串。仅在用户真的填了值时输出对应片段。
 *
 * - engravingText 非空 → `刻字："Love U"`（短文本原样）
 * - engravingText 非空且 engravingExposed=true → 上面那段尾巴加 "（外露）"
 * - engravingText 非空但 engravingExposed=false → "刻字：…（内刻）"
 * - leatherColor 非空 → `皮革色：棕色`（按 LEATHER_COLORS 字典取中文名）
 * - pvcProtection=true → `PVC 保护`（来自 SPEC_LABELS.pvcProtection）
 * - leatherExposed=true → `实物外露`（来自 SPEC_LABELS.leatherExposed，与
 *   spec-modal pill 文案对齐；2026-09-14 用户原话「不要硬编码规格文案」）
 * - remarks → **不进 summary**（备注可能很长 / 含换行，单独渲染更合适）
 *
 * 全 null 时返回空字符串（由 UI 决定是否展示"无定制"占位）。
 *
 * 历史：2026-09-07 初版还会渲染"✓ 皮革徽章"，但皮革徽章已重构为独立
 * 产品 LB，hasLeatherBadge 字段已删除。2026-09-10 扩到 LB 全加工维度。
 * 2026-09-14：文案统一从 SPEC_LABELS 读取；leatherExposed 文案从 "皮革外露"
 * 改为 "实物外露" 与 spec-modal 对齐。
 */
export function formatCustomization(opts: {
  engravingText?: string | null;
  engravingExposed?: boolean | null;
  leatherColor?: string | null;
  leatherExposed?: boolean | null;
  pvcProtection?: boolean | null;
  remarks?: string | null;
  platform?: string | null;
}): string {
  const parts: string[] = [];
  const text = opts.engravingText?.trim();
  if (text) {
    const place = opts.engravingExposed ? "（外露）" : "（内刻）";
    parts.push(`刻字：${text}${place}`);
  }
  const color = getLeatherColor(opts.leatherColor);
  if (color) parts.push(`${SPEC_LABELS.leatherColorPrefix}：${color.name}`);
  if (opts.pvcProtection === true) parts.push(SPEC_LABELS.pvcProtection);
  if (opts.leatherExposed === true) parts.push(SPEC_LABELS.leatherExposed);
  // 2026-09-11：平台（仅 LB 业务使用，admin 复盘 / 结算归因）
  const platform = getPlatform(opts.platform);
  if (platform) parts.push(`来源：${platform.name}`);
  // remarks 故意不参与 parts.join — 备注单独渲染更稳
  return parts.join(" · ");
}

/**
 * 校验产品三件套（型号 + 尺寸 + 配件）组合是否合法。
 * 三件套全 null 通过；任一非空就必须组合合法。
 *
 * 2026-09-08：从原 `@/features/agent/lib/product-validation` 迁来。
 * (agent) route group 砍掉后只剩管理员编辑存量订单时还会调用，故放到 gpt-image/lib
 * 离调用方更近。
 */
export function validateProductSpec(
  productTypeCode: string | null | undefined,
  productSize: string | null | undefined,
  accessoryCode: string | null | undefined
): void {
  const type = getProductType(productTypeCode);
  // 型号未指定 → 整套必须 null（避免只写 size 不写 type 这种脏数据）
  if (!productTypeCode) {
    if (productSize || accessoryCode) {
      throw new Error("未选择产品型号时，不能指定尺寸或配件");
    }
    return;
  }
  // 型号指定了但找不到 → 字典过期或输入拼错
  if (!type) {
    throw new Error(`未知的产品型号：${productTypeCode}`);
  }
  // 尺寸必须在该型号的 sizes 列表里
  if (productSize && !type.sizes.includes(productSize)) {
    throw new Error(
      `产品型号 ${type.code} 不支持尺寸 ${productSize}cm（可选：${type.sizes.join("/")}cm）`
    );
  }
  // 配件必须在该型号的 accessories 列表里
  if (
    accessoryCode &&
    !type.accessories.includes(accessoryCode as AccessoryCode)
  ) {
    throw new Error(
      `产品型号 ${type.code} 不支持配件 ${accessoryCode}（可选：${type.accessories.join("/") || "无"}）`
    );
  }
}

// ============================================
// 2026-10-18 v1.6.0：产品能力接口 i18n 字典
// ============================================
//
// 给 /api/image-gen/products 暴露给小程序 / 网页端用的展示文案。硬编码在
// 代码里（与 LEATHER_COLORS / PLATFORMS 模式一致）：量小、改动少、不上 DB。
//
// 与现有 ProductType.name 的区别：现有 name 是单字符串（zh），新 API 要双
// 语对照（{ zh, en }），所以额外维护一个映射表，不污染 ProductType 接口。
// ============================================

/** 产品码 → i18n 元数据 */
export interface ProductMeta {
  category: ProductCategory;
  displayName: { zh: string; en: string };
  description: { zh: string; en: string };
}

/** 配件维度 + i18n 展示名 + 分类（与 AccessoryCategory 对齐） */
export interface AccessoryMeta {
  category: AccessoryCategory;
  name: { zh: string; en: string };
}

/** 全部产品码的展示元数据（用于 /api/image-gen/products） */
export const PRODUCT_META: Readonly<Record<string, ProductMeta>> = {
  R: {
    category: "keychain",
    displayName: { zh: "钥匙扣", en: "Keychain" },
    description: {
      zh: "便携随身小件,激光切割全彩树脂,可挂书包 / 钥匙 / 拉链",
      en: "Portable resin keychain with laser-cut full-color print",
    },
  },
  A: {
    category: "shape-keychain",
    displayName: { zh: "异形钥匙扣", en: "Shape Keychain" },
    description: {
      zh: "按轮廓剪切的不规则钥匙扣,支架配件,送礼个性之选",
      en: "Contour-cut keychain with bracket accessory",
    },
  },
  P: {
    category: "magnet",
    displayName: { zh: "冰箱贴", en: "Fridge Magnet" },
    description: {
      zh: "全彩树脂冰箱贴,磁铁配件,适合合影 / 宠物 / 孩子画作",
      en: "Full-color resin magnet for fridge decor",
    },
  },
  RM: {
    category: "frame",
    displayName: { zh: "相框", en: "Photo Frame" },
    description: {
      zh: "桌面纪念摆件,可在底座刻祝福语或日期",
      en: "Desktop frame with base engraving option",
    },
  },
  LB: {
    category: "leather-badge",
    displayName: { zh: "皮革徽章", en: "Leather Badge" },
    description: {
      zh: "真皮徽章,皮套 / 金属配件,可刻字,适合企业 logo / 团队纪念",
      en: "Genuine leather badge with engraving, ideal for team branding",
    },
  },
  M: {
    category: "figure",
    displayName: { zh: "3D 手办", en: "3D Figurine" },
    description: {
      zh: "全彩树脂 3D 打印定制造型,底座 / 玻璃罩配件可选",
      en: "Full-color 3D-printed figurine with stand & glass cover options",
    },
  },
};

/** 全部配件 code 的展示元数据（用于 /api/image-gen/products） */
export const ACCESSORY_META: Readonly<Record<AccessoryCode, AccessoryMeta>> = {
  leather: {
    category: "material",
    name: { zh: "皮套", en: "Leather Sleeve" },
  },
  pvc: {
    category: "protection",
    name: { zh: "PVC 皮套", en: "PVC Sleeve" },
  },
  bracket: {
    category: "mount",
    name: { zh: "支架", en: "Bracket" },
  },
  metal: {
    category: "material",
    name: { zh: "金属扣", en: "Metal Buckle" },
  },
  magnet: {
    category: "mount",
    name: { zh: "磁铁", en: "Magnet" },
  },
  stand: {
    category: "mount",
    name: { zh: "底座", en: "Stand" },
  },
  // 2026-10-18 v1.6.0：M 手办玻璃罩（3 种尺寸变体由 productAccessoryVariant 表驱动）
  glass_cover: {
    category: "protection",
    name: { zh: "玻璃罩", en: "Glass Cover" },
  },
  // 2026-10-18 v1.6.0：R 钥匙扣编织绳（8 色变体由 productAccessoryVariant 表驱动）
  braided_rope: {
    category: "decor",
    name: { zh: "编织绳", en: "Braided Rope" },
  },
};

/** 找产品码的展示元数据；找不到返 null */
export function getProductMeta(
  code: string | null | undefined
): ProductMeta | null {
  if (!code) return null;
  return PRODUCT_META[code] ?? null;
}

/** 找配件 code 的展示元数据；找不到返 null */
export function getAccessoryMeta(
  code: string | null | undefined
): AccessoryMeta | null {
  if (!code) return null;
  return ACCESSORY_META[code as AccessoryCode] ?? null;
}

// ============================================
// 产品基价字典 —— 2026-10-18 v1.6.1
// ============================================
//
// 用途：/api/image-gen/products 在 ProductCapability.basePriceCents 上暴露，
// 前端拼 totalPrice = base + size.delta + variant.delta + style.surcharge。
// 与 mock-catalog.ts 的 BASE_PRICE_CENTS 对齐；这里是真理源，mock-catalog
// 反向 import（避免两处漂移）。Medusa 接管商品后这里改成读 Medusa 价格即可。
//
// 单位：分。改值需同步 PR 描述（订单归因 + admin 后台依赖此字典）。
// ============================================
export const BASE_PRICE_CENTS: Readonly<Record<string, number>> = {
  R: 1900, // ¥19 钥匙扣
  A: 2400, // ¥24 异性钥匙扣
  P: 3900, // ¥39 冰箱贴
  RM: 4900, // ¥49 相框
  LB: 5900, // ¥59 皮革徽章
  M: 19900, // ¥199 手办
};

/** 找产品码的基价（分）；找不到返 null（前端按 0 处理） */
export function getBasePriceCents(code: string | null | undefined): number | null {
  if (!code) return null;
  return BASE_PRICE_CENTS[code] ?? null;
}
