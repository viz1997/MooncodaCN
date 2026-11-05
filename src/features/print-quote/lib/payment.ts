/**
 * 打印工单的收款
 *
 * ## 钱的走向
 *
 * ```
 * 用户下单 → 本地落 print_order(unpaid)
 *          → 建一次支付会话(三个新通道之一,或旧路的 Sellbase)
 *          → 用户付钱 → 通道回调 → 本地标 paid
 * ```
 *
 * 线上线下**两条腿**:
 * - 线上:微信扫码 / 支付宝跳页 / Shopify 付款页(旧路:Sellbase + Stripe)
 * - 线下(转账):工作室后台点「标记已收款」,本地标 paid + `payment_channel="offline"`
 *
 * 线下单**不建**支付会话 —— 建了会让两边的订单数对不上,而且工作室
 * 会在支付后台看到一张永远收不到钱的单。
 *
 * ## 两条收款路线(2026-11-05)
 *
 * | `payment_channel` | 走哪条 |
 * |---|---|
 * | `wechat` / `alipay` / `shopify` | 新路:按通道建一次支付会话 |
 * | `stripe` / null | 旧路:Sellbase 订单 + Stripe 链接(过渡期并行) |
 *
 * 新路的通道**不参与定价** —— 工单的 `total_price_cents` 是下单那一刻
 * 服务端重算出来的总价,建会话时直接当单价传出去,一分不多一分不少。
 *
 * ## 没配收款通道也能下单
 *
 * 没配 / 没同步目录时,工单照样建,只是没有支付入口,`payment_status` 停在
 * `unpaid`。工作室走线下收款。**下单接口不能因为收款通道没配好就挂掉** ——
 * 那是把一个配置问题变成一条断掉的业务链。
 */

import { and, eq } from "drizzle-orm";
import { PRICE_CURRENCY } from "@/config/currency";
import { db } from "@/db";
import { type PrintOrderRow, printOrder } from "@/db/schema";
import {
  getPaymentProvider,
  isPaymentChannelEnabled,
  listAvailablePaymentChannels,
} from "@/features/payments/lib/registry";
import type {
  OnlinePaymentChannel,
  PaymentRequest,
} from "@/features/payments/lib/types";
import {
  CarrierNotFoundError,
  type CarrierVariant,
  resolvePrintServiceCarrier,
} from "@/features/sellbase/lib/carrier";
import {
  isSellbaseConfigured,
  SELLBASE_CURRENCY,
  SELLBASE_FX_RATE,
  SellbaseNotConfiguredError,
} from "@/features/sellbase/lib/env";
import {
  centsToStoreAmount,
  getCurrencyConversion,
} from "@/features/sellbase/lib/money";
import {
  buildPrintOrderSuccessUrl,
  type CreatedSellbaseOrder,
  createSellbaseOrder,
  createSellbasePaymentLink,
} from "@/features/sellbase/lib/orders";

import { classifyPaymentIssue } from "@/features/storefront/lib/payment-issue";

/** 工单的收款状态 —— 跟 DB 列的枚举同名 */
export type {
  PrintOrderPaymentChannel,
  PrintOrderPaymentStatus,
} from "./quote-types";

/**
 * 备注 —— 工作室在 Sellbase 后台直接看到工单要点
 *
 * 第一段是订单号:它是本仓库和 Sellbase 之间的**唯一**关联标记(建单失败
 * 时的「找回孤儿单」靠它,见 `sellbase/lib/orders.ts`)。
 */
export function buildPrintOrderSellbaseNote(order: {
  orderNo: string;
  materialWeightG: string | number;
  supportWeightG: string | number | null;
  dimX: string | number;
  dimY: string | number;
  dimZ: string | number;
}): string {
  const parts = [order.orderNo];
  parts.push(`耗材 ${round1(order.materialWeightG)} g`);
  if (order.supportWeightG !== null && order.supportWeightG !== undefined) {
    parts.push(`支撑 ${round1(order.supportWeightG)} g`);
  }
  parts.push(
    `尺寸 ${round1(order.dimX)}×${round1(order.dimY)}×${round1(order.dimZ)} mm`
  );
  return parts.join(" · ");
}

function round1(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  return (Math.round(n * 10) / 10).toFixed(1);
}

/**
 * 给工单建一次支付会话
 *
 * ## 走哪条通道
 *
 * - 指定了通道 → 用它(得是「开放了」的,见
 *   `ENABLED_PAYMENT_CHANNELS`)
 * - 没指定 → 第一个「开放了而且配好了」的通道
 * - 一个都没有 → **返回 null**(走线下收款,工作室后台点「标记已收款」)
 *
 * 旧路(Sellbase + Stripe)不再接**新**工单 —— 代码还留着(已建好的旧工单
 * 还能重取支付入口),但新单不走它。
 *
 * 失败**不抛** —— 调用方要的是「有没有入口」,不是「为什么失败」。失败原因
 * 记日志,订单本身已经在本地建好了。
 */
export async function createPrintOrderPayment(
  order: PrintOrderRow,
  channel?: OnlinePaymentChannel | null
): Promise<PrintOrderPaymentSession | null> {
  const resolved =
    channel && isPaymentChannelEnabled(channel)
      ? channel
      : (listAvailablePaymentChannels()[0]?.channel ?? null);

  if (!resolved) {
    console.error(
      `[print-quote] ${order.orderNo} 没有可用的线上收款通道 —— 走线下收款`
    );
    return null;
  }

  return createNewChannelPrintOrderPayment(order, resolved);
}

/**
 * 新路 —— 按通道建一次支付会话
 *
 * **单价是工单总价**(下单那一刻服务端重算出来的),不是重新报价 —— 用户
 * 下单时同意的就是那个价。
 */
async function createNewChannelPrintOrderPayment(
  order: PrintOrderRow,
  channel: OnlinePaymentChannel
): Promise<PrintOrderPaymentSession | null> {
  const provider = getPaymentProvider(channel);
  if (!provider || !provider.isConfigured()) {
    console.error(
      `[print-quote] ${order.orderNo} 收款通道 ${channel} 没配置好 —— 走线下收款`
    );
    return null;
  }

  const request = buildPrintOrderPaymentRequest(order);

  try {
    const session = await provider.createSession(request);

    await db
      .update(printOrder)
      .set({
        paymentChannel: channel,
        providerOrderId: session.providerOrderId,
        paymentUrl: session.redirectUrl,
        paymentQrCodeUrl: session.qrCodeUrl,
        updatedAt: new Date(),
      })
      .where(eq(printOrder.id, order.id));

    return {
      channel,
      providerOrderId: session.providerOrderId,
      paymentUrl: session.redirectUrl,
      paymentQrCodeUrl: session.qrCodeUrl,
    };
  } catch (error) {
    console.error(
      `[print-quote] ${order.orderNo} 建 ${channel} 支付会话失败`,
      error
    );
    return null;
  }
}

/**
 * 工单 → 支付请求
 *
 * 工单是「一活一模型」,所以只有**一行**,单价 = 总价,数量 = 1,运费 = 0。
 * 克重 / 尺寸那些塞进 `attributes`,各通道自己决定怎么用(Shopify 落成行
 * 属性,微信/支付宝塞进商品描述)。
 */
function buildPrintOrderPaymentRequest(order: PrintOrderRow): PaymentRequest {
  const address = order.shippingAddress;
  return {
    orderNo: order.orderNo,
    email: order.contactEmail,
    items: [
      {
        title: "3D 打印服务",
        quantity: 1,
        unitPriceCents: order.totalPriceCents,
        sku: order.orderNo,
        attributes: {
          耗材克重: `${round1(order.materialWeightG)} g`,
          支撑克重:
            order.supportWeightG === null || order.supportWeightG === undefined
              ? "-"
              : `${round1(order.supportWeightG)} g`,
          尺寸: `${round1(order.dimX)}×${round1(order.dimY)}×${round1(order.dimZ)} mm`,
        },
      },
    ],
    shippingCents: 0,
    shippingAddress: address
      ? {
          recipientName: address.recipientName,
          phone: address.phone,
          province: address.province,
          city: address.city,
          district: address.district,
          detail: address.detail,
        }
      : null,
    note: order.note ?? "",
    successUrl: buildPrintOrderSuccessUrl(order.orderNo),
    currency: PRICE_CURRENCY,
  };
}

/**
 * 旧路 —— 给工单建 Sellbase 订单 + 拿支付链接
 *
 * 过渡期保留,跑通新通道后拆。
 */
async function createLegacyPrintOrderPayment(
  order: PrintOrderRow
): Promise<PrintOrderPaymentSession | null> {
  let carrier: CarrierVariant;
  try {
    carrier = await resolvePrintServiceCarrier();
  } catch (error) {
    if (error instanceof CarrierNotFoundError) {
      console.error(
        `[print-quote] ${order.orderNo} 没有 Sellbase 载体变体 —— 先跑 scripts/sync-sellbase-catalog.ts`
      );
      return null;
    }
    throw error;
  }

  const conversion = getCurrencyConversion(SELLBASE_CURRENCY, SELLBASE_FX_RATE);
  const note = buildPrintOrderSellbaseNote(order);

  let created: CreatedSellbaseOrder;
  try {
    created = await createSellbaseOrder({
      email: order.contactEmail,
      items: [
        {
          variantId: carrier.variantId,
          quantity: 1,
          unitPriceAmount: centsToStoreAmount(
            order.totalPriceCents,
            conversion
          ),
        },
      ],
      shippingAmount: 0,
      shippingAddress: order.shippingAddress ?? null,
      note,
      // 付完钱回跳到工单详情页 —— 用户从哪儿付就回哪儿
      successUrl: buildPrintOrderSuccessUrl(order.orderNo),
      // 邮件本仓库自己发(下单通知、状态变更)—— 别让 Sellbase 再发一遍
      notifyCustomer: false,
    });
  } catch (error) {
    console.error(`[print-quote] ${order.orderNo} 建 Sellbase 订单失败`, error);
    return null;
  }

  await db
    .update(printOrder)
    .set({
      sellbaseOrderId: created.orderId,
      paymentUrl: created.paymentUrl,
      // 渠道是「线上」—— 但这**不是**「已付款」,收款状态仍然是 unpaid。
      // 渠道说的是「这单走的是线上那条路」,状态说的是「钱到没到」。
      //
      // 工作室后来走线下收了款,`markPrintOrderPaidOffline()` 会把它改成
      // `offline` —— 那时线上链接作废,撤销收款也只允许撤线下的。
      paymentChannel: "stripe",
      updatedAt: new Date(),
    })
    .where(eq(printOrder.id, order.id));

  return {
    channel: "stripe",
    providerOrderId: created.orderId,
    paymentUrl: created.paymentUrl,
    paymentQrCodeUrl: null,
  };
}

/**
 * 一次支付会话的结果
 *
 * 「付款入口」不止是链接 —— 微信 Native 是**扫码**,二维码内容是
 * `paymentQrCodeUrl`。两个字段有一个不是 null 就算成功。
 */
export interface PrintOrderPaymentSession {
  /** 走的是哪条通道 */
  channel: OnlinePaymentChannel;
  /** 支付平台侧的订单号(回调反查用) */
  providerOrderId: string | null;
  /** 跳转地址(微信是 null —— 微信是扫码) */
  paymentUrl: string | null;
  /** 微信扫码的二维码内容 */
  paymentQrCodeUrl: string | null;
}

/**
 * 新路的三个通道 —— **不含**过渡期的 `stripe`
 *
 * 类型谓词只认这三个:`stripe` 走旧路(Sellbase + Stripe),`offline` 是线下
 * 收款,两者都不是「新通道」。
 */
function isNewChannel(
  channel: string | null | undefined
): channel is "wechat" | "alipay" | "shopify" {
  return channel === "wechat" || channel === "alipay" || channel === "shopify";
}

/** 补一个支付链接的结果 */
export type PaymentLinkResult =
  | {
      ok: true;
      /** 跳转地址(微信是 null —— 微信是扫码) */
      paymentUrl: string | null;
      /** 微信扫码的二维码内容 */
      paymentQrCodeUrl: string | null;
    }
  | {
      ok: false;
      code:
        | "PAYMENT_NOT_CONFIGURED"
        | "ORDER_NOT_FOUND"
        | "ALREADY_PAID"
        | "LINK_FAILED";
    };

/**
 * 拿(或者重拿)付款入口
 *
 * 分两条路:
 * - 新路(微信 / 支付宝 / Shopify)—— 按工单存下来的总价重建一次会话
 * - 旧路(Sellbase + Stripe)—— 本地还没有 Sellbase 订单就现建一个,
 *   有但链接过期就换新的
 *
 * 已经付过的不给入口 —— 付完了还让人付一次是事故。
 *
 * ## 重建时用**存下来的**总价,不重新报价
 *
 * `total_price_cents` 是下单那一刻服务端重算出来的总价。重建会话时用它
 * 当单价 —— 用户下单时同意的就是那个价,后来改了定价规则也不该让他的
 * 订单变贵(或者变便宜)。
 */
export async function ensurePrintOrderPaymentLink(
  order: PrintOrderRow
): Promise<PaymentLinkResult> {
  if (order.paymentStatus === "paid") {
    return { ok: false, code: "ALREADY_PAID" };
  }

  // 新路(微信 / 支付宝 / Shopify)—— 跟旧路完全分开
  if (isNewChannel(order.paymentChannel)) {
    return ensureNewChannelPrintOrderPaymentLink(order, order.paymentChannel);
  }

  // `payment_channel` 是 null 的单 = 建单时压根没定通道(当时没有可用的线上
  // 通道)。这种单按**新路**处理 —— 走第一个「开放了而且配好了」的通道。
  if (order.paymentChannel === null) {
    const fallback = listAvailablePaymentChannels()[0];
    if (!fallback) {
      return { ok: false, code: "PAYMENT_NOT_CONFIGURED" };
    }
    return ensureNewChannelPrintOrderPaymentLink(order, fallback.channel);
  }

  // `offline` 的单是**线下**收款(工作室后台手动标的)—— 不给线上入口。
  //
  // 正常情况下这种单已经是「已付款」了(上面就返回 ALREADY_PAID),走到这里
  // 说明状态被改过 —— 那也不能给它塞一条线上付款链接。
  if (order.paymentChannel === "offline") {
    return { ok: false, code: "PAYMENT_NOT_CONFIGURED" };
  }

  // 旧路:Sellbase + Stripe(过渡期并行)
  //
  // 收款通道没配好 —— 后面所有调用都会失败,直接说清楚
  //
  // 注意这**不拦下单**:工单照样建(见本文件头「没配收款通道也能下单」),
  // 工作室走线下收款。这里只是别让用户以为「再点一次就能拿到链接」。
  if (!isSellbaseConfigured()) {
    return { ok: false, code: "PAYMENT_NOT_CONFIGURED" };
  }

  // 已经有链接就直接用 —— Stripe 的链接 23 小时内有效,大多数时候够
  if (order.paymentUrl && order.sellbaseOrderId) {
    return { ok: true, paymentUrl: order.paymentUrl, paymentQrCodeUrl: null };
  }

  if (!order.sellbaseOrderId) {
    const created = await createLegacyPrintOrderPayment(order);
    if (!created?.paymentUrl) {
      return { ok: false, code: "LINK_FAILED" };
    }
    return { ok: true, paymentUrl: created.paymentUrl, paymentQrCodeUrl: null };
  }

  try {
    const url = await createSellbasePaymentLink(order.sellbaseOrderId);
    await db
      .update(printOrder)
      .set({ paymentUrl: url, updatedAt: new Date() })
      .where(eq(printOrder.id, order.id));
    return { ok: true, paymentUrl: url, paymentQrCodeUrl: null };
  } catch (error) {
    console.error(`[print-quote] ${order.orderNo} 重取支付链接失败`, error);
    if (error instanceof SellbaseNotConfiguredError) {
      return { ok: false, code: "PAYMENT_NOT_CONFIGURED" };
    }
    return { ok: false, code: "LINK_FAILED" };
  }
}

/**
 * 新路 —— 重建一次支付会话
 *
 * 用**存下来的**总价,不重新报价(理由见函数头)。
 */
async function ensureNewChannelPrintOrderPaymentLink(
  order: PrintOrderRow,
  channel: OnlinePaymentChannel
): Promise<PaymentLinkResult> {
  const provider = getPaymentProvider(channel);
  if (!provider || !provider.isConfigured()) {
    return { ok: false, code: "PAYMENT_NOT_CONFIGURED" };
  }

  // 已经有入口了就直接用
  //
  // 微信的 `code_url` 两小时内有效(订单本身两小时过期),大多数时候够;
  // 支付宝 / Shopify 的跳转地址重新建一个也不费事,但复用更省一次调用。
  if (order.paymentUrl || order.paymentQrCodeUrl) {
    return {
      ok: true,
      paymentUrl: order.paymentUrl,
      paymentQrCodeUrl: order.paymentQrCodeUrl,
    };
  }

  try {
    const session = await provider.createSession(
      buildPrintOrderPaymentRequest(order)
    );

    await db
      .update(printOrder)
      .set({
        providerOrderId: session.providerOrderId,
        paymentUrl: session.redirectUrl,
        paymentQrCodeUrl: session.qrCodeUrl,
        // 工单上原本没记通道的(建单那一刻没有可用的线上通道)—— 把这次用的
        // 通道记下来。下次再取入口走的是同一条通道,不会换。
        ...(order.paymentChannel ? {} : { paymentChannel: channel }),
        updatedAt: new Date(),
      })
      .where(eq(printOrder.id, order.id));

    if (!session.redirectUrl && !session.qrCodeUrl) {
      return { ok: false, code: "LINK_FAILED" };
    }
    return {
      ok: true,
      paymentUrl: session.redirectUrl,
      paymentQrCodeUrl: session.qrCodeUrl,
    };
  } catch (error) {
    console.error(
      `[print-quote] ${order.orderNo} 重建 ${channel} 支付会话失败`,
      error
    );
    if (classifyPaymentIssue(error) === "PAYMENT_NOT_CONFIGURED") {
      return { ok: false, code: "PAYMENT_NOT_CONFIGURED" };
    }
    return { ok: false, code: "LINK_FAILED" };
  }
}

/**
 * 线下收款 —— 工作室后台「标记已收款」
 *
 * 幂等:已经付过就当无事发生(返回 false,不是错误 —— 后台连点两下不该报错)。
 */
export async function markPrintOrderPaidOffline(
  orderNo: string
): Promise<{ ok: boolean; alreadyPaid: boolean }> {
  const rows = await db
    .select()
    .from(printOrder)
    .where(eq(printOrder.orderNo, orderNo))
    .limit(1);
  const order = rows[0];
  if (!order) return { ok: false, alreadyPaid: false };
  if (order.paymentStatus === "paid") return { ok: true, alreadyPaid: true };

  await db
    .update(printOrder)
    .set({
      paymentStatus: "paid",
      paymentChannel: "offline",
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(printOrder.id, order.id));

  return { ok: true, alreadyPaid: false };
}

/**
 * 撤销线下收款 —— 防误点
 *
 * 线上付款**不能**走这条路:钱已经进账了,本地标成未付只会让两边对不上。
 */
export async function revokePrintOrderOfflinePayment(
  orderNo: string
): Promise<{ ok: boolean; code?: "ORDER_NOT_FOUND" | "ONLINE_PAYMENT" }> {
  const rows = await db
    .select()
    .from(printOrder)
    .where(eq(printOrder.orderNo, orderNo))
    .limit(1);
  const order = rows[0];
  if (!order) return { ok: false, code: "ORDER_NOT_FOUND" };
  // 线上付过款的单不能走这条路 —— 钱已经进账了,本地标成未付只会让两边对不上。
  //
  // 旧路是 `stripe`,新路是微信 / 支付宝 / Shopify —— 四个都算「线上」。
  if (order.paymentChannel && order.paymentChannel !== "offline") {
    return { ok: false, code: "ONLINE_PAYMENT" };
  }

  await db
    .update(printOrder)
    .set({
      paymentStatus: "unpaid",
      paymentChannel: null,
      paidAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(printOrder.id, order.id)));

  return { ok: true };
}

/**
 * 未收款不许开工 —— 状态门槛的判定
 *
 * 纯函数,好单测(见 `src/test/print-quote/pure/payment-gate.test.ts`)。
 */
export function canStartProduction(paymentStatus: string): boolean {
  return paymentStatus === "paid";
}
