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
 *
 * 历史说明：2026-09-07 初版曾把"皮革徽章"作为 R 钥匙扣的 hasLeatherBadge
 * capability，让用户在 /p/[token] 上勾选。但用户原意是把它作为独立产品型号，
 * 所以 2026-09-07 同日重构：LB（皮革徽章）独立进 PRODUCT_TYPES，R 不再
 * 拥有此能力，hasLeatherBadge 字段从 schema / /configure 路由 / UI 全删。
 */
export interface ProductCapabilities {
  canEngrave: boolean;
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
    capabilities: { canEngrave: true },
  },
  {
    code: "A",
    name: "CM 异性钥匙扣",
    sizes: ["4", "6"],
    accessories: ["bracket"],
    // 异性款以支架为主；刻字仍支持
    capabilities: { canEngrave: true },
  },
  {
    code: "P",
    name: "CM 冰箱贴",
    sizes: ["4", "6", "8"],
    accessories: [], // 冰箱贴没配件
    // 冰箱贴不在表面刻字
    capabilities: { canEngrave: false },
  },
  {
    code: "RM",
    name: "CM 相框",
    sizes: ["6", "8", "11"],
    accessories: [],
    // 相框可在底座刻字（祝福语/日期）
    capabilities: { canEngrave: true },
  },
  {
    code: "LB",
    name: "CM 皮革徽章",
    sizes: ["4", "6"],
    accessories: [], // 皮革徽章无配件
    // 皮革徽章支持刻字（祝福语/日期/名字）
    capabilities: { canEngrave: true },
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
 * 把"产品定制"区（刻字 / 刻字内容 / 外露）渲染成一行可读字符串。仅在
 * 用户真的填了值时输出对应片段。
 *
 * - engravingText 非空 → `刻字："Love U"`（短文本原样）
 * - engravingText 非空且 engravingExposed=true → 上面那段尾巴加 "（外露）"
 * - engravingText 非空但 engravingExposed=false → "刻字：…（内刻）"
 *
 * 全 null 时返回空字符串（由 UI 决定是否展示"无定制"占位）。
 *
 * 历史：2026-09-07 初版还会渲染"✓ 皮革徽章"，但皮革徽章已重构为独立
 * 产品 LB，hasLeatherBadge 字段已删除。
 */
export function formatCustomization(opts: {
  engravingText?: string | null;
  engravingExposed?: boolean | null;
}): string {
  const parts: string[] = [];
  const text = opts.engravingText?.trim();
  if (text) {
    const place = opts.engravingExposed ? "（外露）" : "（内刻）";
    parts.push(`刻字：${text}${place}`);
  }
  return parts.join(" · ");
}
