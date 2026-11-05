/**
 * 商城结算 —— 服务端
 *
 * ## 「本仓库算价,Sellbase 只做收银台」在这条链上的落法
 *
 * ```
 * 购物车(DB)→ 服务端重算每一行的价 → 落 storefront_order(_item)
 *            → 建 Sellbase 订单(items[].unit_price_amount = 折后单价)
 *            → 回写 sellbase_order_id + payment_url → 前端跳 Stripe
 *            → webhook 回写 status=paid
 * ```
 *
 * ## 服务端**不信**客户端带来的价
 *
 * 购物车里存的单价只是缓存(`cart_item.unit_price_cents`)。结算这一步
 * 把每一行按 `metadata` 重新算一遍 —— 定价规则(配件加价 / 基础价 / 阶梯
 * 折扣)改了之后,存量购物车带着旧价,直接收就是收错了。
 *
 * ## 先落本地订单,再建 Sellbase 订单
 *
 * 顺序不能反:本地订单是「订单事实」,Sellbase 订单是「收款载体」。Sellbase
 * 那边挂了(网络 / 配置 / Stripe 没连上),订单已经在了,状态停在 `unpaid`,
 * 用户还能在详情页重取支付链接。反过来的话就变成「收了钱但没有订单」。
 *
 * ## 逐分相等
 *
 * Sellbase 的行合计 = `unit_price_amount × quantity`。本仓库的口径是
 * 「先折单价,再乘数量」(`discountedUnitPriceCents × quantity`),两边
 * **逐分相等**(见 `pricing.ts` 的文件头)。
 */

import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db } from "@/db";
import {
  type ShippingAddressSnapshot,
  storefrontOrder,
  storefrontOrderItem,
} from "@/db/schema";
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
import { clearCartItems, getCart, stampCartOwner } from "./cart-store";
import { findProductById } from "./mock-catalog";
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
}

/** 结算成功的返回 */
export interface CheckoutSuccess {
  /** 本地订单号 */
  orderNo: string;
  /** Stripe 支付链接 —— null 表示 Sellbase 那边没给链接(订单还在,状态 unpaid) */
  paymentUrl: string | null;
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
}

export type CheckoutErrorCode =
  | "CART_NOT_FOUND"
  | "CART_EMPTY"
  | "PRICING_FAILED"
  | "CARRIER_NOT_FOUND"
  | "SELLBASE_FAILED"
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
interface PricedLine {
  item: CartLineItem;
  /** 折后单价(分) */
  discountedUnitPriceCents: number;
  /** 折前单价(分) */
  unitPriceCents: number;
  /** 行合计(分) */
  lineTotalCents: number;
}

/**
 * 按 metadata 重算一行
 *
 * 算不出来就抛 —— 结算的时候不能「按旧价收」,也不能「按 0 收」。
 * 用户会看到「这件商品的价格算不出来,请刷新购物车」,把那一行删掉重下。
 */
function repriceLine(item: CartLineItem): PricedLine {
  const product = findProductById(item.productId);
  if (!product) {
    throw new CheckoutError(
      "PRICING_FAILED",
      `商品 ${item.productId} 已经不在目录里了`
    );
  }

  const metadata = item.metadata;

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
  };
}

/* -------------------------------------------------------------------------- */
/*  结算                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 结算
 *
 * 步骤:
 * 1. 读购物车 → 重算每一行的价
 * 2. 解析每一行的 Sellbase 载体变体
 * 3. 落 `storefront_order` + `storefront_order_item`
 * 4. 建 Sellbase 订单(收银台模式)
 * 5. 回写 `sellbase_order_id` + `payment_url`,清空购物车
 */
export async function checkout(input: CheckoutInput): Promise<CheckoutSuccess> {
  const cart = await getCart(input.cartId);
  if (!cart) {
    throw new CheckoutError("CART_NOT_FOUND", "购物车不存在或已过期");
  }
  if (cart.items.length === 0) {
    throw new CheckoutError("CART_EMPTY", "购物车是空的");
  }

  // 1. 重算每一行
  const lines = cart.items.map(repriceLine);

  // 2. 金额
  const subtotalCents = lines.reduce(
    (sum, l) => sum + l.unitPriceCents * l.item.quantity,
    0
  );
  const discountedSubtotalCents = lines.reduce(
    (sum, l) => sum + l.lineTotalCents,
    0
  );
  const discountCents = subtotalCents - discountedSubtotalCents;
  // 免运费门槛按**折后**金额算 —— 用户看到的、付的小计就是折后那个
  const shippingCents = calculateShippingCents(discountedSubtotalCents);
  const totalCents = discountedSubtotalCents + shippingCents;

  // 3. 载体变体 —— 每个商品型号一个
  const carriers = await Promise.all(
    lines.map(async (line) => {
      const product = findProductById(line.item.productId);
      const productCode = product?.productTypeCode ?? "";
      const sizeCode = sizeCodeFromSpecSizeId(line.item.metadata.sizeId);
      try {
        return await resolveCarrierVariant({ productCode, sizeCode });
      } catch (error) {
        if (error instanceof CarrierNotFoundError) {
          throw new CheckoutError("CARRIER_NOT_FOUND", error.message);
        }
        throw error;
      }
    })
  );

  // 4. 落本地订单
  const orderNo = generateStorefrontOrderNo();
  const orderId = `so_${nanoid(16)}`;
  const now = new Date();

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
      currency: "CNY",
      shippingAddress: input.address,
      note: input.note ?? null,
      createdAt: now,
      updatedAt: now,
    });

    for (const [index, line] of lines.entries()) {
      const carrier = carriers[index];
      if (!carrier) continue;
      await tx.insert(storefrontOrderItem).values({
        id: `soi_${nanoid(16)}`,
        orderId,
        productId: line.item.productId,
        productHandle: line.item.productHandle,
        productTitle: line.item.productTitle,
        productThumbnail: line.item.productThumbnail || null,
        variantId: carrier.variantId,
        sku: carrier.sku,
        unitPriceCents: line.unitPriceCents,
        discountedUnitPriceCents: line.discountedUnitPriceCents,
        quantity: line.item.quantity,
        lineTotalCents: line.lineTotalCents,
        metadata: line.item.metadata as unknown as Record<string, unknown>,
        createdAt: now,
      });
    }
  });

  // 5. 建 Sellbase 订单(收银台)
  const conversion = getCurrencyConversion(SELLBASE_CURRENCY, SELLBASE_FX_RATE);
  const note = buildStorefrontSellbaseNote({
    orderNo,
    lines: lines.map((l) => ({
      title: l.item.productTitle,
      quantity: l.item.quantity,
    })),
  });

  let paymentUrl: string | null = null;
  let sellbaseOrderId: string | null = null;

  try {
    const created = await createSellbaseOrder({
      email: input.email,
      items: lines.map((line, index) => ({
        variantId: carriers[index]!.variantId,
        quantity: line.item.quantity,
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
  }

  // 6. 回写
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

  // 7. 购物车过户 + 清空
  //    「过户」先做 —— 游客购物车在这一刻归到账号名下(以后换设备登录还能找回)。
  //    清空放在最后:建单失败时用户还能回到购物车重试。
  await stampCartOwner(input.cartId, input.userId);
  await clearCartItems(input.cartId);

  return {
    orderNo,
    paymentUrl,
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents,
    currency: "CNY",
  };
}

/* -------------------------------------------------------------------------- */
/*  备注 / 回跳地址                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Sellbase 备注 —— 工作室在后台直接看到要点
 *
 * 第一段是订单号:它是本仓库和 Sellbase 之间的**唯一**关联标记(建单失败
 * 时的「找回孤儿单」靠它,见 `sellbase/lib/orders.ts`)。
 */
export function buildStorefrontSellbaseNote(input: {
  orderNo: string;
  lines: Array<{ title: string; quantity: number }>;
}): string {
  const parts = [input.orderNo];
  for (const line of input.lines) {
    parts.push(`${line.title} ×${line.quantity}`);
  }
  return parts.join(" · ");
}

/**
 * 付款后回跳的地址
 *
 * 带上订单号 —— success 页靠它查本地订单。
 */
export function buildStorefrontSuccessUrl(orderNo: string): string {
  const base =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000";
  return `${base.replace(/\/+$/, "")}/checkout/success?order=${encodeURIComponent(orderNo)}`;
}
