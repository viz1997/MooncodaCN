/**
 * 购物车金额 —— **纯函数**(购物袋详情页 / 结算页共用同一份口径)
 *
 * ## 为什么单独抽出来
 *
 * 「小计 / 数量折扣 / 运费 / 合计」这四个数在**购物袋详情页**(`/cart`)和
 * **结算页**(`/checkout`)都要显示。两处各写一遍的话,改了一处忘了另一处,
 * 用户就会看到「购物袋写 ¥106.22、结算页写 ¥114.22」这种对不上的页面 ——
 * 看哪个都不信,最后干脆不买了。
 *
 * ## 口径只有一个:**折后单价 × 数量**
 *
 * 阶梯折扣(买 10 个打九折)落在**单价**上,不是总价上(见 `pricing.ts`)。
 * 所以:
 *
 * - 小计 = Σ(折后单价 × 数量)
 * - 数量折扣 = Σ(原价 × 数量) − 小计
 *
 * 这跟结算时服务端重算的口径一致(见 `lib/cart-store.ts` 的
 * `repriceLineItem()`),也跟收银台「逐分相等」的要求一致。
 *
 * ## 打印服务行不需要特殊分支
 *
 * 打印服务数量恒为 1(一活一模型),在这套算法里就是个「数量为 1 的普通行」。
 *
 * ## 运费看**车的性质**(2026-11-06)
 *
 * 商城购物袋有运费(¥8,小计到 ¥99 免),**打印单没有** —— 打印服务的价就是
 * 报价本身,报价台显示多少、这里显示多少、实际收多少,是同一个数。
 *
 * 传 `kind` 就是为了这一条;不传按商城购物袋算。
 *
 * ## 这个文件是**纯**的
 *
 * 购物袋详情页和结算页都是客户端组件,都 import 它 —— 不能引入任何服务端
 * 模块。
 */

import type { CartLineItem } from "../types";
import { type CartKind, STOREFRONT_CART_KIND } from "./cart-kind";
import {
  calculateRemainingForFreeShipping,
  shippingCentsForCart,
} from "./pricing-constants";

/** 购物车金额汇总 */
export interface CartTotals {
  /** 小计(分)—— Σ(折后单价 × 数量) */
  subtotalCents: number;
  /** 折扣前的小计(分)—— Σ(原价 × 数量) */
  rawSubtotalCents: number;
  /** 数量折扣(分)—— 折扣前小计 − 小计 */
  discountCents: number;
  /** 运费(分)—— 达到免运费门槛就是 0 */
  shippingCents: number;
  /** 合计(分)—— 小计 + 运费 */
  totalCents: number;
  /** 总件数 */
  itemCount: number;
  /** 距离免运费还差多少(分)—— 0 = 已免运费 */
  remainingForFreeShippingCents: number;
}

/**
 * 算一张车的金额
 *
 * @param items 车上的行(服务端算好的折后单价 —— 见 `cart-store.ts`)
 * @param kind 车的性质 —— 决定有没有运费(不传 = 商城购物袋)
 */
export function computeCartTotals(
  items: CartLineItem[],
  kind: CartKind = STOREFRONT_CART_KIND
): CartTotals {
  let subtotalCents = 0;
  let rawSubtotalCents = 0;
  let itemCount = 0;

  for (const item of items) {
    subtotalCents += item.discountedUnitPriceCents * item.quantity;
    rawSubtotalCents += item.unitPriceCents * item.quantity;
    itemCount += item.quantity;
  }

  const shippingCents = shippingCentsForCart(kind, subtotalCents);

  return {
    subtotalCents,
    rawSubtotalCents,
    discountCents: rawSubtotalCents - subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents,
    itemCount,
    // 打印单没有运费 → 没有「还差多少免运费」这回事
    remainingForFreeShippingCents:
      kind === STOREFRONT_CART_KIND
        ? calculateRemainingForFreeShipping(subtotalCents)
        : 0,
  };
}
