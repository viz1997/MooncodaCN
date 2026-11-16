/**
 * 报价的**对外投影** —— 单价一个字节都不出去(2026-11-16)
 *
 * 工作室的原话:**「注意模型检测克重报价不要展示 4.5 元/g 这种单价,避免
 * 暴露我们的成本」**。
 *
 * ## 漏在哪儿了
 *
 * 界面本来就没摆单价 —— 工具页、材料参数弹窗、报价弹窗、收据,四处都干净。
 * 漏的是**传输层**:内部那份报价 `PrintQuote` 带着三个成本口径的字段,
 * 它们跟着响应体一路走到浏览器:
 *
 * | 字段 | 是什么 |
 * |---|---|
 * | `unitPriceCentsPerGram` | 每克单价(450 = ¥4.50/g) |
 * | `supportFeeBands[].priceCentsPerGram` | 支撑每一档的单价(¥0.50/g / ¥1.00/g) |
 * | `excessSupportWeightG` | 超出 1:1 阈值的支撑克重(配合上面的单价能反推) |
 *
 * 四条路都带着它们:
 *
 * - `POST /api/print-quote`(报价预览)
 * - `POST /api/print-orders`(建工单)
 * - `GET /api/print-orders/[orderNo]`(工单详情)
 * - 工单详情页的 **RSC 载荷**(服务端组件直接把整份报价传下去)
 *
 * 「查看网页源代码 / DevTools → Network」就能看到 ⇒ **等于把成本表发给了
 * 每一个访客**。
 *
 * ## 修法:边界上投影一次
 *
 * 内部那份报价**一个字都不改** —— 后台要显示单价、留档要记单价、工单要能
 * 对账。只是在**出服务器之前**投影成 `PublicPrintQuote`。
 *
 * - 内部 / 留档:`PrintQuote`(带单价)—— `print_order.unit_price_cents_per_gram`
 * - 对外:`PublicPrintQuote`(没单价)—— 所有 API 响应 + RSC 载荷
 *
 * ## 为什么不直接改 `PrintQuote` 那个类型
 *
 * 因为内部**真的要用**单价(后台定价页要显示「¥4.50/g」,工单对账要拿它
 * 复算)。删字段会让留档那一层没数可用 —— 而「服务端不采信客户端带来的价」
 * 这条口径要求服务端**自己**能重算一遍。
 *
 * ## 投影写成白名单,不是黑名单
 *
 * 下面那个函数**逐个字段列出来** —— 不是 `const { 单价, ...rest } = quote`。
 * 理由:以后有人给 `PrintQuote` 加一个字段,白名单会让 **TypeScript 报错**
 * (新字段不在 `PublicPrintQuote` 里),逼着做决定「这个字段能不能出去」。
 * 黑名单则悄悄就带出去了。
 */

import type {
  PrintQuote,
  PublicPrintQuote,
} from "@/features/print-quote/lib/quote-types";

import {
  type DeliveryRates,
  type DeliveryTierId,
  getDeliveryTier,
} from "./delivery-tier";

/**
 * 内部报价 → 对外报价
 *
 * **白名单** —— 每个字段都显式列出来。新增字段忘了处理,这里就编译不过。
 */
export function toPublicQuote(quote: PrintQuote): PublicPrintQuote {
  return {
    /** 耗材克重 g */
    materialWeightG: quote.materialWeightG,
    /** 支撑克重 g */
    supportWeightG: quote.supportWeightG,
    /** 体积 cm³ */
    volumeCM3: quote.volumeCM3,
    /** 表面积 cm² */
    surfaceAreaCM2: quote.surfaceAreaCM2,
    /** 成品尺寸 mm */
    dims: quote.dims,
    /** 材料密度 g/cm³ */
    density: quote.density,
    /** 克重费(分) */
    weightFeeCents: quote.weightFeeCents,
    /** 后处理费(分) */
    varnishFeeCents: quote.varnishFeeCents,
    /** 支撑加价(分) */
    supportFeeCents: quote.supportFeeCents,
    /** 交期加价(分) */
    deliveryFeeCents: quote.deliveryFeeCents,
    /** 这单选的交期档位 */
    deliveryTier: quote.deliveryTier,
    /** 这档承诺的交期(小时) */
    deliveryHours: quote.deliveryHours,
    /** 三档的加价比例(前端靠它摆交期选择器) */
    deliveryRates: quote.deliveryRates,
    /** 合计(分) */
    totalPriceCents: quote.totalPriceCents,
  };
}

/**
 * **已落库的工单** → 对外报价(2026-11-16)
 *
 * ## 为什么要有它
 *
 * 建单幂等命中时(用户重复提交),**手上没有那份 `PrintQuote` 对象**了 ——
 * 它是上一次请求现算出来的,这次只能从**数据库里那行**把对外报价重建出来。
 *
 * ⇒ 幂等命中那条路返回的响应体,必须跟第一次建单那份**逐字同形** ——
 * 客户端解析的是同一个形状。
 *
 * ## 字段对得上吗 —— 对得上,一行一行核过
 *
 * | 对外字段 | 从哪来 | 一致? |
 * |---|---|---|
 * | `materialWeightG` | `material_weight_g` | ✓ |
 * | `supportWeightG` | `support_weight_g`(可空) | ✓ |
 * | `volumeCM3` / `surfaceAreaCM2` | `volume_cm3` / `surface_area_cm2` | ✓ |
 * | `dims` | `dim_x` / `dim_y` / `dim_z` | ✓ |
 * | `density` | `material_density` | ✓ |
 * | 四项费用 | `weight_fee_cents` / `varnish_fee_cents` / `support_fee_cents` / `delivery_fee_cents` | ✓ |
 * | `deliveryTier` | `delivery_tier` | ✓ |
 * | `deliveryHours` | `getDeliveryTier(tier).hours` | ✓ |
 * | `deliveryRates` | ⚠️ **没落库** —— 调用方给当前生效的那份 | 见下 |
 * | `totalPriceCents` | **四项之和** | ✓ |
 *
 * ## ⚠️ `deliveryRates` 没落库
 *
 * `print_order` 只存了 `delivery_tier` + `delivery_fee_cents`(比例以后会改,
 * 工单上的价不能跟着变)。三档的比例是**当前**的那份 —— 调用方传进来。
 *
 * ⚠️ 它**不参与定价**(加价金额已经算好、落库了)⇒ 只影响前端交期选择器的
 * **预览**。工单的价永远是行里那几个整数分。
 *
 * ## ⚠️ `totalPriceCents` 用**四项之和**,不用 `total_price_cents`
 *
 * `total_price_cents` 存的是**优惠后净额**(减了 `coupon_discount_cents`),
 * 而对外报价的 `totalPriceCents` 是**优惠前**的四项之和 —— 优惠是**订单级**的,
 * 不属于「报价」(见 CLAUDE.md「优惠码」那节)。两个数不是一回事。
 *
 * ⇒ 幂等命中时回 `payableCents = total_price_cents`(优惠后),
 * `quote.totalPriceCents = 四项之和`(优惠前)—— 跟第一次建单那份**完全一致**。
 */
export type StoredPrintOrderQuote = {
  /** 交期档位 */
  deliveryTier: DeliveryTierId;
  /** 体积 cm³(Drizzle 的 `numeric` 列回来是**字符串**) */
  volumeCM3: string | number | null;
  /** 表面积 cm² */
  surfaceAreaCM2: string | number | null;
  /** 成品尺寸 mm —— X */
  dimX: string | number | null;
  /** 成品尺寸 mm —— Y */
  dimY: string | number | null;
  /** 成品尺寸 mm —— Z */
  dimZ: string | number | null;
  /** 耗材克重 g */
  materialWeightG: string | number | null;
  /** 支撑克重 g —— null = 没算支撑 */
  supportWeightG: string | number | null;
  /** 材料密度 g/cm³ */
  materialDensity: string | number | null;
  /** 克重费(分) */
  weightFeeCents: number;
  /** 后处理费(分) */
  varnishFeeCents: number;
  /** 支撑加价(分) */
  supportFeeCents: number;
  /** 交期加价(分) */
  deliveryFeeCents: number;
};

/**
 * 把 `numeric` 列安全地转成数字
 *
 * ⚠️ Drizzle 的 `numeric()` **没有** `mode: "number"` ⇒ 回来的是**字符串**
 * (`"43.333"`)。忘了 `Number(...)` 的话,界面上会显示 `43.333` 之外的东西
 * (字符串拼接 / `toFixed` 报错)。
 */
function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * 已落库的工单 → 对外报价
 *
 * @param row       工单那一行(只用到上面「字段对得上吗」那张表里的列)
 * @param deliveryRates 当前生效的三档加价比例(没落库,调用方给)
 */
export function buildPublicQuoteFromStoredOrder(
  row: StoredPrintOrderQuote,
  deliveryRates: DeliveryRates
): PublicPrintQuote {
  return {
    materialWeightG: toNumber(row.materialWeightG),
    supportWeightG:
      row.supportWeightG === null ? null : toNumber(row.supportWeightG),
    volumeCM3: toNumber(row.volumeCM3),
    surfaceAreaCM2: toNumber(row.surfaceAreaCM2),
    dims: [toNumber(row.dimX), toNumber(row.dimY), toNumber(row.dimZ)],
    density: toNumber(row.materialDensity),
    weightFeeCents: row.weightFeeCents,
    varnishFeeCents: row.varnishFeeCents,
    supportFeeCents: row.supportFeeCents,
    deliveryFeeCents: row.deliveryFeeCents,
    deliveryTier: row.deliveryTier,
    deliveryHours: getDeliveryTier(row.deliveryTier).hours,
    deliveryRates,
    /** 优惠**前**的四项之和 —— 跟 `computePrintQuote` 的算法一致 */
    totalPriceCents:
      row.weightFeeCents +
      row.varnishFeeCents +
      row.supportFeeCents +
      row.deliveryFeeCents,
  };
}
