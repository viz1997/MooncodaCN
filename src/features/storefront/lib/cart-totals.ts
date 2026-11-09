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
 * ## 车里**只有目录商品**(2026-11-08)
 *
 * 打印服务**不进商城购物袋** —— 工作室的说法:「不要放入购物车,放在这里
 * account/print-orders」。打印服务是**另一条线**:工单自己建、自己收款
 * (`print_order` 那张表),跟目录商品不相干。
 *
 * 所以这里没有「打印服务那部分」这种分支了 —— 车上的每一行都是要寄出去的
 * 实物,运费按整张小计算,¥8,到 ¥99 免。
 *
 * ## 这个文件是**纯**的
 *
 * 购物袋详情页和结算页都是客户端组件,都 import 它 —— 不能引入任何服务端
 * 模块。
 */

import type { CartLineItem } from "../types";
import {
  calculateRemainingForFreeShipping,
  calculateShippingCents,
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
 *
 * ## 运费门槛按**折后小计**算
 *
 * 阶梯折扣落在单价上,所以「用户看得见的那个数」就是折后小计 —— 免运费的
 * 门槛看它,不是折扣前的小计。
 */
export function computeCartTotals(items: CartLineItem[]): CartTotals {
  let subtotalCents = 0;
  let rawSubtotalCents = 0;
  let itemCount = 0;

  for (const item of items) {
    subtotalCents += item.discountedUnitPriceCents * item.quantity;
    rawSubtotalCents += item.unitPriceCents * item.quantity;
    itemCount += item.quantity;
  }

  // 门槛按**折后小计**算
  const shippingCents = calculateShippingCents(subtotalCents);

  return {
    subtotalCents,
    rawSubtotalCents,
    discountCents: rawSubtotalCents - subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents,
    itemCount,
    remainingForFreeShippingCents:
      calculateRemainingForFreeShipping(subtotalCents),
  };
}
