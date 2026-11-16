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
