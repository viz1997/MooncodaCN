/**
 * 打印服务报价引擎(服务端权威)
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
 * 解析逻辑在 `pricing-settings.ts`(纯函数),连库那一半在
 * `pricing-store.ts`。**这个文件本身不碰 DB** —— 所以它能被单测直接
 * import,`unit` project 里没有数据库也跑得起来。
 *
 * 传进来的 `settings` 是**权威值**:调用方必须显式给,漏了就是类型错误 ——
 * 「忘了传 settings,悄悄按环境变量收钱」这种错不能留。
 */

import { randomBytes } from "node:crypto";

import {
  calculatePrice,
  DEFAULT_CONFIG,
  type PricingConfig,
} from "@/features/pricing/lib/pricing-engine";

import {
  computeDeliveryFeeCents,
  getDeliveryTier,
  normalizeDeliveryTier,
} from "./delivery-tier";
import type { PrintPricingSettings } from "./pricing-settings";
import type {
  PrintQuote,
  PrintQuoteInput,
  PrintSupportFeeBand,
} from "./quote-types";
import { yuanToCentsCeil } from "./rounding";

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
 * @param input    几何 + 支撑 + 交期档位
 */
export function computePrintQuote(
  settings: PrintPricingSettings,
  input: PrintQuoteInput
): PrintQuote | null {
  const config = toPricingConfig(settings);

  const useSupport = settings.supportEnabled;
  // 注意:`config.supportEnabled` 只是为了满足 PricingConfig 的字段要求 ——
  // calculatePrice() 自己不看它。真正的开关在这里:关掉时把支撑克重填 0,
  // 引擎那边自然算不出支撑费。
  const result = calculatePrice(config, {
    volumeCM3: input.volumeCM3,
    surfaceAreaCM2: input.surfaceAreaCM2,
    mode: "upload",
    // solidRatio 只作信息位,calculatePrice() 的公式不用它 ——
    // 上传模式的体积已经是解析出来的实体积,不是包络盒估算
    solidRatio: 100,
    dims: input.dims,
    supportWeight: useSupport ? (input.supportWeightG ?? 0) : 0,
    selfSupportRatio: useSupport ? (input.selfSupportRatio ?? 0) : 0,
  });
  if (!result) return null;

  // 各项先取整再相加:明细加起来必须等于合计,差一分钱都会被用户看出来
  //
  // **向上取整**(2026-11-08 工作室的要求)—— 见 `rounding.ts` 的文件头:
  // 计价一律向上取整到分,少收那一分钱就是真亏损。
  const weightFeeCents = yuanToCentsCeil(result.weightFee);
  const varnishFeeCents = yuanToCentsCeil(result.varnishFee);
  const supportFeeCents = yuanToCentsCeil(result.supportFee);

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
   */
  const supportFeeBands: PrintSupportFeeBand[] = result.supportFeeBands.map(
    (band) => ({
      fromRatio: band.fromRatio,
      upToRatio: band.upToRatio,
      priceCentsPerGram: yuanToCentsCeil(band.price),
      weightG: band.weightG,
      feeCents: yuanToCentsCeil(band.fee),
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
  const baseTotalCents = weightFeeCents + varnishFeeCents + supportFeeCents;
  const deliveryTier = normalizeDeliveryTier(input.deliveryTier);
  const deliveryFeeCents = computeDeliveryFeeCents(
    baseTotalCents,
    deliveryTier,
    settings.deliveryRates
  );

  return {
    materialWeightG: result.materialWeight,
    supportWeightG: input.supportWeightG ?? null,
    volumeCM3: input.volumeCM3,
    surfaceAreaCM2: input.surfaceAreaCM2,
    dims: input.dims,
    density: result.density,
    unitPriceCentsPerGram: settings.unitPriceCentsPerGram,
    weightFeeCents,
    varnishFeeCents,
    supportFeeCents,
    excessSupportWeightG: result.excessSupportWeight,
    supportFeeBands,
    deliveryFeeCents,
    deliveryTier,
    deliveryHours: getDeliveryTier(deliveryTier).hours,
    deliveryRates: settings.deliveryRates,
    totalPriceCents: baseTotalCents + deliveryFeeCents,
  };
}

/**
 * 打印服务**购物车行**的价 —— 服务端权威
 *
 * 打印服务进了商城购物车之后,购物车里的这一行走的是「按克重计价」而不是
 * 目录定价(见 `storefront/lib/print-service.ts`)。购物车每次被读出来都会
 * 重算一遍(跟普通商品行走 `calculatePricing()` 一个道理)—— 定价参数改了之后,
 * 存量购物车带着旧价,直接收就是收错了。
 *
 * ## 折扣:打印服务行**不参与**数量阶梯折扣
 *
 * 阶梯折扣是「买 10 个打九折」—— 打印服务是**来料加工**,一件活一个模型,
 * 数量恒为 1(购物车 UI 里也不给加减)。所以折后单价 = 原价。
 *
 * 保留这个字段是为了让「行合计 = 折后单价 × 数量」这条恒等式对所有行都成立
 * —— 收银台那边 `unit_price_amount × quantity` 收的钱必须跟本仓库
 * 逐分相等(见 `storefront/lib/pricing.ts` 的文件头)。
 *
 * ## 跟工单的价是同一个数
 *
 * 结算时建的那张 `print_order`,`total_price_cents` 也是这个值 —— 同一个
 * `computePrintQuote()` 算出来的,不会漂。
 */
export function computePrintServiceLinePrice(
  settings: PrintPricingSettings,
  input: PrintQuoteInput
): {
  /** 原价(分) */
  unitPriceCents: number;
  /** 折后单价(分)—— 打印服务行恒等于原价 */
  discountedUnitPriceCents: number;
  /** 完整的报价(建工单时用) */
  quote: PrintQuote;
} | null {
  const quote = computePrintQuote(settings, input);
  if (!quote) return null;
  const cents = quote.totalPriceCents;
  return {
    unitPriceCents: cents,
    discountedUnitPriceCents: cents,
    quote,
  };
}

/**
 * 生成业务订单号 —— `PO-20261101-3F7K2A`
 *
 * 格式:前缀 + 日期 + 6 位大写 hex。随机段用 `randomBytes` 而不是
 * `Math.random()` —— 订单号要能挡住「按顺序猜下一个」的枚举。
 */
export function generatePrintOrderNo(now = new Date()): string {
  const ymd = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const rand = randomBytes(3).toString("hex").toUpperCase();
  return `PO-${ymd}-${rand}`;
}
