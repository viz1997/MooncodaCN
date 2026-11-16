/**
 * 打印服务 —— **工单侧**的类型
 *
 * ## 这一份现在只装「工单」的东西
 *
 * 引擎侧的类型(`PrintQuoteInput` / `PrintQuote` / `PublicPrintQuote` /
 * `PrintSupportFeeBand`)搬进了 `@mooncoda/print-tool-core/quote/types` ——
 * 那是**可复用的纯计算**。这里**再导出一次**,是为了**已有 import 一个字
 * 都不用改**。
 *
 * 留在这里的都是**绑着数据库 / 业务流程**的类型:工单状态、收款状态、
 * 收款通道、下单入参、用户侧视图、工单时间线。
 *
 * ⚠️ **「用 server」文件不许再导出类型** —— 这里不是那种文件(没有
 * `"use server"`),`export type` 是类型导出、编译期就抹掉了,不会变成
 * 一个不存在的 server action。
 */

import type { DeliveryTierId } from "@mooncoda/print-tool-core/quote/delivery-tier";
import type { ShippingOptionId } from "@mooncoda/print-tool-core/quote/shipping-option";
import type {
  PrintQuoteInput,
  PublicPrintQuote,
} from "@mooncoda/print-tool-core/quote/types";
import type { ShippingAddressSnapshot } from "@/db/schema";

/**
 * 引擎侧的类型 —— **再导出一次**
 *
 * 已有代码从 `@/features/print-quote/lib/quote-types` 拿这些类型,那就不用
 * 改 import。新的代码**直接从 `@mooncoda/print-tool-core/quote` 拿**。
 */
export type {
  PrintQuote,
  PrintQuoteInput,
  PrintSupportFeeBand,
  PublicPrintQuote,
} from "@mooncoda/print-tool-core/quote/types";

/** 订单状态 —— 与 `print_order_status` enum 一一对应 */
export type PrintOrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "IN_PRODUCTION"
  | "SHIPPED"
  | "COMPLETED"
  | "CANCELLED";

export const PRINT_ORDER_STATUSES: readonly PrintOrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "SHIPPED",
  "COMPLETED",
  "CANCELLED",
];

/**
 * 收款状态 —— 与 `print_order.payment_status` 列的枚举一一对应
 *
 * 跟工单状态是**两回事**:工单状态说「做到哪一步」,收款状态说「钱到没到」。
 * 两者独立推进 —— 用户付了钱但工作室还没确认,那是
 * `paymentStatus="paid"` + `status="PENDING"`。
 */
export type PrintOrderPaymentStatus = "unpaid" | "paid" | "refunded" | "failed";

export const PRINT_ORDER_PAYMENT_STATUSES: readonly PrintOrderPaymentStatus[] =
  ["unpaid", "paid", "refunded", "failed"];

/**
 * 收款渠道 —— 与 `print_order.payment_channel` 列的枚举一一对应
 *
 * - `wechat` / `alipay` / `shopify` —— 新的三个线上通道(2026-11-05)
 * - `stripe` —— 旧路:Sellbase + Stripe(过渡期并行,跑通新通道后拆)
 * - `offline` —— 线下转账,工作室后台手动标
 */
export type PrintOrderPaymentChannel =
  | "wechat"
  | "alipay"
  | "shopify"
  | "stripe"
  | "offline";

/** 下单入参 */
export type PrintOrderRequest = {
  /** 几何 + 支撑信息 —— 服务端按这组数**重新算价**,不信客户端传来的总价 */
  quote: PrintQuoteInput;
  /** 模型文件名(用户上传时的原名) */
  modelFileName: string;
  /** 模型文件在 R2 上的对象键(由 `/api/print-orders/upload-url` 签发) */
  objectKey: string;
  /** 模型文件在 R2 上的永久 URL */
  modelUrl: string;
  /** 模型文件字节数 */
  modelSizeBytes: number | null;
  contactName: string;
  contactPhone: string | null;
  /** 用户留言(材质、颜色、特殊要求…) */
  note: string | null;
};

/**
 * 下单结果
 *
 * 2026-11-01:不再有 `token` —— 订单挂在账号名下,登录后按 userId 查,
 * 不需要「订单号 + 令牌」那套匿名查询机制了。
 */
export type PrintOrderCreated = {
  orderNo: string;
  /**
   * 服务端重算后的报价(客户端显示的是这个,不是自己算的)
   *
   * **对外形状** —— 没有单价(见 `PublicPrintQuote`)。
   */
  quote: PublicPrintQuote;
  /**
   * 优惠码(2026-11-08)—— null = 没用券
   */
  couponCode: string | null;
  /** 这一单优惠了多少(分)—— 0 = 没用券 */
  couponDiscountCents: number;
  /**
   * 应付净额(分)—— 收银台按这个数收
   *
   * = `quote.totalPriceCents − couponDiscountCents`。
   */
  payableCents: number;
  createdAt: string;
  /** 建单时的 updatedAt —— 乐观插入的那一行要带上,轮询才认得出它 */
  updatedAt: string;
  /** 这单的邮件通知语言 */
  locale: PrintOrderLocale;
  /**
   * 支付链接(2026-11-04)
   *
   * null = 线上收款没配好(通道没配 / 目录没同步 / 上游没连上)。
   * 工单**照样建好了** —— 用户可以在详情页点「去支付」重试,或者走线下。
   */
  paymentUrl: string | null;
  /**
   * 微信扫码用的二维码内容(2026-11-05)
   *
   * 微信 Native 是扫码不是跳转 —— 前端拿这个渲染二维码。
   * 其他通道是 null。
   */
  paymentQrCodeUrl: string | null;
  /**
   * 收款通道(2026-11-05)
   *
   * null = 支付会话没建出来(通道没配好,或者这次调用挂了)。
   */
  paymentChannel: PrintOrderPaymentChannel | null;
  /** 收款状态 —— 建单那一刻一定是 `unpaid` */
  paymentStatus: PrintOrderPaymentStatus;
};

/**
 * 用户侧看到的订单 —— 「我的打印订单」列表里的一行
 *
 * 只暴露用户自己该看到的字段:不含内部 id、不含模型 URL(那是工作室取件用的)。
 */
export type UserPrintOrder = {
  orderNo: string;
  status: PrintOrderStatus;
  modelFileName: string;
  /**
   * 打印件数(2026-11-17)
   *
   * 工作室的原话:「同一模型打印多件」—— 克重和钱都是**整单**的(已经乘过件数),
   * 运费不乘(「运费按单收取」)。
   */
  quantity: number;
  /**
   * 配送方式(2026-11-17)
   *
   * 顺丰到付 / 顺丰标快 / 顺丰空运。⚠️ **跟 `deliveryTier`(交期档位)是两个
   * 正交的轴**。
   */
  shippingOption: ShippingOptionId;
  /** 运费(分)—— 按单收 */
  shippingFeeCents: number;
  materialWeightG: number;
  supportWeightG: number | null;
  dims: [number, number, number];
  /**
   * 应付总额(分)
   *
   * **2026-11-08:这一列现在是「优惠后」的净额** —— 用了券的话
   * `totalPriceCents = 报价合计 − 优惠`。要收多少钱就只有这一列,列表 /
   * 详情 / 邮件都读它,不会读到「折前总额」那种对不上的数。
   */
  totalPriceCents: number;
  /**
   * 优惠码(2026-11-08)—— null = 没用券
   */
  couponCode: string | null;
  /** 这一单优惠了多少(分)—— 0 = 没用券 */
  couponDiscountCents: number;
  createdAt: string;
  /**
   * 最后一次变更时间
   *
   * 轮询的变更检测靠它:状态变了 `updatedAt` 一定跟着变(改状态时一起更新)。
   * 没有它的话,「状态没变但别的东西变了」和「什么都没变」分不开。
   */
  updatedAt: string;
  /**
   * 收款状态(2026-11-04)
   *
   * 跟工单状态是**两回事**:工单状态说的是「做到哪一步了」,收款状态说的是
   * 「钱到没到」。两者独立推进 —— 用户付了钱但工作室还没确认,那是
   * `payment_status=paid` + `status=PENDING`。
   */
  paymentStatus: PrintOrderPaymentStatus;
  /**
   * 支付链接(2026-11-04)
   *
   * null = 没有可用的线上支付链接(没配 Sellbase,或者还没生成)。
   */
  paymentUrl: string | null;
  /**
   * 微信扫码用的二维码内容(2026-11-05)
   *
   * 微信 Native 的付款方式不是跳转,是**扫码** —— 二维码的内容就是这一条
   * (`weixin://wxpay/bizpayurl?pr=…`)。前端拿它渲染二维码。
   *
   * 支付宝 / Shopify 那两条路这个字段是 null —— 它们是跳转,不是扫码。
   */
  paymentQrCodeUrl: string | null;
  /**
   * 收款通道(2026-11-05)
   *
   * null = 还没开始收款(刚建单,支付会话还没建出来)。
   */
  paymentChannel: PrintOrderPaymentChannel | null;
  /**
   * 这一单是不是**跟着商城订单**结的账(2026-11-08)
   *
   * 打印服务并进商城购物袋之后,打印服务行是购物袋里的一行,工单是跟着
   * 商城订单建的 —— 钱由**商城订单**收(整张车一次付款),工单自己不建
   * 支付会话。
   *
   * 界面上据此**不给「去支付」**:给了就等于让用户付两次(工单一次、商城
   * 订单一次)。要付去「我的订单」付那一张。
   *
   * 摆成布尔值而不是内部 id —— 内部 id 不该出到浏览器。
   */
  viaStorefrontOrder: boolean;
};

/**
 * 用户侧看到的订单详情 —— 工单详情页用
 *
 * 比列表多的是报价明细和联系方式。仍然**不含模型 URL**:那是工作室取件用的,
 * 用户自己不需要看那条直链。
 */
export type UserPrintOrderDetail = UserPrintOrder & {
  modelSizeBytes: number | null;
  volumeCM3: number;
  surfaceAreaCM2: number;
  /** 材料密度 g/cm³(留档值) */
  materialDensity: number;
  /**
   * ⚠️ **这里没有单价字段** —— 单价是工作室的成本口径,不出浏览器。
   *
   * (2026-11-16:以前这里有 `unitPriceCentsPerGram`,RSC 载荷里带着它 ⇒
   * 「查看网页源代码」就能看到 ¥4.50/g。删掉了。)
   */
  /** 克重费(分) */
  weightFeeCents: number;
  /** 后处理(分) */
  varnishFeeCents: number;
  /** 支撑加价(分) */
  supportFeeCents: number;
  /** 交期加价(分) */
  deliveryFeeCents: number;
  /** 下单时选的交期档位 */
  deliveryTier: DeliveryTierId;
  /** 这档承诺的交期(小时) */
  deliveryHours: number;
  contactName: string;
  contactEmail: string;
  contactPhone: string | null;
  /**
   * 收货地址快照 —— 落库了但买家侧一直没渲染过
   *
   * 地址是**下单那一刻的事实**:用户后来改地址簿,历史工单的收货地址不该
   * 跟着变(活已经按老地址开工了)。所以订单存快照,不走地址簿。
   *
   * 老单可能没有这一列(下单时没填地址)—— 那时是 `null`,界面摆「—」。
   */
  shippingAddress: ShippingAddressSnapshot | null;
  /** 用户留言 */
  note: string | null;
  /** 这单的邮件通知语言 */
  locale: PrintOrderLocale;
};

/**
 * 工单事件的操作者 —— 与 `print_order_event_actor` enum 一一对应
 */
export type PrintOrderEventActor = "user" | "admin" | "system";

/**
 * 工单时间线上的一条事件
 *
 * 系统句子不落库:「工作室把工单从待确认改成了已确认」由前端按
 * (actor, from, to) 用 i18n 现场渲染,库里只存人工写的 note。
 */
export type PrintOrderEventView = {
  id: string;
  /** 原状态;创建事件为 null */
  fromStatus: PrintOrderStatus | null;
  toStatus: PrintOrderStatus;
  actor: PrintOrderEventActor;
  /** 人工备注;回退时必填 */
  note: string | null;
  createdAt: string;
};

/**
 * 工单语言 —— 决定这单的邮件通知用中文还是英文
 *
 * 只有两个值(站点的两个 locale)。落库而不是取「当前请求的 locale」:
 * 改状态的邮件是工作室触发的,那时请求 locale 是 admin 的语言,不是
 * 下单用户的语言。
 */
export type PrintOrderLocale = "zh" | "en";

/** 站点支持的 locale 里,打印服务认的这两个 */
export const PRINT_ORDER_LOCALES: readonly PrintOrderLocale[] = ["zh", "en"];

/** 默认工单语言(站点默认 locale 就是 zh) */
export const DEFAULT_PRINT_ORDER_LOCALE: PrintOrderLocale = "zh";

/**
 * 把任意字符串收敛成合法的工单语言
 *
 * 用户下单时传的 locale 只认这两个,别的(比如 "zh-CN")落到默认。
 */
export function normalizePrintOrderLocale(
  locale: string | null | undefined
): PrintOrderLocale {
  return locale === "en" ? "en" : DEFAULT_PRINT_ORDER_LOCALE;
}
