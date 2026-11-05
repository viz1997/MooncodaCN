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
 * ## 参数可被环境变量覆盖
 *
 * `PRINT_*` 系列。没配就用 `pricing-engine.ts` 里 `DEFAULT_CONFIG` 的值
 * (密度 1.2 g/cm³、单价 $0.65/g、光油 $1.50、支撑 $0.15/g、阈值 1:1)。
 * 改价不用改代码 —— 发版前配好环境变量即可。
 */

import { randomBytes } from "node:crypto";

import {
  calculatePrice,
  DEFAULT_CONFIG,
  type PricingConfig,
} from "@/features/pricing/lib/pricing-engine";

import {
  computeDeliveryFeeCents,
  DEFAULT_DELIVERY_RATES,
  type DeliveryRates,
  getDeliveryTier,
  normalizeDeliveryTier,
} from "./delivery-tier";
import type { PrintQuote, PrintQuoteInput } from "./quote-types";

/**
 * 读一个非负数字环境变量;非法或缺失时用 fallback。
 *
 * 不合法的值静默退回默认值而不是抛错 —— 报价服务挂掉比用错价格更糟,
 * 但「配置写错了」应该被看见,所以这里把 fallback 的来源写清楚。
 */
function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

/**
 * 读一个 0~1 之间的比例环境变量;越界 / 非法时用 fallback。
 *
 * 比例必须夹在 [0, 1] —— 加价超过 100% 是配置写错了(不是「加两倍」),
 * 这种值静默生效会让用户看到离谱的报价,比退回默认值危险。
 */
function envRate(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) return fallback;
  return value;
}

/**
 * 报价参数 —— 单位:克/密度用原单位,金额一律「分」
 *
 * ## 环境变量
 *
 * 全部可选,不配就用 `pricing-engine.ts` 里 `DEFAULT_CONFIG` 的默认值:
 *
 * | 环境变量 | 含义 | 默认 |
 * |---|---|---|
 * | `PRINT_MATERIAL_DENSITY` | 材料密度 g/cm³ | 1.2 |
 * | `PRINT_UNIT_PRICE_CENTS_PER_GRAM` | 单价 分/g | 450(4.5 元/g) |
 * | `PRINT_VARNISH_FEE_CENTS` | 光油 / 后处理固定费 分 | 1000(10 元) |
 * | `PRINT_VARNISH_ENABLED` | 光油是否计入报价(`"false"` 才关) | 计入 |
 * | `PRINT_SUPPORT_PRICE_CENTS_PER_GRAM` | 支撑单价 分/g | 100(1 元/g) |
 * | `PRINT_SUPPORT_THRESHOLD` | 本体支撑比例阈值(1 = 1:1) | 1 |
 * | `PRINT_SUPPORT_ENABLED` | 支撑加价总开关(`"true"` 才开) | 关 |
 * | `PRINT_DELIVERY_EXPRESS_RATE` | 72 小时档加价比例(0~1) | 0.1 |
 * | `PRINT_DELIVERY_URGENT_RATE` | 48 小时档加价比例(0~1) | 0.37 |
 *
 * 注意:本仓库的 `.gitignore` 把 `.env*` 整个排掉了(`.env.example` 也一样),
 * 所以这份说明放在代码里 —— 环境变量的名字跟着代码走,不会因为
 * 「文档在一个没人能看到的文件里」而丢失。
 */
/**
 * 交期档位的加价比例
 *
 * 标准档(96 小时)恒为 0 —— 不额外收费;两档加急的比例可以用环境变量改,
 * 工作室觉得贵就调低,不用改代码发版。
 */
const DELIVERY_RATES: DeliveryRates = {
  standard: 0,
  express: envRate(
    "PRINT_DELIVERY_EXPRESS_RATE",
    DEFAULT_DELIVERY_RATES.express
  ),
  urgent: envRate("PRINT_DELIVERY_URGENT_RATE", DEFAULT_DELIVERY_RATES.urgent),
};

export const PRINT_QUOTE_CONFIG = {
  /** 材料密度 g/cm³ —— `PRINT_MATERIAL_DENSITY` */
  materialDensity: envNumber(
    "PRINT_MATERIAL_DENSITY",
    DEFAULT_CONFIG.materialDensity
  ),
  /** 单价 分/g —— `PRINT_UNIT_PRICE_CENTS_PER_GRAM` */
  unitPriceCentsPerGram: Math.round(
    envNumber("PRINT_UNIT_PRICE_CENTS_PER_GRAM", DEFAULT_CONFIG.unitPrice * 100)
  ),
  /** 光油 / 后处理固定费 分 —— `PRINT_VARNISH_FEE_CENTS` */
  varnishFeeCents: Math.round(
    envNumber("PRINT_VARNISH_FEE_CENTS", DEFAULT_CONFIG.varnishFee * 100)
  ),
  /** 光油是否计入报价 —— `PRINT_VARNISH_ENABLED`(默认计入) */
  varnishEnabled: process.env.PRINT_VARNISH_ENABLED !== "false",
  /** 支撑单价 分/g —— `PRINT_SUPPORT_PRICE_CENTS_PER_GRAM` */
  supportPriceCentsPerGram: Math.round(
    envNumber(
      "PRINT_SUPPORT_PRICE_CENTS_PER_GRAM",
      DEFAULT_CONFIG.supportPrice * 100
    )
  ),
  /** 本体支撑比例阈值(1 = 1:1),超出的部分按支撑单价加收 —— `PRINT_SUPPORT_THRESHOLD` */
  supportThreshold: envNumber(
    "PRINT_SUPPORT_THRESHOLD",
    DEFAULT_CONFIG.supportThreshold
  ),
  /**
   * 支撑加价总开关 —— **默认关**,跟克重工具一致(估算误差大,不该自动加钱)
   *
   * 只有显式 `PRINT_SUPPORT_ENABLED=true` 才开 —— 默认开的话,每一单都会
   * 悄悄多收一笔支撑费,而克重工具那边从不收这个钱,两边对不上。
   */
  supportEnabled: process.env.PRINT_SUPPORT_ENABLED === "true",
  /** 交期档位加价比例 —— `PRINT_DELIVERY_EXPRESS_RATE` / `PRINT_DELIVERY_URGENT_RATE` */
  deliveryRates: DELIVERY_RATES,
} as const;

/**
 * 按几何算报价。
 *
 * 返回 `null` 表示这组输入算不出来(体积非正 / 密度非法)—— 调用方要把它
 * 当成「还没报价」处理,而不是「报价是 0」。
 */
export function computePrintQuote(input: PrintQuoteInput): PrintQuote | null {
  const config: PricingConfig = {
    ...DEFAULT_CONFIG,
    materialDensity: PRINT_QUOTE_CONFIG.materialDensity,
    unitPrice: PRINT_QUOTE_CONFIG.unitPriceCentsPerGram / 100,
    varnishFee: PRINT_QUOTE_CONFIG.varnishFeeCents / 100,
    varnishEnabled: PRINT_QUOTE_CONFIG.varnishEnabled,
    supportPrice: PRINT_QUOTE_CONFIG.supportPriceCentsPerGram / 100,
    supportThreshold: PRINT_QUOTE_CONFIG.supportThreshold,
    supportEnabled: PRINT_QUOTE_CONFIG.supportEnabled,
  };

  const useSupport = PRINT_QUOTE_CONFIG.supportEnabled;
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
  const weightFeeCents = Math.round(result.weightFee * 100);
  const varnishFeeCents = Math.round(result.varnishFee * 100);
  const supportFeeCents = Math.round(result.supportFee * 100);

  // 交期加价 —— 按**小计**的比例收(见 delivery-tier.ts)。
  // 基数是三项基础费用之和,不是总价:加价不能把自己算进自己的基数。
  const baseTotalCents = weightFeeCents + varnishFeeCents + supportFeeCents;
  const deliveryTier = normalizeDeliveryTier(input.deliveryTier);
  const deliveryFeeCents = computeDeliveryFeeCents(
    baseTotalCents,
    deliveryTier,
    PRINT_QUOTE_CONFIG.deliveryRates
  );

  return {
    materialWeightG: result.materialWeight,
    supportWeightG: input.supportWeightG ?? null,
    volumeCM3: input.volumeCM3,
    surfaceAreaCM2: input.surfaceAreaCM2,
    dims: input.dims,
    density: result.density,
    unitPriceCentsPerGram: PRINT_QUOTE_CONFIG.unitPriceCentsPerGram,
    weightFeeCents,
    varnishFeeCents,
    supportFeeCents,
    excessSupportWeightG: result.excessSupportWeight,
    deliveryFeeCents,
    deliveryTier,
    deliveryHours: getDeliveryTier(deliveryTier).hours,
    deliveryRates: PRINT_QUOTE_CONFIG.deliveryRates,
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
 * —— Sellbase 那边 `unit_price_amount × quantity` 收的钱必须跟本仓库
 * 逐分相等(见 `storefront/lib/pricing.ts` 的文件头)。
 *
 * ## 跟工单的价是同一个数
 *
 * 结算时建的那张 `print_order`,`total_price_cents` 也是这个值 —— 同一个
 * `computePrintQuote()` 算出来的,不会漂。
 */
export function computePrintServiceLinePrice(input: PrintQuoteInput): {
  /** 原价(分) */
  unitPriceCents: number;
  /** 折后单价(分)—— 打印服务行恒等于原价 */
  discountedUnitPriceCents: number;
  /** 完整的报价(建工单时用) */
  quote: PrintQuote;
} | null {
  const quote = computePrintQuote(input);
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
