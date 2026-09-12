/**
 * 2026-09-12：订单文本智能识别器（本地纯 JS）
 *
 * 用户在 SpecModal「订单来源」段粘贴淘宝/小红书/抖音订单详情页文本，
 * 本解析器从纯文本中提取 platform + 渠道订单号 + 商品信息，
 * 静默 setValue 到 RHF 表单（不弹 toast、不阻塞用户）。
 *
 * 设计：
 * - 纯函数：输入 string → 输出 ParsedOrderText（识别的字段 + 命中关键字）
 * - 无外部依赖：本地正则 + 字典匹配，无 OCR、无网络调用
 * - 字段缺失就跳过：识别失败的字段不写，让用户手动选
 *
 * 识别字段：
 * - platform：淘宝/小红书/抖音/独立站/拼多多/微信/京东等
 * - platformOrderNo：订单号（淘宝 15~18 位数字、小红书字母数字混合等）
 * - productTypeCode：LB（皮革徽章）/ CM / R 等型号字典 code
 * - productSize：4 / 6 / 8 / 11 cm
 * - leatherColor：natural / brown / black / red / navy（LB 皮革颜色字典）
 * - accessoryCode：leather / metal（LB 二选一配件）
 *
 * 限制：
 * - 用户粘贴的是 order detail 页文本，可能含其他字段（地址、价格、买家留言）
 * - 解析失败字段静默跳过（用户后续手动选）
 * - 不写备注 / 刻字 / 皮革外露 / PVC 保护（这些是用户意图，不是订单详情）
 */

import {
  LEATHER_COLORS,
  PLATFORMS,
  PRODUCT_TYPES,
  type PlatformCode,
} from "@/features/gpt-image/lib/product-catalog";

export interface ParsedOrderText {
  platform: PlatformCode | null;
  platformOrderNo: string | null;
  productTypeCode: string | null;
  productSize: string | null;
  leatherColor: string | null;
  accessoryCode: string | null;
  /** 哪些字段是"智能识别"填的（用于 UI 加小标） */
  inferredFields: Set<string>;
}

const EMPTY_PARSED: ParsedOrderText = {
  platform: null,
  platformOrderNo: null,
  productTypeCode: null,
  productSize: null,
  leatherColor: null,
  accessoryCode: null,
  inferredFields: new Set<string>(),
};

/**
 * 主解析函数：从粘贴文本识别订单字段
 *
 * @param rawText 用户粘贴的订单文本（淘宝/小红书/抖音订单详情页）
 * @returns 识别结果（部分字段可能为 null）
 */
export function parseOrderText(rawText: string): ParsedOrderText {
  const result: ParsedOrderText = {
    ...EMPTY_PARSED,
    inferredFields: new Set<string>(),
  };
  if (!rawText || rawText.trim().length === 0) return result;

  const text = rawText.trim();

  // 1. 识别 platform：按关键字匹配（淘宝、小红书、抖音等）
  const platformResult = inferPlatform(text);
  if (platformResult) {
    result.platform = platformResult;
    result.inferredFields.add("platform");
  }

  // 2. 识别订单号：根据已识别平台走不同正则
  const orderNo = inferOrderNo(text, result.platform);
  if (orderNo) {
    result.platformOrderNo = orderNo;
    result.inferredFields.add("platformOrderNo");
  }

  // 3. 识别商品型号（productTypeCode）
  const typeCode = inferProductType(text);
  if (typeCode) {
    result.productTypeCode = typeCode;
    result.inferredFields.add("productTypeCode");
  }

  // 4. 识别尺寸（4/6/8/11 cm）
  const size = inferSize(text);
  if (size) {
    result.productSize = size;
    result.inferredFields.add("productSize");
  }

  // 5. 识别皮革颜色（natural/brown/black/red/navy）
  const color = inferLeatherColor(text);
  if (color) {
    result.leatherColor = color;
    result.inferredFields.add("leatherColor");
  }

  // 6. 识别配件（皮革 / 金属）
  const accessory = inferAccessory(text);
  if (accessory) {
    result.accessoryCode = accessory;
    result.inferredFields.add("accessoryCode");
  }

  return result;
}

// ============================================
// platform 识别
// ============================================

/**
 * 关键字 → PlatformCode 映射表。
 * 关键字匹配方式：完整词命中（避免 "taobao.com" 误中"tao"）。
 * 顺序：精确的在前（"淘宝订单" 先于 "淘"）。
 */
const PLATFORM_KEYWORDS: Array<{ kw: string; code: PlatformCode }> = [
  // 自营 / 第三方电商
  { kw: "淘宝", code: "taobao" },
  { kw: "天猫", code: "taobao" },
  { kw: "taobao", code: "taobao" },
  { kw: "小红书", code: "xiaohongshu" },
  { kw: "RED", code: "xiaohongshu" }, // 小红书 app 常显示 RED
  { kw: "xiaohongshu", code: "xiaohongshu" },
  { kw: "抖音", code: "douyin" },
  { kw: "douyin", code: "douyin" },
  { kw: "tiktok", code: "douyin" },
  // 独立站 / 推广
  { kw: "独立站", code: "independent_site" },
  // 网红 / 合作方
  { kw: "红人", code: "domestic_influencer" },
  { kw: "influencer", code: "foreign_influencer" },
  { kw: "合作", code: "partner" },
  { kw: "营销", code: "marketing" },
];

function inferPlatform(text: string): PlatformCode | null {
  for (const { kw, code } of PLATFORM_KEYWORDS) {
    if (text.includes(kw)) {
      // 兜底校验 code 在 PLATFORMS 字典里（防御性编程）
      if (PLATFORMS.some((p) => p.code === code)) return code;
    }
  }
  return null;
}

// ============================================
// 订单号识别
// ============================================

/**
 * 订单号识别规则：
 * - 淘宝/天猫：15~18 位纯数字（最长 19 位）
 * - 小红书：字母数字混合，通常以 "XHS" 开头或纯字母数字 ≥ 10 位
 * - 抖音：19 位数字 或 "dy" 前缀
 * - 通用兜底：连续 12~20 位字母数字组合（避开中文字符）
 */
function inferOrderNo(text: string, platform: PlatformCode | null): string | null {
  // 优先看带"订单号"标签的行（淘宝详情页常见 "订单编号：1234567890123456"）
  const labeledMatch = text.match(
    /(?:订单号|订单编号|order[\s_]?(?:no|id|number))[:：\s]*([A-Za-z0-9_-]{8,32})/i
  );
  if (labeledMatch?.[1]) return labeledMatch[1];

  // 按平台规则匹配
  if (platform === "taobao") {
    const m = text.match(/\b\d{15,19}\b/);
    return m?.[0] ?? null;
  }
  if (platform === "xiaohongshu") {
    // 小红书订单号常见格式：XHSxxx 或纯字母数字 ≥ 10 位
    const xhs = text.match(/\b(?:XHS|xhs)[A-Za-z0-9]{8,24}\b/);
    if (xhs) return xhs[0];
    const m = text.match(/\b[A-Za-z0-9]{10,24}\b/);
    return m?.[0] ?? null;
  }
  if (platform === "douyin") {
    const dy = text.match(/\b(?:dy|DY)\d{10,24}\b/);
    if (dy) return dy[0];
    const m = text.match(/\b\d{15,24}\b/);
    return m?.[0] ?? null;
  }

  // 通用兜底：12~24 位字母数字（避开日期、电话等过短数字）
  const generic = text.match(/\b[A-Za-z0-9_-]{12,24}\b/);
  return generic?.[0] ?? null;
}

// ============================================
// productTypeCode 识别
// ============================================

/**
 * 型号识别：从文本中匹配 PRODUCT_TYPES 字典的 name 字段。
 * 例：「皮革徽章」→ "LB"
 */
function inferProductType(text: string): string | null {
  for (const t of PRODUCT_TYPES) {
    if (text.includes(t.name)) return t.code;
  }
  return null;
}

// ============================================
// productSize 识别
// ============================================

/**
 * 尺寸识别：匹配 "4cm / 4 cm / 4厘米 / 6CM" 等格式。
 * 只识别 PRODUCT_TYPES 各型号 sizes 字典里的合法值（4/6/8/11）。
 */
const VALID_SIZES = new Set(["4", "6", "8", "11"]);

function inferSize(text: string): string | null {
  const matches = text.matchAll(/\b(\d{1,2})\s*(?:cm|厘米|CM|Cm)\b/g);
  for (const m of matches) {
    const num = m[1];
    if (num && VALID_SIZES.has(num)) return num;
  }
  // 兜底：「4cm装」「6cm款」等中文后缀
  const cnMatches = text.matchAll(/(\d{1,2})\s*(?:cm|厘米|CM)/g);
  for (const m of cnMatches) {
    const num = m[1];
    if (num && VALID_SIZES.has(num)) return num;
  }
  return null;
}

// ============================================
// leatherColor 识别
// ============================================

function inferLeatherColor(text: string): string | null {
  for (const c of LEATHER_COLORS) {
    if (text.includes(c.name)) return c.code;
  }
  return null;
}

// ============================================
// accessoryCode 识别
// ============================================

function inferAccessory(text: string): "leather" | "metal" | null {
  // 「金属」必须在「皮」之前判断（避免"皮革"误中"皮"）
  if (text.includes("金属")) return "metal";
  if (text.includes("皮套") || text.includes("皮革") || text.includes("皮质")) {
    return "leather";
  }
  return null;
}
