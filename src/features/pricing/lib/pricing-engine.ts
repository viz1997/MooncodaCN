/**
 * 计价引擎 —— **只在服务端跑**
 *
 * ## ⛔ 这个文件不许进客户端 bundle
 *
 * 工作室 2026-11-16 的原话:「不要展示 4.5 元/g 这种单价,避免暴露我们的
 * 成本」。
 *
 * 「**不展示**」不够 —— 只要客户端 bundle 里还留着 `unitPrice: 4.5` 这个
 * 字面量,任何人打开页面源码 / 翻一下 JS chunk 就看见了。所以规矩是:
 *
 * ```
 * 客户端能 import 的:pricing-geometry.ts / material-weight.ts
 * 客户端不许 import 的:pricing-engine.ts(这个文件)
 * ```
 *
 * 仓库里没有 `server-only` 这个包(装不了就靠**结构 + 单测**守):
 * `src/test/print-quote/pure/quote-public.test.ts` 扫全仓,
 * **任何** `"use client"` 文件 import 这个文件 ⇒ 测试当场失败。
 *
 * ## 公式
 *
 * ```
 * 耗材克重 = 体积 × 材料密度
 * 克重费   = 耗材克重 × 材料单价
 * 支撑加价 = 超阈值的支撑克重,分两档定价
 * 合计     = 克重费 + 后处理费 + 支撑加价
 * ```
 *
 * 引擎内部用**元**(浮点),对外一律**分** —— 转换只发生在两个边界上
 * (`quote-server.ts` 的 `yuanToCentsCeil`),中间不碰。
 *
 * ## 跟客户端那一半的关系
 *
 * 几何(`pricing-geometry.ts`)和克重(`material-weight.ts`)在客户端算 ——
 * 界面要**实时**跟着尺寸变。但**钱**在这儿算,服务端说了算。
 */

import {
  DEFAULT_MATERIAL_DENSITY,
  DEFAULT_SUPPORT_DENSITY,
} from "@/features/pricing/lib/material-weight";
import { isFiniteNum } from "@/features/pricing/lib/pricing-geometry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  /** 材料单价 元/g —— ⛔ 成本口径,只进服务端 */
  unitPrice: number; // 元/g
  /** 后处理(光油)费 元 */
  varnishFee: number; // 元
  /** 光油要不要算 */
  varnishEnabled: boolean;
  /**
   * 支撑材料单价 —— **分段计价**(2026-11-06)
   *
   * 工作室的规则(原文):「模型支撑超过 1:1 的多的支撑按照 0.5 元一克,
   * 1:2 的多的支撑按照 1 元一克」。所以超出阈值的那部分**分两段**收:
   *
   * ```
   * 本体支撑比例 r = 支撑克重 ÷ 耗材克重   (1 = 1:1,2 = 1:2)
   *
   * r ≤ T        不收钱(T = 阈值,默认 1 —— 1:1 以内是工艺必需)
   * T < r ≤ b    超出部分 × supportTier1Price    ← 第一档(0.5 元/g)
   * r > b        再超出部分 × supportTier2Price  ← 第二档(1 元/g)
   * ```
   *
   * 阈值以下不收、超出部分收钱这两条没变,变的只是超出部分**分两段定价**。
   */
  supportTier1Ratio: number;
  /** 第一档单价 元/g —— 超出 1:1 到 1:2 之间那部分(默认 0.5) */
  supportTier1Price: number;
  /** 第二档单价 元/g —— 超过 1:2 那部分(默认 1) */
  supportTier2Price: number;
  /** 本体支撑比例阈值(超过此比例的部分按分段单价加收),默认 1.0 = 1:1 */
  supportThreshold: number;
  /** 支撑加价总开关(默认 false,关闭时不计支撑费用) */
  supportEnabled: boolean;
};

export type PricingInput = {
  /** 体积 cm³ —— 上传模式是解析出来的实体积 */
  volumeCM3: number;
  /** 表面积 cm² */
  surfaceAreaCM2: number;
  /** 可选:来自智能摆盘的总支撑克重(g)。若提供,则按超出 1:1 阈值的部分加收支撑费 */
  supportWeight?: number;
  /** 可选:来自智能摆盘的本体支撑比例(0-1)。若提供,用于计算超出阈值的部分 */
  selfSupportRatio?: number;
};

export type PricingResult = {
  /** 耗材克重 g */
  materialWeight: number;
  /** 克重费 元 */
  weightFee: number;
  /** 后处理费 元 */
  varnishFee: number;
  /** 支撑加价(元)。分段计价 —— 见 `computeSupportFeeBands()` */
  supportFee: number;
  /** 支撑加价明细:超出阈值的支撑克重(g,两档之和) */
  excessSupportWeight: number;
  /** 支撑加价的分段明细 —— 每一档的克重和钱 */
  supportFeeBands: SupportFeeBand[];
  /** 合计 元 = 克重费 + 后处理费 + 支撑加价 */
  totalPrice: number;
  /** 材料密度 g/cm³(算出来的,给界面显示用) */
  density: number;
  /** 算的时候用的体积 cm³ */
  volumeCM3: number;
  /** 算的时候用的表面积 cm² */
  surfaceAreaCM2: number;
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

/**
 * 出厂默认 —— 兜底那一档
 *
 * 回退链是 `DB 配置行 → PRINT_* 环境变量 → DEFAULT_CONFIG`(逐字段),
 * 见 `pricing-settings.ts`。
 *
 * ⚠️ **这里面的单价是成本口径** —— 这个文件不许进客户端 bundle。
 */
export const DEFAULT_CONFIG: PricingConfig = {
  materialDensity: DEFAULT_MATERIAL_DENSITY,
  // 支撑材料密度 —— 水溶性支撑(PVA/BVOH)。默认 1.28(那卷支撑的实际密度,
  // 跟工作室对数用的口径一致:冰箱贴 43 + 59 = 102g)。工作室按自己那卷
  // 支撑的实际密度改「材料参数」里的支撑密度。
  supportDensity: DEFAULT_SUPPORT_DENSITY,
  unitPrice: 4.5,
  varnishFee: 10,
  varnishEnabled: true,
  // 支撑加价 —— 分段计价(工作室规则:超 1:1 的按 0.5 元/g,超 1:2 的按 1 元/g)
  supportTier1Ratio: 2.0, // 第一档上界 = 1:2
  supportTier1Price: 0.5, // 0.5 元/g
  supportTier2Price: 1.0, // 1 元/g
  supportThreshold: 1.0, // 1:1 阈值
  supportEnabled: false, // 默认关闭,避免估算误差影响报价
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

  // ---- 支撑加价:分段计价 ----
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

  return {
    materialWeight,
    weightFee,
    varnishFee,
    supportFee,
    excessSupportWeight,
    supportFeeBands,
    totalPrice,
    density,
    volumeCM3,
    surfaceAreaCM2,
  };
}
