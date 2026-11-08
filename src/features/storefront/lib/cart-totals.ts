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
 * ## 运费只看**目录商品**那一部分(2026-11-08)
 *
 * 打印服务跟目录商品装**同一张车**了(工作室的说法:「不要 print-order,
 * 进入商城那个」)。但运费规则还是两套:
 *
 * - 目录商品:¥8,目录商品那部分小计到 ¥99 免
 * - 打印服务:没有运费 —— 价就是报价本身(见 `print-quote/lib/payment.ts`:
 *   工单的支付金额恒等于 `total_price_cents`)
 *
 * 所以运费的基数是**目录商品的折后小计**。打印服务的钱**不计入**运费
 * 门槛(它不产生快递费,也不该替目录商品把 ¥99 凑满)。
 *
 * 规则本身在 `pricing-constants.ts` 的 `shippingCentsForCart()` —— 客户端
 * 和服务端用**同一份**。
 *
 * ## 这个文件是**纯**的
 *
 * 购物袋详情页和结算页都是客户端组件,都 import 它 —— 不能引入任何服务端
 * 模块。
 */

import type { CartLineItem } from "../types";
import {
  calculateRemainingForFreeShipping,
  shippingCentsForCart,
} from "./pricing-constants";
import { getPrintServiceSpec } from "./print-service";

/** 购物车金额汇总 */
export interface CartTotals {
  /** 小计(分)—— Σ(折后单价 × 数量),**全部行** */
  subtotalCents: number;
  /** 折扣前的小计(分)—— Σ(原价 × 数量) */
  rawSubtotalCents: number;
  /** 数量折扣(分)—— 折扣前小计 − 小计 */
  discountCents: number;
  /** 目录商品那部分的折后小计(分)—— **运费的基数** */
  catalogSubtotalCents: number;
  /** 打印服务那部分的折后小计(分)—— 不产生运费 */
  printSubtotalCents: number;
  /** 运费(分)—— 按目录商品那部分算;车里没有目录商品就是 0 */
  shippingCents: number;
  /** 合计(分)—— 小计 + 运费 */
  totalCents: number;
  /** 总件数 */
  itemCount: number;
  /** 距离免运费还差多少(分)—— 0 = 已免运费 / 车里有目录商品但已满 ¥99 */
  remainingForFreeShippingCents: number;
}

/**
 * 算一张车的金额
 *
 * @param items 车上的行(服务端算好的折后单价 —— 见 `cart-store.ts`)
 */
export function computeCartTotals(items: CartLineItem[]): CartTotals {
  let subtotalCents = 0;
  let rawSubtotalCents = 0;
  let catalogSubtotalCents = 0;
  let printSubtotalCents = 0;
  let itemCount = 0;

  for (const item of items) {
    const lineTotalCents = item.discountedUnitPriceCents * item.quantity;
    subtotalCents += lineTotalCents;
    rawSubtotalCents += item.unitPriceCents * item.quantity;
    itemCount += item.quantity;

    // 判据是「有没有 printSpec」—— 打印服务不在目录里(见 `print-service.ts`)
    if (getPrintServiceSpec(item.metadata)) {
      printSubtotalCents += lineTotalCents;
    } else {
      catalogSubtotalCents += lineTotalCents;
    }
  }

  const shippingCents = shippingCentsForCart(catalogSubtotalCents);

  return {
    subtotalCents,
    rawSubtotalCents,
    discountCents: rawSubtotalCents - subtotalCents,
    catalogSubtotalCents,
    printSubtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents,
    itemCount,
    // 车里没有目录商品 → 没有「还差多少免运费」这回事
    remainingForFreeShippingCents:
      catalogSubtotalCents > 0
        ? calculateRemainingForFreeShipping(catalogSubtotalCents)
        : 0,
  };
}
