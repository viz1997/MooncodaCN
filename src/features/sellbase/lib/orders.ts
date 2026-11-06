/**
 * Sellbase 订单 —— 建单 / 支付链接 / 找回孤儿单
 *
 * ## 「本仓库算价,Sellbase 只做收银台」
 *
 * 建单时每一行都指向一个**载体变体**(见 `carrier.ts`),真正的价格走
 * `items[].unit_price_amount`。Sellbase 那边看到的目录价是参考值,不是收的价。
 *
 * ## 为什么每次都建新单,而不是复用购物车
 *
 * 本仓库的购物车是自己算价的(刻字 / 加急 / 配件 / 数量阶梯折扣),那些信息
 * 在 Sellbase 的购物车行里**没有地方存**。所以购物车到结算这一步,是本仓库
 * 自己的一串行 → 一次性组装成 Sellbase 的订单行。
 *
 * ## 「订单建了但支付链接没生成」是真实存在的失败态
 *
 * Sellbase 的 `POST /orders` 先把订单写进库(事务提交),**然后**才去 Stripe
 * 建支付链接。Stripe 没连上时,接口报错,但订单已经建好了 —— 而且失败时
 * 服务端会**删掉幂等键**,所以重试会再建一单,在 Sellbase 后台留一张孤儿单。
 *
 * 所以失败路径要**找回**那张单:`findSellbaseOrderByNote()` 按备注里的订单号
 * 把它捞出来,补写 `sellbase_order_id`,然后走 `createPaymentLink()` 补链接。
 */

import type { ShippingAddressSnapshot } from "@/db/schema";

import { callSellbase, getSellbaseAdmin } from "./client";
import { getSiteUrl } from "./env";

/** Sellbase 建单的行 */
export interface SellbaseOrderLine {
  /** 载体变体 id(uuid) */
  variantId: string;
  /** 数量 */
  quantity: number;
  /** 单价(最小货币单位)—— 本仓库算出来的价,覆盖目录价 */
  unitPriceAmount: number;
}

/** 建单入参 */
export interface CreateSellbaseOrderInput {
  /** 下单邮箱 —— Sellbase 按 email upsert customer */
  email: string;
  /** 订单行 */
  items: SellbaseOrderLine[];
  /** 运费(最小货币单位) */
  shippingAmount: number;
  /** 收货地址 */
  shippingAddress?: ShippingAddressSnapshot | null;
  /** 备注 —— 工作室在 Sellbase 后台直接看到要点 */
  note?: string | null;
  /** 付款后回跳地址 */
  successUrl: string;
  /** 要不要让 Sellbase 给客户发确认邮件 */
  notifyCustomer: boolean;
}

/** 建单结果 */
export interface CreatedSellbaseOrder {
  /** Sellbase 订单 id */
  orderId: string;
  /** Sellbase 订单号(给人看的) */
  orderNumber: number;
  /** 支付链接 —— null 表示订单建了但链接没生成 */
  paymentUrl: string | null;
  /** 客户 id —— 回填到 user.sellbaseCustomerId */
  customerId: string | null;
  /** 是不是「找回」的孤儿单 */
  recovered: boolean;
}

/** 建单失败(而且没找到孤儿单) */
export class SellbaseOrderCreationError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "SellbaseOrderCreationError";
  }
}

/**
 * 建一个 Sellbase 订单(收银台模式)
 *
 * `payment.mode = "link"` —— 订单进 `pending_payment`,返回 Stripe 支付链接。
 * 不用 `"paid"` 模式:那个模式是「钱已经收到了」(现金 / 转账),而且需要
 * `confirm: true`。
 */
export async function createSellbaseOrder(
  input: CreateSellbaseOrderInput
): Promise<CreatedSellbaseOrder> {
  const client = getSellbaseAdmin();

  try {
    const result = await callSellbase(() =>
      client.request("orderCreate", {
        body: {
          email: input.email,
          items: input.items.map((line) => ({
            variant_id: line.variantId,
            quantity: line.quantity,
            unit_price_amount: line.unitPriceAmount,
          })),
          shipping_amount: input.shippingAmount,
          ...(input.shippingAddress
            ? { shipping_address: toSellbaseAddress(input.shippingAddress) }
            : {}),
          ...(input.note ? { note: input.note } : {}),
          payment: { mode: "link", success_url: input.successUrl },
          notify_customer: input.notifyCustomer,
        },
      })
    );

    return {
      orderId: result.order.id,
      orderNumber: result.order.number,
      paymentUrl: result.payment_url,
      customerId: result.order.customer_id,
      recovered: false,
    };
  } catch (error) {
    // 订单可能已经建好了(Stripe 那步失败)—— 找回来,别建第二单
    const orphan = await findSellbaseOrderByNote(input.email, input.note);
    if (orphan) {
      return {
        orderId: orphan.id,
        orderNumber: orphan.number,
        paymentUrl: null,
        customerId: orphan.customer_id,
        recovered: true,
      };
    }
    throw new SellbaseOrderCreationError(
      error instanceof Error ? error.message : "Sellbase 建单失败",
      error
    );
  }
}

/**
 * 按备注里的标记找回一张 Sellbase 订单
 *
 * `POST /orders` 没有「按备注查」的接口,只能先按邮箱列出该用户的订单,再逐个
 * 取详情看备注。只在**建单失败**的路径上跑,所以慢一点没关系。
 *
 * 备注里带订单号 —— 那是本仓库和 Sellbase 之间的唯一关联标记(除了
 * `sellbase_order_id` 那一列,但那一列在失败时还没写)。
 */
export async function findSellbaseOrderByNote(
  email: string,
  note: string | null | undefined
): Promise<{
  id: string;
  number: number;
  customer_id: string | null;
  notes: string | null;
} | null> {
  if (!note) return null;

  const client = getSellbaseAdmin();

  let rows: Array<{ id: string }>;
  try {
    const list = await callSellbase(() =>
      client.request("ordersList", {
        query: { q: email, status: "pending_payment", limit: 20 },
      })
    );
    rows = list.data;
  } catch {
    return null;
  }

  for (const row of rows) {
    try {
      const detail = await callSellbase(() =>
        client.request("orderGet", { params: { id: row.id } })
      );
      if (detail.notes?.includes(note)) {
        return {
          id: detail.id,
          number: detail.number,
          customer_id: detail.customer_id,
          notes: detail.notes,
        };
      }
    } catch {}
  }

  return null;
}

/**
 * 给已有订单补一个支付链接
 *
 * 支付链接会过期(Stripe 那边 23 小时),用户回到详情页发现链接失效时用这个换新的。
 */
export async function createSellbasePaymentLink(
  orderId: string,
  successUrl?: string
): Promise<string> {
  const client = getSellbaseAdmin();
  const result = await callSellbase(() =>
    client.request("orderPaymentLink", {
      params: { id: orderId },
      body: {
        ...(successUrl ? { success_url: successUrl } : {}),
      },
    })
  );
  return result.url;
}

/**
 * 收款成功之后回跳的地址
 *
 * 默认落在「我的打印订单」页 —— 用户从哪儿付完钱就回哪儿。
 */
export function buildPrintOrderSuccessUrl(orderNo: string): string {
  return `${getSiteUrl()}/account/print-orders/${orderNo}?paid=1`;
}

/**
 * 本地地址 → Sellbase 的 `shipping_address`
 *
 * Sellbase 那边的结构是欧美的(line1 / city / postal_code / country),本仓库是
 * 中国的(省 / 市 / 区 / 详细地址)。这里做一次映射:
 *
 * - `line1` = 详细地址
 * - `line2` = 区
 * - `city` = 市
 * - `state` = 省
 * - `postal_code` = 固定 `000000` —— Sellbase 那边是必填,但本仓库不收邮编
 * - `country` = `CN`
 *
 * 返回类型写死成 SDK 期望的形状 —— `Record<string, string>` 过不了类型检查
 * (SDK 那边的必填字段会被 `Record` 放宽掉)。
 */
export interface SellbaseShippingAddress {
  line1: string;
  city: string;
  postal_code: string;
  country: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  line2?: string;
  state?: string;
  phone?: string;
}

export function toSellbaseAddress(
  address: ShippingAddressSnapshot
): SellbaseShippingAddress {
  return {
    first_name: address.recipientName,
    phone: address.phone,
    line1: address.detail,
    line2: address.district,
    city: address.city,
    state: address.province,
    postal_code: "000000",
    country: "CN",
  };
}
