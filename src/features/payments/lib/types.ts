/**
 * 支付通道的**契约**
 *
 * ## 为什么要抽象一层
 *
 * 2026-11-05 之前只有一条收款路:Sellbase 建单 → Stripe 付款页。工作室决定
 * 改成「微信 / 支付宝 / Shopify 三个通道」,于是结算、订单状态、webhook
 * 都要跟「具体是哪家收钱」解耦。
 *
 * 这一层定的是**通道之间共通的那部分**:
 *
 * - **本仓库算价** —— 折后单价、运费、合计都是本仓库算的,支付通道只负责
 *   「把这笔钱收上来」。通道**不参与定价**。
 * - **一次支付会话** —— 建单成功后拿到的东西:要么是「跳过去的地址」
 *   (支付宝 / Shopify),要么是「扫的二维码」(微信 Native)。
 * - **一次收款确认** —— 通道说「这单收��了」,本仓库把订单标成已付。
 *
 * ## 通道清单
 *
 * | 通道 | 收钱方式 | 付款页 |
 * |---|---|---|
 * | `wechat` | 微信支付 Native(扫码) | 本仓库渲染二维码 |
 * | `alipay` | 支付宝电脑网站支付 | 跳支付宝 |
 * | `shopify` | Shopify 草稿订单 | 跳 Shopify 的付款页 |
 * | `stripe` | 旧路:Sellbase + Stripe(**过渡期并行**,跑通后拆) | 跳 Stripe |
 * | `offline` | 线下转账 | 没有 —— 工作室后台手动标 |
 *
 * `offline` 不是「线上通道」—— 它没有支付会话,走的是后台「标记已收款」。
 */

/**
 * 收款通道
 *
 * `stripe` 是过渡期保留的旧通道(Sellbase + Stripe),跟新的三个并存。
 * 拆 Sellbase 的时候把它从枚举里删掉。
 */
export type PaymentChannel =
  | "wechat"
  | "alipay"
  | "shopify"
  | "stripe"
  | "offline";

/**
 * **线上**通道 —— 能自己建支付会话的那些
 *
 * `offline` 不算:线下收款没有会话,工作室后台点一下就完事。
 */
export type OnlinePaymentChannel = Exclude<PaymentChannel, "offline">;

/* -------------------------------------------------------------------------- */
/*  支付请求                                                                   */
/* -------------------------------------------------------------------------- */

/** 一次支付请求里的一行 */
export interface PaymentRequestItem {
  /** 行标题(用户在付款页上看到的名字) */
  title: string;
  /** 数量 */
  quantity: number;
  /**
   * **折后**单价(分)
   *
   * 「先折单价,再乘数量」的口径 —— 阶梯折扣在这一层就已经折过了。通道拿到的
   * 就是最终价,不参与定价。
   */
  unitPriceCents: number;
  /** 本仓库 SKU(有就带上,方便对账) */
  sku?: string | null;
  /**
   * 附加信息 —— 打印服务的克重 / 尺寸那些
   *
   * 各通道自己决定怎么用:Shopify 落成行属性,微信/支付宝塞进商品描述。
   */
  attributes?: Record<string, string>;
}

/** 一次支付请求 —— 通道无关 */
export interface PaymentRequest {
  /**
   * 本仓库的订单号 —— 支付平台的 `out_trade_no` 就是它
   *
   * 三个通道都靠它反查本地订单(回调里只有这个是可信的关联键)。
   */
  orderNo: string;
  /** 下单邮箱(Shopify 用来建 customer;微信/支付宝用不上) */
  email: string;
  /** 行项目 */
  items: PaymentRequestItem[];
  /** 运费(分) */
  shippingCents: number;
  /** 收货地址(Shopify 要;微信/支付宝用不上) */
  shippingAddress: PaymentShippingAddress | null;
  /** 备注 —— 工作室在后台直接看到要点 */
  note: string;
  /** 付完钱回跳的地址 */
  successUrl: string;
  /** 币种(iso 大写) */
  currency: string;
}

/**
 * 支付用的收货地址
 *
 * 只带**通道真的要用**的字段 —— 微信/支付宝不收地址(用户在它们那边填),
 * Shopify 要(草稿订单里带地址,付款页和发票上才有)。
 */
export interface PaymentShippingAddress {
  recipientName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  detail: string;
}

/* -------------------------------------------------------------------------- */
/*  支付会话                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 一次支付会话 —— 建单成功之后拿到的东西
 *
 * 三种形态:
 *
 * - `redirectUrl` —— 跳过去付(支付宝 / Shopify)
 * - `qrCodeUrl` —— 扫这个码付(微信 Native 的 `code_url`)
 * - 两个都没有 —— 通道出问题了(调用方负责报错)
 */
export interface PaymentSession {
  /** 哪个通道 */
  channel: OnlinePaymentChannel;
  /**
   * 支付平台侧的订单号
   *
   * 微信 = `out_trade_no`(就是我们自己的订单号)、支付宝 = `trade_no`、
   * Shopify = 草稿单 gid。**可能**是 null —— 有的通道不给我们这个号。
   */
  providerOrderId: string | null;
  /** 跳过去的地址(支付宝 / Shopify) */
  redirectUrl: string | null;
  /** 二维码内容(微信 Native) */
  qrCodeUrl: string | null;
  /** 会话什么时候过期 —— 用来告诉用户「请在 X 分钟内付完」 */
  expiresAt: string | null;
}

/* -------------------------------------------------------------------------- */
/*  通道                                                                       */
/* -------------------------------------------------------------------------- */

/** 一个收款通道 */
export interface PaymentProvider {
  /** 通道 id */
  channel: OnlinePaymentChannel;
  /**
   * 通道**配好了**没
   *
   * 没配好的通道不能出现在「选择支付方式」里 —— 让用户点一个注定失败的
   * 按钮,比不给他这个选项更糟。
   */
  isConfigured(): boolean;
  /**
   * 建一次支付会话
   *
   * 抛错就代表「这次没建成」;抛 `PaymentNotConfiguredError` 代表「这个通道
   * 压根没配好,重试没用」(跟「这次调用挂了」要分开,见 `payment-issue.ts`)。
   */
  createSession(request: PaymentRequest): Promise<PaymentSession>;
}

/* -------------------------------------------------------------------------- */
/*  错误                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 通道**没配好** —— 缺环境变量 / 缺证书
 *
 * 跟「这次调用挂了」是两件完全不同的事:这个重试**没用**,用户该去找工作室;
 * 那个重试就能好。所以两类错误必须分得开(见 `payment-issue.ts`)。
 */
export class PaymentNotConfiguredError extends Error {
  constructor(
    readonly channel: OnlinePaymentChannel,
    message?: string
  ) {
    super(message ?? `支付通道 ${channel} 没有配置好`);
    this.name = "PaymentNotConfiguredError";
  }
}

/** 通道调用失败 —— 网络 / 上游 / 证书过期 */
export class PaymentProviderError extends Error {
  constructor(
    readonly channel: OnlinePaymentChannel,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "PaymentProviderError";
  }
}

/* -------------------------------------------------------------------------- */
/*  通道清单(给界面用)                                                         */
/* -------------------------------------------------------------------------- */

/** 一个通道在界面上的信息 */
export interface PaymentChannelInfo {
  channel: OnlinePaymentChannel;
  /** 按钮上的名字 */
  label: string;
  /** 一句话说明(「扫码支付」「跳到支付宝」「银行卡」) */
  description: string;
  /** 配好了没 —— 没配好的不显示 */
  available: boolean;
}
