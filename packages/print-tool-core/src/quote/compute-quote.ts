/**
 * 打印服务报价引擎(**服务端权威**那一层)
 *
 * ## 为什么报价必须服务端算
 *
 * 报价页在浏览器里算过一次(用户改尺寸时要实时看到价格变),但**入库的价格
 * 必须是服务端重算的** —— 客户端传来的总价一律不信。理由跟商城购物车一样
 * (`cart-store.ts` 每次加购都重算 `calculatePricing()`):客户端能被改。
 *
 * ## 公式跟克重工具是同一套
 *
 * 这里直接复用 `pricing-engine.ts` 的 `calculatePrice()`,不另写一份 ——
 * 两处公式各写一遍,迟早会漂移(改了单价忘了改报价页,或者反过来)。
 *
 * 唯一的差别是单位:引擎内部用「元」,这里对外一律「分」。转换只发生在
 * 两个边界上(元 → 分),中间不碰。
 *
 * ## 取整口径:**向上取整**(2026-11-08)
 *
 * 元 → 分那一刀**一律向上取整**(`rounding.ts`)。交期加价也是 —— 那是用户
 * 付的钱,同样向上(见 `delivery-tier.ts`)。工作室的原话:「计价需要向上
 * 取整」。
 *
 * ## 件数与运费(2026-11-17)
 *
 * 「同一模型打印多件」之后,这份报价是**整单**的:
 *
 * ```
 * 克重费 × N + 后处理费 × N + 支撑加价 × N + 交期加价(按整单小计的比例)+ 运费(不乘 N)
 * ```
 *
 * - **件数放大在「元」上做,取整还是只做一次** —— 见 `quantity.ts` 的文件头
 * - **运费按单收** —— 工作室原话「运费按单收取」
 * - **交期加价不用改公式** —— 它是整单小计的比例,小计变大它自动变大
 *
 * ## 价格从哪儿来(2026-11-06)
 *
 * 以前是这个文件里的 `PRINT_QUOTE_CONFIG` —— 模块级常量,导入时读一次
 * `PRINT_*` 环境变量。现在配置搬到后台(`/admin/print-pricing`),这一层
 * 变成**入参**:
 *
 * ```
 * DB 配置行 → PRINT_* 环境变量 → DEFAULT_CONFIG
 * ```
 *
 * 解析逻辑在 `pricing-settings.ts`(纯函数),连库那一半在应用侧的
 * `pricing-store.ts`。**这个文件本身不碰 DB** —— 所以它能被单测直接
 * import,`unit` project 里没有数据库也跑得起来。
 *
 * 传进来的 `settings` 是**权威值**:调用方必须显式给,漏了就是类型错误 ——
 * 「忘了传 settings,悄悄按环境变量收钱」这种错不能留。
 */

import {
  calculatePrice,
  DEFAULT_CONFIG,
  type PricingConfig,
} from "../pricing/pricing-engine";
import {
  computeDeliveryFeeCents,
  getDeliveryTier,
  normalizeDeliveryTier,
} from "./delivery-tier";
import type { PrintPricingSettings } from "./pricing-settings";
import { normalizeQuantity, scaleYuanToCentsCeil } from "./quantity";
import { yuanToCentsCeil } from "./rounding";
import {
  computeShippingFeeCents,
  normalizeShippingOption,
} from "./shipping-option";
import type { PrintQuote, PrintQuoteInput, PrintSupportFeeBand } from "./types";

/**
 * 把「生效设置」翻译成引擎认识的 `PricingConfig`
 *
 * 引擎内部用**元**,设置里用**分** —— 转换只发生在这里一次。
 */
function toPricingConfig(settings: PrintPricingSettings): PricingConfig {
  return {
    ...DEFAULT_CONFIG,
    materialDensity: settings.modelDensity,
    unitPrice: settings.unitPriceCentsPerGram / 100,
    varnishFee: settings.varnishFeeCents / 100,
    varnishEnabled: settings.varnishEnabled,
    supportTier1Ratio: settings.supportTier1Ratio,
    supportTier1Price: settings.supportTier1PriceCentsPerGram / 100,
    supportTier2Price: settings.supportTier2PriceCentsPerGram / 100,
    supportThreshold: settings.supportThreshold,
    supportEnabled: settings.supportEnabled,
  };
}

/**
 * 按几何算报价。
 *
 * 返回 `null` 表示这组输入算不出来(体积非正 / 密度非法)—— 调用方要把它
 * 当成「还没报价」处理,而不是「报价是 0」。
 *
 * @param settings 生效中的定价设置(后台配的,或兜底的 env / 默认值)
 * @param input    几何 + 支撑 + 交期档位 + 件数 + 配送方式
 */
export function computePrintQuote(
  settings: PrintPricingSettings,
  input: PrintQuoteInput
): PrintQuote | null {
  const config = toPricingConfig(settings);

  // 件数(2026-11-17)—— 「同一模型打印多件」
  //
  // 引擎这一层是**兜底**:认不出来 / 越界 ⇒ 落到 1。**接口层用 zod 拒绝
  // 越界**(返 400),不能指望这一层 —— 夹取会静默少收钱。
  const quantity = normalizeQuantity(input.quantity);

  // 配送方式(2026-11-17)—— 认不出来 ⇒ 顺丰到付(¥0)
  const shippingOption = normalizeShippingOption(input.shippingOption);

  const useSupport = settings.supportEnabled;
  // 注意:`config.supportEnabled` 只是为了满足 PricingConfig 的字段要求 ——
  // calculatePrice() 自己不看它。真正的开关在这里:关掉时把支撑克重填 0,
  // 引擎那边自然算不出支撑费。
  const result = calculatePrice(config, {
    volumeCM3: input.volumeCM3,
    surfaceAreaCM2: input.surfaceAreaCM2,
    supportWeight: useSupport ? (input.supportWeightG ?? 0) : 0,
    selfSupportRatio: useSupport ? (input.selfSupportRatio ?? 0) : 0,
  });
  if (!result) return null;

  // 各项先取整再相加:明细加起来必须等于合计,差一分钱都会被用户看出来
  //
  // **向上取整**(2026-11-08 工作室的要求)—— 见 `rounding.ts` 的文件头:
  // 计价一律向上取整到分,少收那一分钱就是真亏损。
  //
  // ⚠️ **件数是在「元」上乘的,取整还是只做一次**(见 `quantity.ts` 的文件头):
  // `ceil(单件 × N × 100)`,不是 `ceil(单件 × 100) × N` —— 后者把每一件
  // 的取整误差累积起来,系统性少收钱。
  const weightFeeCents = scaleYuanToCentsCeil(result.weightFee, quantity);
  const varnishFeeCents = scaleYuanToCentsCeil(result.varnishFee, quantity);
  const supportFeeCents = scaleYuanToCentsCeil(result.supportFee, quantity);

  /**
   * 支撑加价的分段明细 —— 换到「分」
   *
   * 引擎那边算的是「元」(浮点),这里换成分。**各档之和必须等于
   * `supportFeeCents`** —— 否则打印单上会出现「8.3 g × ¥0.50/g + 4.2 g ×
   * ¥1.00/g」跟「支撑加价 ¥6.60」对不上(明细加起来 ≠ 合计)。
   *
   * **向上取整之后,各档加起来 ≥ 总额**(每一档都往上走了,加起来只会多)。
   * 多出来的那一两分**从最后一档开始往下扣**,扣到 0 就不扣了 —— 不会出现
   * 负数的一档。
   *
   * ⚠️ 放大件数之后这条不变式**依然成立**:`Σceil(N·bᵢ) ≥ ceil(N·Σbᵢ)`
   * (左边是整数且 ≥ N·Σbᵢ,右边是 ≥ N·Σbᵢ 的最小整数)⇒ 差额永远 ≤ 0
   * ⇒ 下面那个「从最后一档往下扣」的循环永远够扣。
   */
  const supportFeeBands: PrintSupportFeeBand[] = result.supportFeeBands.map(
    (band) => ({
      fromRatio: band.fromRatio,
      upToRatio: band.upToRatio,
      // 单价**不乘件数** —— 单价是「每克多少钱」,跟印几件无关
      priceCentsPerGram: yuanToCentsCeil(band.price),
      weightG: band.weightG * quantity,
      feeCents: scaleYuanToCentsCeil(band.fee, quantity),
    })
  );
  const sumOfBands = supportFeeBands.reduce(
    (sum, band) => sum + band.feeCents,
    0
  );
  let residual = supportFeeCents - sumOfBands;
  for (let i = supportFeeBands.length - 1; i >= 0 && residual < 0; i -= 1) {
    const band = supportFeeBands[i];
    if (!band) continue;
    const take = Math.min(band.feeCents, -residual);
    band.feeCents -= take;
    residual += take;
  }

  // 交期加价 —— 按**小计**的比例收(见 delivery-tier.ts)。
  // 基数是三项基础费用之和,不是总价:加价不能把自己算进自己的基数。
  //
  // ⚠️ 小计是**整单**的 ⇒ 印 N 件时加急费自动变大(比例 × 整单小计)。
  const baseTotalCents = weightFeeCents + varnishFeeCents + supportFeeCents;
  const deliveryTier = normalizeDeliveryTier(input.deliveryTier);
  const deliveryFeeCents = computeDeliveryFeeCents(
    baseTotalCents,
    deliveryTier,
    settings.deliveryRates
  );

  // 运费(2026-11-17)—— **按单收**,不乘件数(工作室原话「运费按单收取」)
  //
  // 费用来自服务端 settings(后台配的),客户端只能传档位 id ⇒ 篡改不了。
  const shippingFeeCents = computeShippingFeeCents(
    shippingOption,
    settings.shippingFees
  );

  return {
    quantity,
    materialWeightG: result.materialWeight * quantity,
    supportWeightG:
      input.supportWeightG === null || input.supportWeightG === undefined
        ? null
        : input.supportWeightG * quantity,
    volumeCM3: input.volumeCM3,
    surfaceAreaCM2: input.surfaceAreaCM2,
    dims: input.dims,
    density: result.density,
    unitPriceCentsPerGram: settings.unitPriceCentsPerGram,
    weightFeeCents,
    varnishFeeCents,
    supportFeeCents,
    excessSupportWeightG: result.excessSupportWeight * quantity,
    supportFeeBands,
    deliveryFeeCents,
    deliveryTier,
    deliveryHours: getDeliveryTier(deliveryTier).hours,
    deliveryRates: settings.deliveryRates,
    shippingOption,
    shippingFeeCents,
    shippingFees: settings.shippingFees,
    totalPriceCents: baseTotalCents + deliveryFeeCents + shippingFeeCents,
  };
}
