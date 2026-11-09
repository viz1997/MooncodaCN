/**
 * 打印服务报价 —— 共享类型
 *
 * 客户端(报价页)和服务端(报价 API / 下单 API)共用这一份定义,避免两边
 * 字段名对不上导致「页面显示的价」和「入库的价」不是同一个东西。
 *
 * ## 金额单位:一律「分」
 *
 * 跟 `product.basePriceCents` / `product_variant.priceCents` 保持一致。
 * 报价页要显示金额,下单要落库,两边都拿分,不用在边界上做单位换算。
 *
 * ## 形状/尺寸单位
 *
 *  - 体积 cm³
 *  - 表面积 cm²
 *  - 尺寸 mm(X=长 Y=宽 Z=高)
 *  - 克重 g
 */

import type { DeliveryRates, DeliveryTierId } from "./delivery-tier";

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

/**
 * 报价入参 —— 几何 + 支撑信息
 *
 * 几何是**客户端解析 + 用户尺寸调整之后**的结果(体积已经含缩放),
 * 服务端不重新解析模型,只按这组数算价。
 */
export type PrintQuoteInput = {
  /** 体积 cm³ */
  volumeCM3: number;
  /** 表面积 cm² */
  surfaceAreaCM2: number;
  /** 成品尺寸 mm:X=长 Y=宽 Z=高 */
  dims: [number, number, number];
  /** 智能摆盘算出的支撑克重 g;没跑摆盘是 null */
  supportWeightG?: number | null;
  /** 本体支撑比例(1 = 1:1);没跑摆盘是 null */
  selfSupportRatio?: number | null;
  /**
   * 交期档位(48 / 72 / 96 小时)—— 不传 = 标准档(不额外收费)
   *
   * 加价按**比例**收,比例见 `delivery-tier.ts`。
   */
  deliveryTier?: DeliveryTierId | null;
};

/**
 * 支撑加价的**一档**(2026-11-06)
 *
 * 工作室的规则:「模型支撑超过 1:1 的多的支撑按照 0.5 元一克,1:2 的多的
 * 支撑按照 1 元一克」。也就是超阈值的那部分**分两段**收:
 *
 * ```
 * r ≤ 1         不收钱
 * 1 < r ≤ 2     超出部分 × 第一档单价(0.5 元/g)
 * r > 2         再超出部分 × 第二档单价(1 元/g)
 * ```
 *
 * `r` = 本体支撑比例 = 支撑克重 ÷ 耗材克重。
 *
 * ## 单位:**分**
 *
 * 跟 `PrintQuote` 的其余金额字段一致 —— 引擎内部用「元」,转换只发生在
 * 这一层(`quote-server.ts` 的 `computePrintQuote()`)。
 */
export type PrintSupportFeeBand = {
  /** 这一档的**下**界(比例)—— 第一档是阈值,后面是上一档的上界 */
  fromRatio: number;
  /** 这一档的**上**界(比例)—— 最后一档是 null(没有上限) */
  upToRatio: number | null;
  /** 这一档的单价 分/g */
  priceCentsPerGram: number;
  /** 这一档收钱的支撑克重 g */
  weightG: number;
  /** 这一档的钱 分 */
  feeCents: number;
};

/**
 * 报价结果
 *
 * `totalPriceCents` 恒等于四项费用之和(各自取整后再加),不是先加后取整 ——
 * 报价页上「明细加起来 = 合计」必须成立,否则用户会来问为什么差一块。
 */
export type PrintQuote = {
  /** 耗材克重 g */
  materialWeightG: number;
  /** 支撑克重 g(没跑摆盘是 null) */
  supportWeightG: number | null;
  volumeCM3: number;
  surfaceAreaCM2: number;
  dims: [number, number, number];
  /** 材料密度 g/cm³ */
  density: number;
  /** 单价 分/g */
  unitPriceCentsPerGram: number;
  /** 克重费(分)= 克重 × 单价 */
  weightFeeCents: number;
  /** 光油 / 后处理固定费(分) */
  varnishFeeCents: number;
  /** 支撑加价(分)—— 本体支撑比例超 1:1 的部分 */
  supportFeeCents: number;
  /** 超出 1:1 阈值的支撑克重 g */
  excessSupportWeightG: number;
  /**
   * 支撑加价的**分段明细**(2026-11-06)
   *
   * 工作室的规则是分段的(1:1~1:2 一档,超 1:2 另一档),所以一笔支撑费
   * 不是一个数 —— 得能说清「哪一段按哪个价收的」。
   *
   * **各档 `feeCents` 之和恒等于 `supportFeeCents`** —— 明细加起来必须
   * 等于合计(取整的差额由最后一档吸收),否则用户会看到「8.3 g × ¥0.50/g
   * + 4.2 g × ¥1.00/g」跟「支撑加价 ¥6.60」对不上。
   *
   * 支撑加价关掉时是空数组(不是 null)—— 界面直接 `.map()` 就行。
   */
  supportFeeBands: PrintSupportFeeBand[];
  /**
   * 交期加价(分)—— 按小计的**比例**收(见 `delivery-tier.ts`)
   *
   * 标准档是 0;加价只跟「多快发货」有关,跟模型本身无关。
   */
  deliveryFeeCents: number;
  /** 这单选的交期档位 */
  deliveryTier: DeliveryTierId;
  /** 这档承诺的交期(小时) */
  deliveryHours: number;
  /**
   * 本次报价用的加价比例 —— 服务端带回来的
   *
   * 前端拿它把**三档**的价都显示出来(「48 小时 +¥20.65」)。前端不自己认
   * 一份比例:服务端的比例可以用环境变量改,两边各认一份就会出现「页面写
   * +$3.00、实际收 $2.98」。
   */
  deliveryRates: DeliveryRates;
  /** 合计(分) */
  totalPriceCents: number;
};

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
  /** 服务端重算后的报价(客户端显示的是这个,不是自己算的) */
  quote: PrintQuote;
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
  /** 单价 分/g */
  unitPriceCentsPerGram: number;
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
