/**
 * 商城结算 —— 服务端
 *
 * ## 「本仓库算价,收银台只负责收钱」在这条链上的落法
 *
 * ```
 * 购物车(DB)→ 服务端重算每一行的价 → 落 storefront_order(_item)
 *            → 按用户选的通道建一次支付会话(本仓库算的价原样送过去)
 *            → 回写 payment_channel + provider_order_id + 付款入口
 *            → 前端跳(支付宝 / Shopify)或出示二维码(微信)
 *            → 通道回调 → 订单标 paid
 * ```
 *
 * ## 三个通道(2026-11-05)
 *
 * | 通道 | 收钱方式 | 付款入口 |
 * |---|---|---|
 * | `wechat` | 微信支付 Native(我们自己的商户号) | **扫码** —— 前端渲染二维码 |
 * | `alipay` | 支付宝电脑网站支付(我们自己的应用) | 跳支付宝 |
 * | `shopify` | Shopify 草稿订单(只做卡) | 跳 Shopify 收银台 |
 * | `stripe` | **旧路**:Sellbase + Stripe(过渡期并行) | 跳 Stripe |
 *
 * 「先并行,跑通再拆」—— 旧路还在,新路也在。三个新通道都跑通之后,旧路连同
 * `src/features/sellbase/` 一起拆掉,届时 `stripe` 从枚举里删掉。
 *
 * ## 服务端**不信**客户端带来的价
 *
 * 购物车里存的单价只是缓存(`cart_item.unit_price_cents`)。结算这一步
 * 把每一行按 `metadata` 重新算一遍 —— 定价规则(配件加价 / 基础价 / 阶梯
 * 折扣)改了之后,存量购物车带着旧价,直接收就是收错了。
 *
 * ## 先落本地订单,再建支付会话
 *
 * 顺序不能反:本地订单是「订单事实」,支付会话是「收款载体」。收款通道那边
 * 挂了(网络 / 配置 / 上游没连上),订单已经在了,状态停在 `unpaid`,用户还能
 * 在详情页重取付款入口。反过来的话就变成「收了钱但没有订单」。
 *
 * ## 失败要说清楚是**哪一种**失败
 *
 * 「收款通道没配好」(环境变量缺)和「这次调用挂了」(网络 / 上游)
 * 对用户是两件完全不同的事:前者重试**没用** —— 得等部署补上配置,用户在
 * 「我的订单」里点多少次「重新获取支付链接」都是同一个结果;后者重试就能好。
 *
 * 混成一句话「生成支付链接失败,请稍后重试」的话,用户就在反复重试一件根本
 * 不会成功的事(2026-11-05 线上真实踩到过:一次部署刚加好 Sellbase 环境变量,
 * 但那一次构建没赶上,用户下了一单既没有 Sellbase 订单也没有支付链接)。
 * `paymentIssue` 就是这个区分 —— 见 `classifyPaymentIssue`。
 *
 * ## 逐分相等
 *
 * 送过去的行合计 = `折后单价 × quantity`(`discountedUnitPriceCents × quantity`)。
 * 本仓库的口径是「先折单价,再乘数量」(`pricing.ts` 的文件头),送过去的
 * 跟收银台收的**逐分相等**。
 */

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { PRICE_CURRENCY } from "@/config/currency";
import { db } from "@/db";
import {
  type ShippingAddressSnapshot,
  storefrontOrder,
  storefrontOrderItem,
} from "@/db/schema";
import type { CouponErrorCode } from "@/features/coupon/lib/coupon-calc";
import {
  evaluateCoupon,
  evaluateCouponEffect,
} from "@/features/coupon/lib/coupon-service";
import {
  CouponUsageLimitError,
  redeemCoupon,
} from "@/features/coupon/lib/coupon-store";
import {
  getPaymentProvider,
  isPaymentChannelEnabled,
  listAvailablePaymentChannels,
} from "@/features/payments/lib/registry";
import type {
  OnlinePaymentChannel,
  PaymentChannel,
  PaymentRequest,
  PaymentRequestItem,
} from "@/features/payments/lib/types";
import {
  CarrierNotFoundError,
  resolveCarrierVariant,
  sizeCodeFromSpecSizeId,
} from "@/features/sellbase/lib/carrier";
import { backfillSellbaseCustomerId } from "@/features/sellbase/lib/customer";
import {
  SELLBASE_CURRENCY,
  SELLBASE_FX_RATE,
} from "@/features/sellbase/lib/env";
import {
  centsToStoreAmount,
  getCurrencyConversion,
} from "@/features/sellbase/lib/money";
import { createSellbaseOrder } from "@/features/sellbase/lib/orders";
import type { CartLineItem, PricingResult } from "../types";
import { buildLineSnapshot } from "./cart-snapshot";
import { getCart, stampCartOwner } from "./cart-store";
import {
  buildStorefrontSellbaseNote,
  buildStorefrontSuccessUrl,
} from "./checkout-url";
import { findProductById } from "./mock-catalog";
import { ensureStorefrontOrderPaymentLink } from "./order-payment";
import {
  classifyPaymentIssue,
  type StorefrontPaymentIssue,
} from "./payment-issue";
import {
  findReusablePendingOrder,
  type ReusablePendingOrder,
} from "./pending-order";
import { getPriceSource } from "./price-source";
import type { PriceSource } from "./price-source-types";
import { calculatePricing } from "./pricing";
import { calculateShippingCents } from "./pricing-constants";

/* -------------------------------------------------------------------------- */
/*  入参 / 出参                                                               */
/* -------------------------------------------------------------------------- */

export interface CheckoutInput {
  /** 购物车 id(来自 cookie) */
  cartId: string;
  /** 下单人 —— 结算必须登录 */
  userId: string;
  /** 下单邮箱 —— 一律取账号邮箱,不采信客户端 */
  email: string;
  /** 收货地址**快照** */
  address: ShippingAddressSnapshot;
  /** 用户留言 */
  note?: string | null;
  /**
   * 界面语言 —— 打印工单的邮件通知语言
   *
   * 落库而不是取「当前请求的 locale」:改状态的邮件是**工作室**触发的,
   * 那时请求 locale 是 admin 的语言,不是下单用户的语言(同 print_order.locale
   * 的口径)。不传 = 中文。
   */
  locale?: string | null;
  /**
   * 收款通道(2026-11-05)
   *
   * 不传 = 走旧的 Sellbase/Stripe 那条路(过渡期)。前端会把用户选的那个
   * 通道传上来。
   */
  channel?: PaymentChannel | null;
}

/** 结算成功的返回 */
export interface CheckoutSuccess {
  /** 本地订单号 */
  orderNo: string;
  /**
   * 付款入口(跳转地址)—— null 表示这一单不是「跳过去付」
   *
   * 支付宝 / Shopify / 旧路的 Stripe 都是跳转;微信是**扫码**,看
   * `paymentQrCodeUrl`。
   */
  paymentUrl: string | null;
  /**
   * 微信扫码用的二维码内容(2026-11-05)
   *
   * 只有微信通道有值 —— 别的通道是 null。
   */
  paymentQrCodeUrl: string | null;
  /** 这次用的是哪个通道 */
  paymentChannel: PaymentChannel;
  /** 折前小计(分) */
  subtotalCents: number;
  /** 阶梯折扣(分) */
  discountCents: number;
  /** 运费(分) */
  shippingCents: number;
  /** 优惠码减掉的金额(分)—— 订单级,0 = 没用券 */
  couponDiscountCents: number;
  /** 用了的优惠码 —— null = 没用券 */
  couponCode: string | null;
  /** 合计(分) */
  totalCents: number;
  /** 币种 */
  currency: string;
  /**
   * 付款入口为什么没生成(2026-11-05)
   *
   * null = 拿到了(或者压根没失败)。非 null 时 `paymentUrl` 一定是 null。
   *
   * 分两种,不是一种 —— 用户看到的话术不一样:
   *
   * - `PAYMENT_NOT_CONFIGURED` —— 收款通道**没配好**(环境变量缺)。
   *   这种情况下「去我的订单里重新获取」**也拿不到**,提示得说清楚,
   *   否则用户会一直重试一件根本不会成功的事(2026-11-05 线上真实踩到过)。
   * - `PAYMENT_FAILED` —— 通道配好了但这次调用失败(网络 / 上游)。
   *   这种重试是有意义的。
   */
  paymentIssue: StorefrontPaymentIssue | null;
}

export type { StorefrontPaymentIssue };
export { classifyPaymentIssue };

export type CheckoutErrorCode =
  | "CART_NOT_FOUND"
  | "CART_EMPTY"
  | "PRICING_FAILED"
  | "CARRIER_NOT_FOUND"
  | "PAYMENT_CHANNEL_UNAVAILABLE"
  /** 优惠码不可用 —— 精确原因看 `CheckoutError.couponErrorCode` */
  | "COUPON_INVALID"
  | "FAILED";

/** 结算失败 —— 带机器可读的 code,Route Handler 翻译成响应 */
export class CheckoutError extends Error {
  constructor(
    readonly code: CheckoutErrorCode,
    message: string,
    /**
     * 优惠码场景下的**精确原因**(2026-11-08)
     *
     * 商城侧只加一个 `"COUPON_INVALID"` —— 它决定 HTTP 状态码,不该膨胀成
     * 10 个。精确原因(过期 / 没满门槛 / 超限 …)走这个可选字段,界面按它
     * 查文案表说人话。
     *
     * > `exactOptionalPropertyTypes` 下可选参数必须显式写 `| undefined`。
     */
    readonly couponErrorCode?: CouponErrorCode | undefined
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

/* -------------------------------------------------------------------------- */
/*  订单号                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 生成业务订单号 —— `SO-20261104-3F7K2A`
 *
 * 格式跟打印工单的 `PO-…` 一致:前缀 + 日期 + 6 位大写 hex。
 * 随机段用 `randomBytes` 而不是 `Math.random()` —— 订单号要能挡住枚举。
 */
export function generateStorefrontOrderNo(now = new Date()): string {
  const ymd = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const rand = randomBytes(3).toString("hex").toUpperCase();
  return `SO-${ymd}-${rand}`;
}

/* -------------------------------------------------------------------------- */
/*  重算                                                                      */
/* -------------------------------------------------------------------------- */

/** 重算后的一行 */
export interface PricedLine {
  item: CartLineItem;
  /** 折后单价(分) */
  discountedUnitPriceCents: number;
  /** 折前单价(分) */
  unitPriceCents: number;
  /** 行合计(分) */
  lineTotalCents: number;
  /** 这一行的数量 */
  quantity: number;
}

/**
 * 按 metadata 重算一行
 *
 * 算不出来就抛 —— 结算的时候不能「按旧价收」,也不能「按 0 收」。
 * 用户会看到「这件商品的价格算不出来,请刷新购物车」,把那一行删掉重下。
 *
 * **车里只有目录商品**(2026-11-08)—— 打印服务不进商城购物袋,工单自己建、
 * 自己收款(见 `POST /api/print-orders`)。
 *
 * ## `source` —— DB 里的价(2026-11-08)
 *
 * 基础价 / 配件加价取自 DB(后台 `/admin/products` 改的就是它),
 * 查不到才退回代码常量。
 */
function repriceLine(item: CartLineItem, source: PriceSource): PricedLine {
  const metadata = item.metadata;

  const product = findProductById(item.productId);
  if (!product) {
    throw new CheckoutError(
      "PRICING_FAILED",
      `商品 ${item.productId} 已经不在目录里了`
    );
  }

  let pricing: PricingResult;
  try {
    pricing = calculatePricing(
      {
        productId: item.productId,
        productHandle: product.handle,
        productTypeCode: product.productTypeCode,
        materialId: metadata.materialId,
        sizeId: metadata.sizeId,
        aiStyleId: metadata.aiStyleId,
        engravingText: metadata.engravingText,
        rushOrder: metadata.rushOrder,
        accessoryVariantIds: metadata.accessoryVariantIds ?? [],
        quantity: item.quantity,
        previewImageUrl: metadata.previewImage,
        originalImageUrl: metadata.originalImage,
      },
      source
    );
  } catch (error) {
    throw new CheckoutError(
      "PRICING_FAILED",
      error instanceof Error ? error.message : "价格计算失败"
    );
  }

  return {
    item,
    unitPriceCents: pricing.unitPriceCents,
    discountedUnitPriceCents: pricing.discountedUnitPriceCents,
    lineTotalCents: pricing.discountedUnitPriceCents * item.quantity,
    quantity: item.quantity,
  };
}

/* -------------------------------------------------------------------------- */
/*  通道                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 定下这次用哪个通道
 *
 * ## 不传 = 第一个「开放了而且配好了」的通道
 *
 * 通道的名单在 `@/features/payments/lib/registry` 的
 * `ENABLED_PAYMENT_CHANNELS` —— 现在先只开 Shopify。前端的选择器也是按
 * 同一份清单画的,所以「不传」和「前端默认选中的那个」永远是同一个。
 *
 * ## 指定的通道不可用就直接报错
 *
 * 静默退回别的通道会让用户以为自己选了微信支付、结果跳到了别的地方
 * (用户看着莫名其妙)。「这个方式现在不可用」是一句实话。
 *
 * ## 旧路(Sellbase + Stripe)不再接新单
 *
 * 代码还留着(`src/features/sellbase/`,已建好的旧单还能重取支付入口),
 * 但**新单不走它** —— 所以这里直接拒掉。
 */
export function resolveCheckoutChannel(
  requested: PaymentChannel | null | undefined
): OnlinePaymentChannel {
  const unavailable = new CheckoutError(
    "PAYMENT_CHANNEL_UNAVAILABLE",
    "这个支付方式暂时不可用,请换一个或联系工作室"
  );

  // `offline` 不是线上通道 —— 线下收款是工作室后台手动标的,没有支付会话
  if (requested === "offline") throw unavailable;
  // 旧路:过渡期保留,新单不再走
  if (requested === "stripe") throw unavailable;

  if (requested) {
    if (!isPaymentChannelEnabled(requested)) throw unavailable;
    const provider = getPaymentProvider(requested);
    if (!provider?.isConfigured()) throw unavailable;
    return requested;
  }

  // 没指定 → 第一个「开放了而且配好了」的通道
  const fallback = listAvailablePaymentChannels()[0];
  if (!fallback) {
    throw new CheckoutError(
      "PAYMENT_CHANNEL_UNAVAILABLE",
      "暂时没有可用的在线支付方式,请联系工作室"
    );
  }
  return fallback.channel;
}

/**
 * 把重算后的行翻译成「支付请求」—— **通道无关**
 *
 * 送过去的单价是**折后单价**(分)。「先折单价,再乘数量」—— 阶梯折扣在这一层
 * 就已经折过了,通道不参与定价。
 *
 * ## `discountCents` —— 订单级优惠(2026-11-08)
 *
 * 优惠码是**订单级**的 —— 折扣不减在任何一行的单价上,而是减整单。
 *
 * 而收银台的总额是**从各行算出来的**(微信只发 `amount.total`、支付宝的
 * `biz_content` 只有 `total_amount`,都没有 `goods_detail`)。
 *
 * ⇒ 给 `PaymentRequest` 加一个可选字段,两个通道各减**一次**:
 *
 * ```
 * computeTotalCents = Σ(折后单价 × 数量) + 运费 − 优惠
 *                    = discountedSubtotal + shipping − couponDiscount
 *                    = storefront_order.total_cents   ✅ 逐分相等
 * ```
 *
 * **不按比例摊到各行单价上** —— 摊完要除回单价,除不尽(100 分摊到 3 件
 * = 33.33),单价必须是整数 ⇒ 摊不平;而且摊分会引入 `round` 误差,
 * `Σ round(xᵢ)` 跟 `round(Σ xᵢ)` 不一定相等,逐分相等直接被破坏。
 */
export function buildPaymentRequest(params: {
  orderNo: string;
  email: string;
  lines: PricedLine[];
  shippingCents: number;
  /** 订单级优惠(分)—— 缺省 0(= 没有优惠) */
  discountCents?: number;
  shippingAddress: ShippingAddressSnapshot;
  note: string | null;
  successUrl: string;
  currency: string;
}): PaymentRequest {
  const items: PaymentRequestItem[] = params.lines.map((line) => {
    // 附加信息 —— 各通道自己决定怎么用(Shopify 落成行属性,微信/支付宝塞进描述)
    //
    // 用**对象字面量**而不是 `attributes["刻字"] = …` —— 后者是计算属性访问,
    // biome 的 `useLiteralKeys` 会报(而且中文标识符的点号写法读着别扭)。
    const engraving = line.item.metadata.engravingText;

    const attributes: Record<string, string> = {
      ...(engraving ? { 刻字: engraving } : {}),
    };

    return {
      title: line.item.productTitle,
      quantity: line.quantity,
      unitPriceCents: line.discountedUnitPriceCents,
      sku: line.item.productHandle,
      attributes,
    };
  });

  return {
    orderNo: params.orderNo,
    email: params.email,
    items,
    shippingCents: params.shippingCents,
    // 订单级优惠 —— 通道从总额里减一次
    discountCents: params.discountCents ?? 0,
    shippingAddress: {
      recipientName: params.shippingAddress.recipientName,
      phone: params.shippingAddress.phone,
      province: params.shippingAddress.province,
      city: params.shippingAddress.city,
      district: params.shippingAddress.district,
      detail: params.shippingAddress.detail,
    },
    note: params.note ?? "",
    successUrl: params.successUrl,
    currency: params.currency,
  };
}

/* -------------------------------------------------------------------------- */
/*  结算                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 结算
 *
 * 步骤:
 * 1. 读购物车 → **过户**给账号 → 重算每一行的价
 * 2. 算优惠码的**效果**(不判资格)→ 算出合计
 * 3. 定通道(用户选的;没配好的通道直接报错)
 * 4. 看看有没有一张**可以复用**的待付款订单(同一批货 + 同一地址 + 同一留言)
 * 5. 没命中复用 → **判券的资格**(过期 / 没满门槛 / 超限 / 不是新人)
 * 6. 解析每一行的 Sellbase 载体变体(**只有旧路需要**)
 * 7. 落 `storefront_order` + `storefront_order_item` + **记一次用券**(同一个事务)
 * 8. 建支付会话(旧路 = Sellbase 订单;新路 = 通道的支付会话)
 * 9. 回写 `payment_channel` + `provider_order_id` + 付款入口
 *
 * ## 「复用」为什么排在「判券」前面(2026-11-08)
 *
 * 上一张待付款单是**券还有效的时候**建的,折扣已经锁死在它的合计里了。
 * 后来券过期了 / 额度被别人抢完了 —— 用户要付的还是**那张单上的价**
 * (下单时同意的价)。
 *
 * 先判资格的话:首单券建的那张单已经算作「下过单」⇒ 再判一次就是
 * `NOT_FIRST_ORDER` ⇒ **用户连自己那张单都付不了**。
 *
 * 所以顺序是「先算效果 → 拿合计去比那张单 → 命中就复用 → 再判资格」。
 * 详见 2b / 4b 两步的注释。
 *
 * ## 购物车**不在这里清空**(2026-11-05)
 *
 * 原来是在建单这一刻就 `clearCartItems()` —— 用户没付钱就走了,回来一看购物车
 * 空了,东西「丢了」(这是 2026-11-05 线上真实踩到的)。
 *
 * 现在改成:**付款成功才清** —— 钱到了(见 `payments/lib/settle.ts`)才把买掉
 * 的那几行从购物车里摘掉。没付钱就走 → 购物车原样还在。
 *
 * ## 所以要「复用」上一张待付款的订单
 *
 * 购物车不清 → 用户再点一次「去支付」会多出一张一样的单(还有可能付两次钱)。
 * 同一批货直接复用上一张单,见 `pending-order.ts`。
 */
export async function checkout(input: CheckoutInput): Promise<CheckoutSuccess> {
  const cart = await getCart(input.cartId);
  if (!cart) {
    throw new CheckoutError("CART_NOT_FOUND", "购物车不存在或已过期");
  }
  if (cart.items.length === 0) {
    throw new CheckoutError("CART_EMPTY", "购物车是空的");
  }

  /**
   * 车里**只有目录商品**(2026-11-08)
   *
   * 工作室的说法:「不要放入购物车,放在这里 account/print-orders」。打印服务
   * 是另一条线 —— 工单自己建、自己收款(见 `POST /api/print-orders`)。
   *
   * 所以这张车里每一行都是要寄出去的实物,运费按整张小计算。
   */

  // 0. 购物车过户
  //
  //    游客购物车在这一刻归到账号名下(以后换设备登录还能找回)。
  //
  //    **必须早于付款** —— 付款成功那一刻要靠 `cart.user_id` 找到「这个人的
  //    购物车」,把买掉的行摘掉。晚了就摘不掉。
  await stampCartOwner(input.cartId, input.userId);

  // 1. 重算每一行
  //
  //    ## 价从 DB 来(2026-11-08)
  //
  //    后台 `/admin/products` 改的是 DB 的 `product.base_price_cents` /
  //    `product_accessory_variant.price_delta_cents`。这条链路原先读的是
  //    **代码常量** ⇒ 后台改价,商城网页不变。
  //
  //    **DB 读失败时这里直接失败** —— 绝不允许按一个已经作废的价收款。
  //    购物袋那边可以降级(显示代码常量的价),这边不行:
  //    宁可下不了单,也不能收错钱。
  const source = await getPriceSource();
  if (source.degraded) {
    throw new CheckoutError("PRICING_FAILED", "价格暂时无法确认,请稍后重试");
  }

  const lines = cart.items.map((item) => repriceLine(item, source));

  // 2. 金额
  const subtotalCents = lines.reduce(
    (sum, l) => sum + l.unitPriceCents * l.quantity,
    0
  );
  const discountedSubtotalCents = lines.reduce(
    (sum, l) => sum + l.lineTotalCents,
    0
  );
  const discountCents = subtotalCents - discountedSubtotalCents;
  // 免运费门槛按**折后**金额算 —— 用户看到的、付的小计就是折后那个
  //
  // 规则本身在 `pricing-constants.ts` 的 `calculateShippingCents()` ——
  // 客户端的购物袋页 / 抽屉 / 结算页跟这里用**同一份**,不会「页面没运费、
  // 结算收了」。
  //
  // **门槛在优惠之前算** —— 优惠把金额压到 ¥99 以下反而多收运费,那是坑用户。
  const grossShippingCents = calculateShippingCents(discountedSubtotalCents);

  // 2b. 优惠码(2026-11-08)—— **先算效果,后判资格**
  //
  //     这一步**只算「这张券能减多少」**,不判它还能不能用。
  //
  //     ## 为什么分成两步
  //
  //     第 4 步(复用上一张待付款单)要拿**合计**去比那张单。那张单是**券还有效
  //     的时候**建的,折扣已经锁死在它的合计里了;后来券过期了 / 额度被别人抢
  //     完了 —— 用户要付的还是**那张单上的价**(下单时同意的价)。
  //
  //     先算效果 → 算出同一个合计 → 命中就复用。复用成功之后,券现在还能不能
  //     用**不重要** —— 那笔优惠早就在那张单上了。
  //
  //     顺序反过来会出事:首单券建的那张单已经算作「下过单」⇒ 再判一次就是
  //     `NOT_FIRST_ORDER` ⇒ **用户连自己那张单都付不了**。
  //
  //     折扣金额跟下面的完整判定走**同一份**纯函数(`computeCouponEffect`),
  //     两处各算一遍迟早对不上。
  const couponEffect = cart.couponCode
    ? await evaluateCouponEffect({
        code: cart.couponCode,
        couponBaseCents: discountedSubtotalCents,
        shippingCents: grossShippingCents,
      })
    : null;

  // 车里有码但查不到这张券 → **码不存在**
  //
  // 券只停用不删,所以「查不到」= 这张券从来没存在过(或者库读挂了)。
  // 直接报,别悄悄按原价收 —— 用户会问「我的码呢」。
  if (cart.couponCode && !couponEffect) {
    throw new CheckoutError(
      "COUPON_INVALID",
      "这个优惠码用不了",
      "COUPON_NOT_FOUND"
    );
  }

  const couponCode = couponEffect?.code ?? null;
  const couponDiscountCents = couponEffect?.discountCents ?? 0;
  // **只有免运费券动运费** —— 百分比 / 满减不碰运费(运费不是商品)
  const shippingCents = couponEffect?.freeShipping ? 0 : grossShippingCents;
  const totalCents =
    discountedSubtotalCents - couponDiscountCents + shippingCents;

  // 3. 通道
  const channel = resolveCheckoutChannel(input.channel);
  const legacy = channel === "stripe";

  // 3b. 旧路(Sellbase + Stripe)**不支持优惠码**
  //
  //     那条路逐项换算,没有折扣概念,也表达不了「免运费」——
  //     带券的订单走它必然对不上账。
  //
  //     新订单永远走不到这里(`ENABLED_PAYMENT_CHANNELS` 里没有 stripe),
  //     这是防御性的闸。
  if (legacy && couponDiscountCents > 0) {
    throw new CheckoutError(
      "PAYMENT_CHANNEL_UNAVAILABLE",
      "这条支付方式不支持优惠码,请换一个支付方式"
    );
  }

  // 4. 复用:同一批货 → 用上一张还没付的单
  //
  //    购物车改成「付款成功才清空」之后,用户没付钱又点一次「去支付」会攒出
  //    两张一样的单 —— 工作室那边多一张永远不付的僵尸单,用户那边可能付了
  //    旧的那张码、系统却标的是新的那张(或者两张都付)。
  const reusable = await findReusablePendingOrder({
    userId: input.userId,
    snapshot: buildLineSnapshot(
      lines.map((line) => ({
        productId: line.item.productId,
        metadata: line.item.metadata,
        quantity: line.quantity,
      }))
    ),
    totalCents,
    address: input.address,
    note: input.note ?? null,
    couponCode,
  });
  if (reusable) {
    return reusePendingOrder(reusable, channel);
  }

  // 4b. 券还能不能用?(额度 / 身份)
  //
  //     **在复用之后判** —— 复用成功的话,那张单上的折扣早就锁死了,券现在
  //     过期了 / 额度被抢完了,都不影响「用户付那张单」。
  //
  //     没命中复用才走完整判定:**重新校验、重新算** —— 不信车上的旧结果。
  //     车里的码可能在这几秒里过期了 / 被人用完了 / 车里的行数变了(门槛不再
  //     满足)。
  //
  //     码不可用 → **400 + 精确原因码**,不静默按原价收(用户会问「我的码呢」)。
  const couponEvaluation = await evaluateCoupon({
    code: cart.couponCode,
    orderKind: "mall",
    couponBaseCents: discountedSubtotalCents,
    shippingCents: grossShippingCents,
    // 结算**必须登录** —— 身份就在手上,直接给
    resolveUserId: async () => input.userId,
  });
  if (couponEvaluation.error) {
    throw new CheckoutError(
      "COUPON_INVALID",
      "这个优惠码用不了",
      couponEvaluation.error
    );
  }
  const coupon = couponEvaluation.coupon;

  // 5. 载体变体 —— **只有旧路需要**
  //
  //    新通道的价是本仓库给的,不经过 Sellbase 的载体变体(所以新通道不
  //    需要把商品目录同步过去)。
  const carriers = legacy
    ? await Promise.all(
        lines.map(async (line) => {
          try {
            const product = findProductById(line.item.productId);
            const productCode = product?.productTypeCode ?? "";
            const sizeCode = sizeCodeFromSpecSizeId(line.item.metadata.sizeId);
            return await resolveCarrierVariant({ productCode, sizeCode });
          } catch (error) {
            if (error instanceof CarrierNotFoundError) {
              throw new CheckoutError("CARRIER_NOT_FOUND", error.message);
            }
            throw error;
          }
        })
      )
    : null;

  // 6. 落本地订单
  const orderNo = generateStorefrontOrderNo();
  const orderId = `so_${nanoid(16)}`;
  const now = new Date();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(storefrontOrder).values({
        id: orderId,
        orderNo,
        userId: input.userId,
        email: input.email,
        status: "unpaid",
        paymentStatus: "unpaid",
        subtotalCents,
        discountCents,
        shippingCents,
        // 优惠码 —— 订单级,减整单,不落在任何一行上
        couponCode,
        couponDiscountCents,
        totalCents,
        currency: PRICE_CURRENCY,
        shippingAddress: input.address,
        note: input.note ?? null,
        // 通道先记上 —— 建支付会话失败时也知道这单本来该走哪条路
        paymentChannel: channel,
        createdAt: now,
        updatedAt: now,
      });

      for (const [index, line] of lines.entries()) {
        const carrier = carriers?.[index] ?? null;
        await tx.insert(storefrontOrderItem).values({
          id: `soi_${nanoid(16)}`,
          orderId,
          productId: line.item.productId,
          productHandle: line.item.productHandle,
          productTitle: line.item.productTitle,
          productThumbnail: line.item.productThumbnail || null,
          // 旧路挂 Sellbase 的载体变体;新路没有载体 —— 价是本仓库自己给的
          variantId: carrier?.variantId ?? null,
          sku: carrier?.sku ?? line.item.productHandle,
          unitPriceCents: line.unitPriceCents,
          discountedUnitPriceCents: line.discountedUnitPriceCents,
          quantity: line.quantity,
          lineTotalCents: line.lineTotalCents,
          metadata: line.item.metadata as unknown as Record<string, unknown>,
          createdAt: now,
        });
      }

      // 6b. 记一次用券(2026-11-08)—— **在建单这个事务里**
      //
      //     **建单就记**,不等付款 —— 不然用户可以下 N 张待付款的单把额度占光。
      //
      //     幂等靠 `coupon_redemption` 的唯一索引 `(order_kind, order_id)`:
      //     同一张单重投不会把用量加两遍。
      //
      //     **跟建单同一个事务** —— 券的总量上限是**硬闸**:额度满了就**不让
      //     这一单成立**(回滚),而不是「单建了、券超发一次」。超发一次 = 工作室
      //     的预算多让出去一次。
      if (coupon) {
        await redeemCoupon({
          couponId: coupon.couponId,
          userId: input.userId,
          orderKind: "storefront",
          orderId,
          discountCents: couponDiscountCents,
          usageLimit: coupon.usageLimit,
          tx,
        });
      }
    });
  } catch (error) {
    // 额度满了 → 这一单不成立(事务已经回滚)
    if (error instanceof CouponUsageLimitError) {
      throw new CheckoutError(
        "COUPON_INVALID",
        "这个优惠码已经用完了",
        "COUPON_LIMIT_REACHED"
      );
    }
    throw error;
  }

  // 7. 建支付会话
  let paymentUrl: string | null = null;
  let paymentQrCodeUrl: string | null = null;
  let providerOrderId: string | null = null;
  let sellbaseOrderId: string | null = null;
  let paymentIssue: StorefrontPaymentIssue | null = null;

  if (legacy) {
    // 旧路:Sellbase 收银台 + Stripe
    const conversion = getCurrencyConversion(
      SELLBASE_CURRENCY,
      SELLBASE_FX_RATE
    );
    const note = buildStorefrontSellbaseNote({
      orderNo,
      lines: lines.map((l) => ({
        title: l.item.productTitle,
        quantity: l.quantity,
      })),
    });

    try {
      const created = await createSellbaseOrder({
        email: input.email,
        items: lines.map((line, index) => ({
          variantId: carriers?.[index]?.variantId ?? "",
          quantity: line.quantity,
          unitPriceAmount: centsToStoreAmount(
            line.discountedUnitPriceCents,
            conversion
          ),
        })),
        shippingAmount: centsToStoreAmount(shippingCents, conversion),
        shippingAddress: input.address,
        note,
        successUrl: buildStorefrontSuccessUrl(orderNo),
        // 商城这边本仓库不发确认邮件 —— 让 Sellbase 发,免得用户收两封
        notifyCustomer: true,
      });
      sellbaseOrderId = created.orderId;
      paymentUrl = created.paymentUrl;

      // 回填 Sellbase customer 指针(加速用,失败不影响主流程)
      if (created.customerId) {
        await backfillSellbaseCustomerId(input.userId, created.customerId);
      }
    } catch (error) {
      // 本地订单已经落好了 —— 记日志,把「没有支付链接」这件事如实返回,
      // 用户还能在详情页重取链接。不要把一个收款通道的问题变成下单失败。
      console.error(
        `[storefront] ${orderNo} 建 Sellbase 订单失败 —— 订单已落库,状态 unpaid`,
        error
      );
      // 「配置没配好」和「这次调用挂了」要分开 —— 前者重试没用(见
      // `classifyPaymentIssue` 的注释)
      paymentIssue = classifyPaymentIssue(error);
    }
  } else {
    // 新路:微信 / 支付宝 / Shopify
    const provider = getPaymentProvider(channel);
    if (!provider) {
      throw new CheckoutError(
        "PAYMENT_CHANNEL_UNAVAILABLE",
        "这个支付方式暂时不可用,请换一个或联系工作室"
      );
    }

    try {
      const session = await provider.createSession(
        buildPaymentRequest({
          orderNo,
          email: input.email,
          lines,
          shippingCents,
          discountCents: couponDiscountCents,
          shippingAddress: input.address,
          note: input.note ?? null,
          successUrl: buildStorefrontSuccessUrl(orderNo),
          currency: PRICE_CURRENCY,
        })
      );
      paymentUrl = session.redirectUrl;
      paymentQrCodeUrl = session.qrCodeUrl;
      providerOrderId = session.providerOrderId;
    } catch (error) {
      console.error(
        `[storefront] ${orderNo} 建 ${channel} 支付会话失败 —— 订单已落库,状态 unpaid`,
        error
      );
      paymentIssue = classifyPaymentIssue(error);
    }
  }

  // 8. 回写
  if (legacy) {
    if (sellbaseOrderId) {
      await db
        .update(storefrontOrder)
        .set({
          sellbaseOrderId,
          paymentUrl,
          updatedAt: new Date(),
        })
        .where(eq(storefrontOrder.id, orderId));
    }
  } else {
    await db
      .update(storefrontOrder)
      .set({
        paymentChannel: channel,
        providerOrderId,
        paymentUrl,
        paymentQrCodeUrl,
        updatedAt: new Date(),
      })
      .where(eq(storefrontOrder.id, orderId));
  }

  // 9. **购物车不清空**
  //
  //    购物车改成「付款成功才清空」—— 钱到了才把买掉的那些行摘掉(见
  //    `payments/lib/settle.ts`)。用户没付钱就走了,购物车还是原样。
  //
  //    「过户」在函数开头就做了(早于付款 —— 付款那一刻要靠 `cart.user_id`
  //    找到这个人的购物车)。

  return {
    orderNo,
    paymentUrl,
    paymentQrCodeUrl,
    paymentChannel: channel,
    subtotalCents,
    discountCents,
    shippingCents,
    couponDiscountCents,
    couponCode,
    totalCents,
    currency: PRICE_CURRENCY,
    paymentIssue,
  };
}

/* -------------------------------------------------------------------------- */
/*  复用上一张待付款的订单                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 复用一张待付款的订单
 *
 * ## 为什么复用而不是再落一张
 *
 * 购物车改成「付款成功才清空」之后,用户没付钱又回来点一次「去支付」,会
 * 攒出两张一模一样的单:
 *
 * - 工作室那边多一张永远不付的僵尸单
 * - 支付入口有两份 —— 用户可能付了旧的那张,系统标的是新的那张,或者两张
 *   都付(收两次钱)
 *
 * ## 付款入口沿用那一单原本的通道
 *
 * 入口跟通道绑着(微信是二维码、Shopify 是跳转地址)。用户中途换了通道
 * 的话,与其重建一张单(又变成重复下单),不如把那一单原来的通道给他 ——
 * 他看到的是「我这一单还没付钱」。
 */
async function reusePendingOrder(
  reusable: ReusablePendingOrder,
  fallbackChannel: OnlinePaymentChannel
): Promise<CheckoutSuccess> {
  const link = await ensureStorefrontOrderPaymentLink(
    reusable.order,
    reusable.items
  );

  return {
    orderNo: reusable.order.orderNo,
    paymentUrl: link.ok ? link.paymentUrl : null,
    paymentQrCodeUrl: link.ok ? link.paymentQrCodeUrl : null,
    paymentChannel: reusable.order.paymentChannel ?? fallbackChannel,
    subtotalCents: reusable.order.subtotalCents,
    discountCents: reusable.order.discountCents,
    shippingCents: reusable.order.shippingCents,
    couponDiscountCents: reusable.order.couponDiscountCents ?? 0,
    couponCode: reusable.order.couponCode ?? null,
    totalCents: reusable.order.totalCents,
    currency: reusable.order.currency,
    // 「没配好」和「这次挂了」要分开 —— 前者重试没用(见 `payment-issue.ts`)
    paymentIssue: link.ok
      ? null
      : link.code === "PAYMENT_NOT_CONFIGURED"
        ? "PAYMENT_NOT_CONFIGURED"
        : "PAYMENT_FAILED",
  };
}
