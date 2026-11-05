/**
 * 移植自 wjp-source-code/src/lib/pricing-engine.ts —— 耗材克重报价计算器（PolyJet 全彩打印）。
 *
 * 算法逻辑与源实现保持一致；移植时仅做类型严格化（noUncheckedIndexedAccess /
 * exactOptionalPropertyTypes）与 Biome 格式化调整，未改变任何数值行为。
 */
/**
 * Pricing rule engine for the WJP (White-Jet-Print) resin calculator.
 *
 * Pure functions only — no React, no DOM. Safe to call from both server and
 * client code.
 *
 *   price = materialWeight × unitPrice + varnishFee
 *   materialWeight = volumeCM3 × materialDensity
 *
 * The volume passed in is already adjusted for "solid ratio" (manual mode:
 * envelope × solidRatio/100) by the caller via `estimateEnvelopeGeometry()`
 * or `scaleGeometry()`. Repair mode `rebuild` requires a manual quote.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RepairMode = "none" | "optimize" | "refine" | "rebuild";

export type CalcMode = "upload" | "manual";

export type ProductPreset = {
  id: string;
  name: string;
  /** 0-100, percentage of envelope that is solid material */
  solidRatio: number;
  /** 0-100, percentage of surface covered by white ink */
  coverage: number;
  desc: string;
  /** Hex color used for UI badges */
  color: string;
};

export type PricingConfig = {
  materialDensity: number; // g/cm³
  /**
   * 支撑材料密度 (g/cm³) —— 支撑跟模型**不是**一种材料
   *
   * 工作室用水溶性支撑(PVA/BVOH,约 1.13~1.30 g/cm³),模型是光敏树脂。
   * 支撑克重 = 支撑体积 × 这个密度;总克重 = 耗材克重 + 支撑克重
   * (不能再用「全包裹体积 × 单一密度」那套口径)。
   */
  supportDensity: number; // g/cm³
  unitPrice: number; // 元/g
  varnishFee: number; // 元
  varnishEnabled: boolean;
  repairMode: RepairMode;
  repairLabels: Record<RepairMode, string>;
  productPresets: ProductPreset[];
  productId: string;
  /** 支撑材料单价（元/g），默认 1 元/g */
  supportPrice: number;
  /** 本体支撑比例阈值（超过此比例的部分按支撑单价加收），默认 1.0 = 1:1 */
  supportThreshold: number;
  /** 支撑加价总开关（默认 false，关闭时不计支撑费用） */
  supportEnabled: boolean;
};

export type PricingInput = {
  volumeCM3: number;
  surfaceAreaCM2: number;
  mode: CalcMode;
  /** 0-100, current solid ratio applied (informational) */
  solidRatio: number;
  dims: [number, number, number];
  /** 可选：来自智能摆盘的总支撑克重（g）。若提供，则按超出 1:1 阈值的部分加收支撑费 */
  supportWeight?: number;
  /** 可选：来自智能摆盘的本体支撑比例（0-1）。若提供，用于计算超出阈值的部分 */
  selfSupportRatio?: number;
};

export type PricingResult = {
  materialWeight: number;
  weightFee: number;
  varnishFee: number;
  /** 支撑加价（元）。本体支撑比例超过 1:1 阈值时，超出部分的支撑克重按 supportPrice 元/g 加收 */
  supportFee: number;
  /** 支撑加价明细：超出阈值的支撑克重（g） */
  excessSupportWeight: number;
  totalPrice: number;
  repairMode: RepairMode;
  repairLabel: string;
  /** True when the repair mode requires a manual quote (currently only 'rebuild') */
  repairNeedsQuote: boolean;
  density: number;
  unitPrice: number;
  volumeCM3: number;
  surfaceAreaCM2: number;
  /** Human-readable summary of the formula */
  formulaText: string;
  /** Human-readable breakdown of the result */
  breakdownText: string;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_PRODUCT_PRESETS: ProductPreset[] = [
  {
    id: "pet",
    name: "宠物手办",
    solidRatio: 30,
    coverage: 50,
    desc: "立体写实件，半空心结构，表面图案覆盖 50%",
    color: "#f59e0b",
  },
  {
    id: "badge",
    name: "浮雕徽章",
    solidRatio: 60,
    coverage: 80,
    desc: "扁平板状，正面浮雕图案覆盖 80%",
    color: "#a78bfa",
  },
  {
    id: "keychain",
    name: "浮雕钥匙扣",
    solidRatio: 60,
    coverage: 80,
    desc: "小型扁平板，正反面图案覆盖 80%",
    color: "#22d3ee",
  },
  {
    id: "magnet",
    name: "冰箱贴",
    solidRatio: 50,
    coverage: 70,
    desc: "薄板磁吸件，正面图案覆盖 70%",
    color: "#84cc16",
  },
];

export const DEFAULT_CONFIG: PricingConfig = {
  materialDensity: 1.2,
  // 支撑材料密度 —— 水溶性支撑(PVA/BVOH)。默认 1.28(那卷支撑的实际密度,
  // 跟工作室对数用的口径一致:冰箱贴 43 + 59 = 102g)。工作室按自己那卷
  // 支撑的实际密度改「材料参数」里的支撑密度。
  supportDensity: 1.28,
  unitPrice: 4.5,
  varnishFee: 10,
  varnishEnabled: true,
  repairMode: "none",
  repairLabels: {
    none: "无需修复",
    optimize: "优化网格",
    refine: "细化细节",
    rebuild: "重建网格",
  },
  productPresets: DEFAULT_PRODUCT_PRESETS,
  productId: "pet",
  supportPrice: 1.0, // 1 元/g
  supportThreshold: 1.0, // 1:1 阈值
  supportEnabled: false, // 默认关闭，避免估算误差影响报价
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_DIMS: [number, number, number] = [0, 0, 0];

const isFiniteNum = (v: number): boolean =>
  typeof v === "number" && Number.isFinite(v);

const fmt = (v: number, digits = 2): string => {
  if (!isFiniteNum(v)) return "—";
  return v.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
};

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Calculate the price for the given input + config.
 *
 * Returns `null` if the input is invalid (non-finite or non-positive volume).
 *
 * Pure function — same inputs always produce the same output.
 */
export function calculatePrice(
  config: PricingConfig,
  input: PricingInput
): PricingResult | null {
  const density = config.materialDensity;
  const unitPrice = config.unitPrice;
  const volumeCM3 = input.volumeCM3;
  const surfaceAreaCM2 = input.surfaceAreaCM2;

  if (!isFiniteNum(volumeCM3) || volumeCM3 <= 0) return null;
  if (!isFiniteNum(density) || density <= 0) return null;
  if (!isFiniteNum(unitPrice) || unitPrice < 0) return null;

  const materialWeight = volumeCM3 * density;
  const weightFee = materialWeight * unitPrice;
  const varnishFee =
    config.varnishEnabled && isFiniteNum(config.varnishFee)
      ? Math.max(0, config.varnishFee)
      : 0;

  // ---- 支撑加价：本体支撑比例超过 1:1 阈值时，超出部分的支撑克重按 supportPrice 元/g 加收 ----
  // 当本体支撑比例 > supportThreshold（默认 1.0 = 1:1）时：
  //   超出比例 = selfSupportRatio - supportThreshold
  //   超出克重 = totalSupportWeight × (超出比例 / selfSupportRatio)
  //   支撑加价 = 超出克重 × supportPrice
  let supportFee = 0;
  let excessSupportWeight = 0;
  const supportPrice =
    isFiniteNum(config.supportPrice) && config.supportPrice > 0
      ? config.supportPrice
      : 0;
  const supportThreshold =
    isFiniteNum(config.supportThreshold) && config.supportThreshold > 0
      ? config.supportThreshold
      : 1.0;
  if (
    input.supportWeight &&
    input.supportWeight > 0 &&
    input.selfSupportRatio &&
    input.selfSupportRatio > supportThreshold &&
    supportPrice > 0
  ) {
    const excessRatio =
      (input.selfSupportRatio - supportThreshold) / input.selfSupportRatio;
    excessSupportWeight = input.supportWeight * excessRatio;
    supportFee = excessSupportWeight * supportPrice;
  }

  const totalPrice = weightFee + varnishFee + supportFee;

  const repairNeedsQuote = config.repairMode === "rebuild";
  const repairLabel = config.repairLabels?.[config.repairMode] ?? "";

  const saText =
    isFiniteNum(surfaceAreaCM2) && surfaceAreaCM2 > 0
      ? `，表面积 ${fmt(surfaceAreaCM2)} cm²`
      : "";

  const supportText =
    supportFee > 0
      ? ` + 支撑超出 ${fmt(excessSupportWeight)} g × ${fmt(supportPrice)} 元/g = ${fmt(supportFee)} 元`
      : "";

  const formulaText = `克重 = 体积 ${fmt(volumeCM3)} cm³ × 密度 ${fmt(density)} g/cm³，报价 = 克重 × ${fmt(unitPrice)} 元/g${config.varnishEnabled ? ` + 光油 ${fmt(varnishFee)} 元` : ""}${supportFee > 0 ? ` + 支撑超出 ${fmt(supportPrice)} 元/g` : ""}`;

  const breakdownText =
    `材料 ${fmt(materialWeight)} g × ${fmt(unitPrice)} 元/g = ${fmt(weightFee)} 元` +
    (config.varnishEnabled ? ` + 光油 ${fmt(varnishFee)} 元` : "") +
    supportText +
    ` = ${fmt(totalPrice)} 元` +
    saText;

  return {
    materialWeight,
    weightFee,
    varnishFee,
    supportFee,
    excessSupportWeight,
    totalPrice,
    repairMode: config.repairMode,
    repairLabel,
    repairNeedsQuote,
    density,
    unitPrice,
    volumeCM3,
    surfaceAreaCM2,
    formulaText,
    breakdownText,
  };
}

/**
 * Scale volume, surface area and dimensions by a uniform factor `k`.
 *   - volume × k³
 *   - surface × k²
 *   - dims × k
 *
 * Useful for the "custom scale" UI: user enters a new length on one axis,
 * and the other two scale proportionally.
 */
export function scaleGeometry(
  volume: number,
  surface: number,
  dims: [number, number, number],
  k: number
): {
  volumeCM3: number;
  surfaceAreaCM2: number;
  dims: [number, number, number];
} {
  const safeK = isFiniteNum(k) ? k : 1;
  return {
    volumeCM3: volume * safeK * safeK * safeK,
    surfaceAreaCM2: surface * safeK * safeK,
    dims: [dims[0] * safeK, dims[1] * safeK, dims[2] * safeK],
  };
}

/**
 * Estimate geometry from a rectangular envelope (L × W × H) in mm.
 *
 *   volumeCM3 = (L × W × H) / 1000 × (solidRatio / 100)
 *   surfaceAreaCM2 = 2 × (LW + LH + WH) / 100
 *
 * Used by "manual estimation mode" — assumes the model fills the envelope
 * box to `solidRatio` percent.
 */
export function estimateEnvelopeGeometry(
  l: number,
  w: number,
  h: number,
  solidRatio: number
): {
  volumeCM3: number;
  surfaceAreaCM2: number;
  dims: [number, number, number];
} {
  const safeL = isFiniteNum(l) ? Math.max(0, l) : 0;
  const safeW = isFiniteNum(w) ? Math.max(0, w) : 0;
  const safeH = isFiniteNum(h) ? Math.max(0, h) : 0;
  const safeRatio = isFiniteNum(solidRatio)
    ? Math.min(100, Math.max(0, solidRatio))
    : 0;

  const envelopeMM3 = safeL * safeW * safeH;
  const envelopeCM3 = envelopeMM3 / 1000;
  const volumeCM3 = envelopeCM3 * (safeRatio / 100);

  const surfaceMM2 = 2 * (safeL * safeW + safeL * safeH + safeW * safeH);
  const surfaceAreaCM2 = surfaceMM2 / 100;

  const dims: [number, number, number] = [safeL, safeW, safeH];
  return { volumeCM3, surfaceAreaCM2, dims: dims.length ? dims : DEFAULT_DIMS };
}

/**
 * Look up a product preset by id from the config. Returns `undefined` if not found.
 */
export function getProductPreset(
  config: PricingConfig,
  productId: string
): ProductPreset | undefined {
  return config.productPresets.find((p) => p.id === productId);
}
