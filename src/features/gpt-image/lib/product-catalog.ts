/**
 * 产品型号字典（飞书 docx "链接生成管理系统"）
 *
 * 2026-08-23 引入 ToB 代理商业务后，订单要绑"产品型号 + 尺寸 + 配件"三件套。
 * 字典先 hardcoded 在代码里：4 个产品型号 × 多个尺寸 + 3 个配件，
 * 不上 DB（量小、改动少、admin 后台挑 select 不需要动态）。等真到"代理
 * 商自己配置 SKU"那一步再迁到 prompt_template 或独立 product 表。
 *
 * 命名约定：
 * - productTypeCode: 'R' | 'A' | 'P' | 'RM'（单字母，跟 PDF 二维码表格一致）
 * - productSize: '4' | '6' | '8' | '11'（厘米，纯数字字符串，便于拼接）
 * - accessoryCode: 'leather' | 'pvc' | 'bracket' | null
 *
 * 与 promptOrder.product_type_code / product_size / accessory_code 列 1:1 对应。
 */

export interface ProductType {
  code: string;
  name: string;
  /** 该型号下可选的尺寸（厘米数字字符串） */
  sizes: readonly string[];
  /** 该型号下可选的配件；null 表示该型号无配件选项 */
  accessories: readonly AccessoryCode[];
}

export const PRODUCT_TYPES: readonly ProductType[] = [
  {
    code: "R",
    name: "CM 钥匙扣",
    sizes: ["4", "6"],
    accessories: ["leather", "pvc"],
  },
  {
    code: "A",
    name: "CM 异性钥匙扣",
    sizes: ["4", "6"],
    accessories: ["bracket"],
  },
  {
    code: "P",
    name: "CM 冰箱贴",
    sizes: ["4", "6", "8"],
    accessories: [], // 冰箱贴没配件
  },
  {
    code: "RM",
    name: "CM 相框",
    sizes: ["6", "8", "11"],
    accessories: [],
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
