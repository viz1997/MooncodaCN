/**
 * 打印工单的收款
 *
 * ## 钱的走向
 *
 * ```
 * 用户下单 → 本地落 print_order(unpaid)
 *          → Sellbase 建单(mode:"link")→ Stripe 支付链接
 *          → 用户付钱 → Sellbase 发 webhook → 本地标 paid
 * ```
 *
 * 线上线下**两条腿**:
 * - 线上(Stripe):Sellbase 收钱,webhook 回写状态
 * - 线下(转账):工作室后台点「标记已收款」,本地标 paid + `payment_channel="offline"`
 *
 * 线下单**不建** Sellbase 订单 —— 建了会让两边的订单数对不上,而且工作室
 * 会在 Sellbase 后台看到一张永远收不到钱的单。
 *
 * ## 没配 Sellbase 也能下单
 *
 * 没配 / 没同步目录时,工单照样建,只是没有支付链接,`payment_status` 停在
 * `unpaid`。工作室走线下收款。**下单接口不能因为收款通道没配好就挂掉** ——
 * 那是把一个配置问题变成一条断掉的业务链。
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { type PrintOrderRow, printOrder } from "@/db/schema";
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
 * 给工单建 Sellbase 订单 + 拿支付链接
 *
 * 失败**不抛** —— 调用方要的是「有没有链接」,不是「为什么失败」。失败原因
 * 记日志,订单本身已经在本地建好了。
 */
export async function createPrintOrderPayment(
  order: PrintOrderRow
): Promise<{ sellbaseOrderId: string; paymentUrl: string | null } | null> {
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
    sellbaseOrderId: created.orderId,
    paymentUrl: created.paymentUrl,
  };
}

/** 补一个支付链接的结果 */
export type PaymentLinkResult =
  | { ok: true; paymentUrl: string }
  | {
      ok: false;
      code:
        | "SELLBASE_NOT_CONFIGURED"
        | "ORDER_NOT_FOUND"
        | "ALREADY_PAID"
        | "LINK_FAILED";
    };

/**
 * 拿(或者重拿)支付链接
 *
 * 两种情况:
 * - 本地还没有 Sellbase 订单 → 现建一个
 * - 有 Sellbase 订单但链接过期 → `POST /orders/:id/payment-link` 换新的
 *
 * 已经付过的不给链接 —— 付完了还让人付一次是事故。
 */
export async function ensurePrintOrderPaymentLink(
  order: PrintOrderRow
): Promise<PaymentLinkResult> {
  if (order.paymentStatus === "paid") {
    return { ok: false, code: "ALREADY_PAID" };
  }

  // 收款通道没配好 —— 后面所有调用都会失败,直接说清楚
  //
  // 注意这**不拦下单**:工单照样建(见本文件头「没配 Sellbase 也能下单」),
  // 工作室走线下收款。这里只是别让用户以为「再点一次就能拿到链接」。
  if (!isSellbaseConfigured()) {
    return { ok: false, code: "SELLBASE_NOT_CONFIGURED" };
  }

  // 已经有链接就直接用 —— Stripe 的链接 23 小时内有效,大多数时候够
  if (order.paymentUrl && order.sellbaseOrderId) {
    return { ok: true, paymentUrl: order.paymentUrl };
  }

  if (!order.sellbaseOrderId) {
    const created = await createPrintOrderPayment(order);
    if (!created?.paymentUrl) {
      return { ok: false, code: "LINK_FAILED" };
    }
    return { ok: true, paymentUrl: created.paymentUrl };
  }

  try {
    const url = await createSellbasePaymentLink(order.sellbaseOrderId);
    await db
      .update(printOrder)
      .set({ paymentUrl: url, updatedAt: new Date() })
      .where(eq(printOrder.id, order.id));
    return { ok: true, paymentUrl: url };
  } catch (error) {
    console.error(`[print-quote] ${order.orderNo} 重取支付链接失败`, error);
    if (error instanceof SellbaseNotConfiguredError) {
      return { ok: false, code: "SELLBASE_NOT_CONFIGURED" };
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
  if (order.paymentChannel === "stripe") {
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
