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
  /**
   * 支撑材料单价 —— **分段计价**(2026-11-06)
   *
   * 工作室的规则(原文):「模型支撑超过 1:1 的多的支撑按照 0.5 元一克,
   * 1:2 的多的支撑按照 1 元一克」。所以超出阈值的那部分**分两段**收:
   *
   * ```
   * 本体支撑比例 r = 支撑克重 ÷ 耗材克重   (1 = 1:1,2 = 1:2)
   *
   * r ≤ 1        不收钱(1:1 以内的支撑是工艺必需)
   * 1 < r ≤ 2    超出部分 × supportTier1Price    ← 第一档(0.5 元/g)
   * r > 2        再超出部分 × supportTier2Price  ← 第二档(1 元/g)
   * ```
   *
   * 阈值以下不收、超出部分收钱这两条没变,变的只是超出部分**分两段定价**。
   */
  supportTier1Ratio: number;
  /** 第一档单价 元/g —— 超出 1:1 到 1:2 之间那部分(默认 0.5) */
  supportTier1Price: number;
  /** 第二档单价 元/g —— 超过 1:2 那部分(默认 1) */
  supportTier2Price: number;
  /** 本体支撑比例阈值（超过此比例的部分按分段单价加收），默认 1.0 = 1:1 */
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
  /** 支撑加价（元）。分段计价 —— 见 `computeSupportFeeBands()` */
  supportFee: number;
  /** 支撑加价明细：超出阈值的支撑克重（g，两档之和） */
  excessSupportWeight: number;
  /** 支撑加价的分段明细 —— 每一档的克重和钱 */
  supportFeeBands: SupportFeeBand[];
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

/**
 * 支撑加价的**一档**
 *
 * 档位的边界是「本体支撑比例」(`支撑克重 ÷ 耗材克重`):1 = 1:1,2 = 1:2。
 */
export type SupportFeeBand = {
  /** 这一档的**下**界(比例)—— 第一档是阈值,后面是上一档的上界 */
  fromRatio: number;
  /** 这一档的**上**界(比例)—— 最后一档是 null(没有上限) */
  upToRatio: number | null;
  /** 这一档的单价 元/g */
  price: number;
  /** 这一档收钱的支撑克重 g */
  weightG: number;
  /** 这一档的钱 元 */
  fee: number;
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
  // 支撑加价 —— 分段计价(工作室规则:超 1:1 的按 0.5 元/g,超 1:2 的按 1 元/g)
  supportTier1Ratio: 2.0, // 第一档上界 = 1:2
  supportTier1Price: 0.5, // 0.5 元/g
  supportTier2Price: 1.0, // 1 元/g
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
 * 支撑加价的**分段计算** —— 纯函数
 *
 * 工作室的规则(2026-11-06 原文):「模型支撑超过 1:1 的多的支撑按照 0.5 元
 * 一克,1:2 的多的支撑按照 1 元一克」。
 *
 * ```
 * 本体支撑比例 r = 支撑克重 ÷ 耗材克重   (1 = 1:1,2 = 1:2)
 *
 * r ≤ T            不收钱(T = 阈值,默认 1)
 * T < r ≤ b        超出部分 × tier1Price    ← 第一档(0.5 元/g)
 * r > b            再超出部分 × tier2Price  ← 第二档(1 元/g)
 * ```
 *
 * ## 克重怎么切
 *
 * 支撑克重 `W` 是**总的**,要按比例把「收钱的那部分」分配到两档:
 *
 * ```
 * 第一档克重 = W × (min(r, b) − T) / r
 * 第二档克重 = W × (r − b) / r          (r > b 时才有)
 * ```
 *
 * 两档加起来 = `W × (r − T) / r` —— 跟原来「超阈值部分按一个单价收」的老公式
 * **完全一致**。变的只是超出部分**分两段定价**。
 *
 * ## 退化情形
 *
 * - `b ≤ T`(后台把第一档上界配得比阈值还小)→ `b` 取 `T`,第一档为空,
 *   所有超出部分都进第二档。
 * - 单价配成 0 → 那一档不收钱(但克重仍然算出来,明细里看得见)。
 */
export function computeSupportFeeBands(input: {
  /** 总支撑克重 g */
  supportWeight?: number | undefined;
  /** 本体支撑比例 = 支撑克重 ÷ 耗材克重 */
  selfSupportRatio?: number | undefined;
  /** 阈值(1 = 1:1)—— 低于它不收钱 */
  threshold: number;
  /** 第一档上界(2 = 1:2) */
  tier1Ratio: number;
  /** 第一档单价 元/g */
  tier1Price: number;
  /** 第二档单价 元/g */
  tier2Price: number;
}): SupportFeeBand[] {
  const W = input.supportWeight;
  const r = input.selfSupportRatio;
  if (W === undefined || r === undefined) return [];
  if (
    !isFiniteNum(W) ||
    W <= 0 ||
    !isFiniteNum(r) ||
    r <= 0 ||
    !isFiniteNum(input.threshold) ||
    input.threshold <= 0
  ) {
    return [];
  }

  const T = input.threshold;
  // 第一档上界不能小于阈值 —— 否则第一档是空的,超出部分全进第二档
  const b = Math.max(T, isFiniteNum(input.tier1Ratio) ? input.tier1Ratio : T);
  const tier1Price = isFiniteNum(input.tier1Price) ? input.tier1Price : 0;
  const tier2Price = isFiniteNum(input.tier2Price) ? input.tier2Price : 0;

  if (r <= T) return [];

  const bands: SupportFeeBand[] = [];

  // 第一档:从阈值到 min(r, b) 之间那部分
  const band1Ratio = Math.min(r, b);
  if (band1Ratio > T) {
    const weightG = W * ((band1Ratio - T) / r);
    bands.push({
      fromRatio: T,
      upToRatio: b,
      price: tier1Price,
      weightG,
      fee: weightG * tier1Price,
    });
  }

  // 第二档:超过 b 的那部分(没有上界)
  if (r > b) {
    const weightG = W * ((r - b) / r);
    bands.push({
      fromRatio: b,
      upToRatio: null,
      price: tier2Price,
      weightG,
      fee: weightG * tier2Price,
    });
  }

  return bands;
}

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

  // ---- 支撑加价：分段计价 ----
  // 见 `computeSupportFeeBands()` —— 阈值以下不收,超出的部分分两档定价。
  const supportFeeBands = computeSupportFeeBands({
    supportWeight: input.supportWeight,
    selfSupportRatio: input.selfSupportRatio,
    threshold: config.supportThreshold,
    tier1Ratio: config.supportTier1Ratio,
    tier1Price: config.supportTier1Price,
    tier2Price: config.supportTier2Price,
  });
  const supportFee = supportFeeBands.reduce((sum, b) => sum + b.fee, 0);
  const excessSupportWeight = supportFeeBands.reduce(
    (sum, b) => sum + b.weightG,
    0
  );

  const totalPrice = weightFee + varnishFee + supportFee;

  const repairNeedsQuote = config.repairMode === "rebuild";
  const repairLabel = config.repairLabels?.[config.repairMode] ?? "";

  const saText =
    isFiniteNum(surfaceAreaCM2) && surfaceAreaCM2 > 0
      ? `，表面积 ${fmt(surfaceAreaCM2)} cm²`
      : "";

  // 支撑分段明细 —— 每一档写「克重 × 单价」
  const supportBandText = supportFeeBands
    .map((b) => `${fmt(b.weightG)} g × ${fmt(b.price)} 元/g`)
    .join(" + ");

  const supportText =
    supportFee > 0
      ? ` + 支撑超出 ${fmt(excessSupportWeight)} g（${supportBandText}）= ${fmt(supportFee)} 元`
      : "";

  const formulaText = `克重 = 体积 ${fmt(volumeCM3)} cm³ × 密度 ${fmt(density)} g/cm³，报价 = 克重 × ${fmt(unitPrice)} 元/g${config.varnishEnabled ? ` + 光油 ${fmt(varnishFee)} 元` : ""}${supportFee > 0 ? ` + 支撑分段加价` : ""}`;

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
    supportFeeBands,
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
