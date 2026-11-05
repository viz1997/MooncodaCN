/**
 * 支付模块 —— 公开出口
 *
 * ## ⚠️ 这是**服务端**入口
 *
 * 这个 barrel 会连带 `lib/settle.ts`(import `@/db`)和 `lib/registry.ts`
 * (import 各通道的 env)。**客户端组件不要从这儿 import** —— 客户端只需要
 * `lib/types.ts`(纯类型)和 `lib/money.ts`(纯函数),直接从那两个文件引:
 *
 * ```ts
 * import type { PaymentChannelInfo } from "@/features/payments/lib/types";
 * ```
 *
 * ## 模块长什么样
 *
 * ```
 * lib/
 * ├── types.ts       # 通道契约(纯类型,客户端可用)
 * ├── money.ts       # 分 ↔ 元字符串(纯函数,客户端可用)
 * ├── transitions.ts # 状态转移判断(纯函数,可单测)
 * ├── settle.ts      # 落库(要 DB)
 * └── registry.ts    # 通道注册表(要 env)
 *
 * providers/
 * ├── wechat/        # 微信支付 Native
 * ├── alipay/        # 支付宝电脑网站支付
 * └── shopify/       # Shopify 草稿订单(只做卡)
 * ```
 *
 * ## 过渡期
 *
 * 旧的 Sellbase + Stripe 那条路**不在这个模块里** —— 它还住在
 * `src/features/sellbase/`,跑通新的三个通道之后一起拆。
 */

export {
  amountStringToCents,
  centsToAmountString,
} from "./lib/money";
export {
  getPaymentProvider,
  listAvailablePaymentChannels,
  listPaymentChannels,
} from "./lib/registry";
export {
  findOrderByOrderNo,
  type OrderLookup,
  type PaymentAction,
  type SettleResult,
  settleByOrderNo,
  settlePrintOrder,
  settleStorefrontOrder,
} from "./lib/settle";
export {
  decideLinkedPrintOrderTransition,
  decideStorefrontTransition,
  type LinkedPrintOrderDecision,
  type LinkedPrintOrderState,
  type StorefrontOrderState,
  type StorefrontPaymentKind,
  type StorefrontTransitionDecision,
} from "./lib/transitions";
export {
  type OnlinePaymentChannel,
  type PaymentChannel,
  type PaymentChannelInfo,
  PaymentNotConfiguredError,
  type PaymentProvider,
  PaymentProviderError,
  type PaymentRequest,
  type PaymentRequestItem,
  type PaymentSession,
  type PaymentShippingAddress,
} from "./lib/types";
