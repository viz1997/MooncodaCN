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
 * - productTypeCode: 'R' | 'A' | 'P' | 'RM'（单字母，跟 PDF 二维码表格一致）
 * - productSize: '4' | '6' | '8' | '11'（厘米，纯数字字符串，便于拼接）
 * - accessoryCode: 'leather' | 'pvc' | 'bracket' | null
 *
 * 与 promptOrder.product_type_code / product_size / accessory_code 列 1:1 对应。
 */

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
}

export interface ProductType {
  code: string;
  name: string;
  /** 该型号下可选的尺寸（厘米数字字符串） */
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
    sizes: ["4", "6"],
    accessories: ["leather", "pvc"],
    // 钥匙扣常配皮套 / PVC 皮套；皮革徽章是独立型号 LB，不再是 R 的能力
    capabilities: {
      canEngrave: true,
      canLeatherColor: false,
      canPvcProtection: false,
      canLeatherExposed: false,
      canHaveRemarks: false,
    },
  },
  {
    code: "A",
    name: "CM 异性钥匙扣",
    sizes: ["4", "6"],
    accessories: ["bracket"],
    // 异性款以支架为主；刻字仍支持
    capabilities: {
      canEngrave: true,
      canLeatherColor: false,
      canPvcProtection: false,
      canLeatherExposed: false,
      canHaveRemarks: false,
    },
  },
  {
    code: "P",
    name: "CM 冰箱贴",
    sizes: ["4", "6", "8"],
    accessories: [], // 冰箱贴没配件
    // 冰箱贴不在表面刻字
    capabilities: {
      canEngrave: false,
      canLeatherColor: false,
      canPvcProtection: false,
      canLeatherExposed: false,
      canHaveRemarks: false,
    },
  },
  {
    code: "RM",
    name: "CM 相框",
    sizes: ["6", "8", "11"],
    accessories: [],
    // 相框可在底座刻字（祝福语/日期）
    capabilities: {
      canEngrave: true,
      canLeatherColor: false,
      canPvcProtection: false,
      canLeatherExposed: false,
      canHaveRemarks: false,
    },
  },
  {
    code: "LB",
    name: "CM 皮革徽章",
    sizes: ["4", "6"],
    accessories: [], // 皮革徽章无配件
    // 2026-09-10：LB 全加工能力开启（颜色 / 外露 / PVC / 备注 + 原有的刻字）
    capabilities: {
      canEngrave: true,
      canLeatherColor: true,
      canPvcProtection: true,
      canLeatherExposed: true,
      canHaveRemarks: true,
    },
  },
];

export type AccessoryCode = "leather" | "pvc" | "bracket";

export interface Accessory {
  code: AccessoryCode;
  name: string;
}

export const ACCESSORIES: readonly Accessory[] = [
  { code: "leather", name: "皮套" },
  { code: "pvc", name: "PVC 皮套" },
  { code: "bracket", name: "支架" },
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
 * 把"产品定制"区渲染成一行可读字符串。仅在用户真的填了值时输出对应片段。
 *
 * - engravingText 非空 → `刻字："Love U"`（短文本原样）
 * - engravingText 非空且 engravingExposed=true → 上面那段尾巴加 "（外露）"
 * - engravingText 非空但 engravingExposed=false → "刻字：…（内刻）"
 * - leatherColor 非空 → `皮革色：棕色`（按 LEATHER_COLORS 字典取中文名）
 * - pvcProtection=true → `带 PVC 保护`
 * - leatherExposed=true → `皮革外露`
 * - remarks → **不进 summary**（备注可能很长 / 含换行，单独渲染更合适）
 *
 * 全 null 时返回空字符串（由 UI 决定是否展示"无定制"占位）。
 *
 * 历史：2026-09-07 初版还会渲染"✓ 皮革徽章"，但皮革徽章已重构为独立
 * 产品 LB，hasLeatherBadge 字段已删除。2026-09-10 扩到 LB 全加工维度。
 */
export function formatCustomization(opts: {
  engravingText?: string | null;
  engravingExposed?: boolean | null;
  leatherColor?: string | null;
  leatherExposed?: boolean | null;
  pvcProtection?: boolean | null;
  remarks?: string | null;
}): string {
  const parts: string[] = [];
  const text = opts.engravingText?.trim();
  if (text) {
    const place = opts.engravingExposed ? "（外露）" : "（内刻）";
    parts.push(`刻字：${text}${place}`);
  }
  const color = getLeatherColor(opts.leatherColor);
  if (color) parts.push(`皮革色：${color.name}`);
  if (opts.pvcProtection === true) parts.push("带 PVC 保护");
  if (opts.leatherExposed === true) parts.push("皮革外露");
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
