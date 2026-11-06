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
import { createPrintOrder } from "@/features/print-quote/lib/order-store";
import {
  computePrintServiceLinePrice,
  generatePrintOrderNo,
} from "@/features/print-quote/lib/quote-server";
import type { PrintQuote } from "@/features/print-quote/lib/quote-types";
import { normalizePrintOrderLocale } from "@/features/print-quote/lib/quote-types";
import {
  CarrierNotFoundError,
  resolveCarrierVariant,
  resolvePrintServiceCarrier,
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
import { type CartKind, normalizeCartKind, PRINT_CART_KIND } from "./cart-kind";
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
import { calculatePricing } from "./pricing";
import { shippingCentsForCart } from "./pricing-constants";
import {
  getPrintServiceSpec,
  printServiceSpecToQuoteInput,
} from "./print-service";

/* -------------------------------------------------------------------------- */
/*  入参 / 出参                                                               */
/* -------------------------------------------------------------------------- */

export interface CheckoutInput {
  /** 购物车 id(来自 cookie) */
  cartId: string;
  /**
   * 车的性质(2026-11-06)
   *
   * `storefront` 商城购物袋 / `print` 打印单。两种车的**钱**不一样:
   *
   * - 商城购物袋有运费(¥8,小计到 ¥99 免)—— 那是目录商品的运费规则
   * - 打印单**没有运费** —— 打印服务的价就是报价本身(见
   *   `print-quote/lib/payment.ts`:工单的支付金额恒等于 `total_price_cents`),
   *   报价台那边看到多少就收多少,不能到结算时再加一笔
   *
   * 不传 = 商城购物袋(旧调用方兼容)。
   */
  cartKind?: CartKind;
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
  /** 合计(分) */
  totalCents: number;
  /** 币种 */
  currency: string;
  /**
   * 这一单里包含的打印工单号(2026-11-05)
   *
   * 购物车里每一条打印服务行都会生成一张工单(`PO-…`)—— 工作室照着工单
   * 生产,用户照着工单号查进度。没有打印服务行时是空数组。
   */
  printOrderNos: string[];
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
  /**
   * 车的性质对不上(2026-11-06)
   *
   * 拿打印单去走商城那条路(或者反过来)—— 钱的口径会错(运费 / 商品)。
   */
  | "CART_KIND_MISMATCH"
  | "PRICING_FAILED"
  | "CARRIER_NOT_FOUND"
  | "PAYMENT_CHANNEL_UNAVAILABLE"
  | "FAILED";

/** 结算失败 —— 带机器可读的 code,Route Handler 翻译成响应 */
export class CheckoutError extends Error {
  constructor(
    readonly code: CheckoutErrorCode,
    message: string
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
  /** 这一行的数量 —— 打印服务行恒为 1 */
  quantity: number;
  /** 打印服务行的报价明细(不是打印服务行就是 null) */
  printQuote: PrintQuote | null;
}

/**
 * 按 metadata 重算一行
 *
 * 算不出来就抛 —— 结算的时候不能「按旧价收」,也不能「按 0 收」。
 * 用户会看到「这件商品的价格算不出来,请刷新购物车」,把那一行删掉重下。
 *
 * 打印服务行走的是另一套:按克重计价(`computePrintServiceLinePrice()`),
 * 不查目录。
 */
function repriceLine(item: CartLineItem): PricedLine {
  const metadata = item.metadata;

  // 打印服务行 —— 按克重计价
  const printSpec = getPrintServiceSpec(metadata);
  if (printSpec) {
    const priced = computePrintServiceLinePrice(
      printServiceSpecToQuoteInput(printSpec)
    );
    if (!priced) {
      throw new CheckoutError(
        "PRICING_FAILED",
        "打印服务这组模型数据算不出报价,请回到工具页重新测量"
      );
    }
    // 打印服务恒为一件 —— 数量阶梯折扣对它没有意义
    return {
      item,
      unitPriceCents: priced.unitPriceCents,
      discountedUnitPriceCents: priced.discountedUnitPriceCents,
      lineTotalCents: priced.discountedUnitPriceCents,
      quantity: 1,
      printQuote: priced.quote,
    };
  }

  const product = findProductById(item.productId);
  if (!product) {
    throw new CheckoutError(
      "PRICING_FAILED",
      `商品 ${item.productId} 已经不在目录里了`
    );
  }

  let pricing: PricingResult;
  try {
    pricing = calculatePricing({
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
    });
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
    printQuote: null,
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
 */
export function buildPaymentRequest(params: {
  orderNo: string;
  email: string;
  lines: PricedLine[];
  shippingCents: number;
  shippingAddress: ShippingAddressSnapshot;
  note: string | null;
  successUrl: string;
  currency: string;
}): PaymentRequest {
  const items: PaymentRequestItem[] = params.lines.map((line) => {
    // 附加信息 —— 各通道自己决定怎么用(Shopify 落成行属性,微信/支付宝塞进描述)
    //
    // 用**对象字面量**而不是 `attributes["克重"] = …` —— 后者是计算属性访问,
    // biome 的 `useLiteralKeys` 会报(而且中文标识符的点号写法读着别扭)。
    const quote = line.printQuote;
    const engraving = line.item.metadata.engravingText;

    const attributes: Record<string, string> = {
      ...(quote
        ? {
            克重: `${quote.materialWeightG} g`,
            ...(quote.supportWeightG != null
              ? { 支撑: `${quote.supportWeightG} g` }
              : {}),
            尺寸: `${quote.dims[0]}×${quote.dims[1]}×${quote.dims[2]} mm`,
            交期: `${quote.deliveryHours} 小时`,
          }
        : {}),
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
 * 2. 定通道(用户选的;没配好的通道直接报错)
 * 3. 看看有没有一张**可以复用**的待付款订单(同一批货 + 同一地址 + 同一留言)
 * 4. 解析每一行的 Sellbase 载体变体(**只有旧路需要**)
 * 5. 落 `storefront_order` + `storefront_order_item`
 * 6. 建支付会话(旧路 = Sellbase 订单;新路 = 通道的支付会话)
 * 7. 回写 `payment_channel` + `provider_order_id` + 付款入口
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
   * 车的性质对得上吗(2026-11-06)
   *
   * 商城购物袋和打印单是两张车、两种口径(运费 / 商品)。结算的通道按
   * `cartKind` 选 —— 拿打印单去走商城那条路(或者反过来)会把钱的口径
   * 搞错:打印单多收一笔运费,或者商城订单少了运费。
   *
   * 兜底:认不出来一律当商城购物袋(`normalizeCartKind`)。
   */
  const cartKind = normalizeCartKind(input.cartKind);
  if (cart.kind !== cartKind) {
    throw new CheckoutError(
      "CART_KIND_MISMATCH",
      cartKind === PRINT_CART_KIND
        ? "这不是打印单,不能按打印单结算"
        : "购物袋里没有可结算的商品"
    );
  }

  // 0. 购物车过户
  //
  //    游客购物车在这一刻归到账号名下(以后换设备登录还能找回)。
  //
  //    **必须早于付款** —— 付款成功那一刻要靠 `cart.user_id` 找到「这个人的
  //    购物车」,把买掉的行摘掉。晚了就摘不掉。
  await stampCartOwner(input.cartId, input.userId);

  // 1. 重算每一行
  const lines = cart.items.map(repriceLine);

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
  // 打印单**没有运费**(2026-11-06)—— 打印服务的价就是报价本身:
  // 报价台显示多少、工单上写多少、收多少,是同一个数(见
  // `print-quote/lib/payment.ts`)。到结算时再加一笔运费,用户在报价台
  // 看到的总价跟实际收的钱就对不上了。
  //
  // 规则本身在 `pricing-constants.ts` 的 `shippingCentsForCart()` —— 客户端
  // 的购物袋页 / 打印单页跟这里用**同一份**,不会「页面没运费、结算收了」。
  const shippingCents = shippingCentsForCart(cartKind, discountedSubtotalCents);
  const totalCents = discountedSubtotalCents + shippingCents;

  // 3. 通道
  const channel = resolveCheckoutChannel(input.channel);
  const legacy = channel === "stripe";

  // 4. 复用:同一批货 → 用上一张还没付的单
  //
  //    购物车改成「付款成功才清空」之后,用户没付钱又点一次「去支付」会攒出
  //    两张一样的单 —— 工作室那边多一张永远不付的僵尸单,用户那边可能付了
  //    旧的那张码、系统却标的是新的那张(或者两张都付)。
  //
  //    复用还顺带避免了重复开工单:打印服务行每一次下单都会开一张 `PO-…`,
  //    复用就只开一张。
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
  });
  if (reusable) {
    return reusePendingOrder(reusable, channel);
  }

  // 5. 载体变体 —— **只有旧路需要**
  //
  //    新通道的价是本仓库给的,不经过 Sellbase 的载体变体(所以新通道不
  //    需要把商品目录同步过去)。
  //    打印服务行走**专用**的载体行(「打印服务(按克重)」),不按型号找。
  const carriers = legacy
    ? await Promise.all(
        lines.map(async (line) => {
          try {
            if (getPrintServiceSpec(line.item.metadata)) {
              return await resolvePrintServiceCarrier();
            }
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

  const printOrderNos: string[] = [];

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

    // 打印服务行 → 建工单
    //
    // **在同一个事务里** —— 商城订单和工单要么都成,要么都不成。
    // 「收了钱但没有工单」比「整笔下单失败」更难收拾:钱已经进了收银台,
    // 工作室那边看不到要干的活。
    //
    // 工单的 `sellbase_order_id` 留空 —— 整张购物车共用**一张**支付订单,
    // 而 `print_order.sellbase_order_id` 是唯一索引,挂不上。工单靠
    // `storefront_order_id` 跟商城订单关联,回调标 paid 时按它反查。
    const locale = normalizePrintOrderLocale(input.locale);
    for (const line of lines) {
      const printSpec = getPrintServiceSpec(line.item.metadata);
      if (!printSpec || !line.printQuote) continue;

      const printOrderNo = generatePrintOrderNo();
      await createPrintOrder(
        {
          orderNo: printOrderNo,
          userId: input.userId,
          modelFileName: printSpec.modelFileName,
          modelUrl: printSpec.modelUrl,
          modelSizeBytes: printSpec.modelSizeBytes,
          quote: line.printQuote,
          contactName: input.address.recipientName,
          contactEmail: input.email,
          contactPhone: input.address.phone,
          note: input.note ?? null,
          locale,
          storefrontOrderId: orderId,
          shippingAddress: input.address,
        },
        tx
      );
      printOrderNos.push(printOrderNo);
    }
  });

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
    totalCents,
    currency: PRICE_CURRENCY,
    printOrderNos,
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
    totalCents: reusable.order.totalCents,
    currency: reusable.order.currency,
    printOrderNos: reusable.printOrderNos,
    // 「没配好」和「这次挂了」要分开 —— 前者重试没用(见 `payment-issue.ts`)
    paymentIssue: link.ok
      ? null
      : link.code === "PAYMENT_NOT_CONFIGURED"
        ? "PAYMENT_NOT_CONFIGURED"
        : "PAYMENT_FAILED",
  };
}
