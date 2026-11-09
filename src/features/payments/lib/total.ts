/**
 * 收银台总额 —— **一份实现,两个通道共用**(2026-11-08)
 *
 * ## 为什么拎出来
 *
 * 微信和支付宝的「应付总额」是**同一个算式**:
 *
 * ```
 * total = Σ(折后单价 × 数量) + 运费 − 订单级优惠
 * ```
 *
 * 以前它在这两个通道的 provider 文件里各写了一份。两份一样的代码看着省事,
 * 实则是个雷:**改了一份忘了另一份**,逐分相等就只在一条通道上破了 ——
 * 而那种 bug 要等到真收钱那天才看得出来。
 *
 * ⇒ 一份实现,两个 provider 都 import 它。**纯函数,零 import**
 * (除了 `PaymentRequest` 那个类型),所以 `unit` project 能直接测它。
 *
 * ## 为什么通道只能从**总额**里减优惠
 *
 * 优惠码是**订单级**的:折扣不减在任何一行的单价上,而是减整单。而收银台的
 * 总额是**从各行算出来的**:
 *
 * - 微信 Native 只发 `amount.total`(没有 `goods_detail`)
 * - 支付宝的 `biz_content` 只有 `total_amount`(没有 `goods_detail`)
 *
 * ⇒ 只能从总额里减**一次**。
 *
 * ## 为什么不按比例摊到各行单价上
 *
 * 行小计 = 单价 × 数量,摊完要除回单价,**除不尽**(100 分摊到 3 件 =
 * 33.33),单价必须是整数 ⇒ 摊不平;而且摊分会引入 `round` 误差,
 * `Σ round(xᵢ)` 跟 `round(Σ xᵢ)` 不一定相等,逐分相等直接被破坏。
 *
 * ## 逐分相等
 *
 * ```
 * computeTotalCents = Σ(折后单价 × 数量) + 运费 − 优惠
 *                    = 折后小计 + 运费 − 优惠
 *                    = storefront_order.total_cents   ✅ 一分不差
 * ```
 *
 * `unitPriceCents` 传进来的已经是**折后单价**(阶梯折扣在算价那一层就折过了),
 * 而折后单价是整数 ⇒ `Math.round(整数 × 数量) === 整数 × 数量`,那个
 * `Math.round` 只是防浮点,不会引入误差。
 */

import type { PaymentRequest } from "./types";

/**
 * 算应付总额(分)
 *
 * 每行的「折后单价 × 数量」加起来,加上运费,**再减掉订单级优惠**。运费也是
 * 分,先加总再交给支付平台 —— 分和元混着加会出那一分钱的差。
 *
 * ## 两道闸
 *
 * - **负折扣** → 抛错(那不是优惠,是有人算错了)
 * - **折扣超过订单总额** → 抛错(收银台会收一个负数)
 *
 * 折扣**刚好等于**总额是允许的 —— 全额免单,总额 0。
 */
export function computeTotalCents(request: PaymentRequest): number {
  const itemsTotal = request.items.reduce(
    (sum, item) => sum + Math.round(item.unitPriceCents * item.quantity),
    0
  );
  const shipping = Math.round(request.shippingCents);
  const discount = Math.round(request.discountCents ?? 0);
  if (discount < 0) {
    throw new Error("discountCents 不能为负");
  }
  if (discount > itemsTotal + shipping) {
    throw new Error("discountCents 超过了订单总额");
  }
  return itemsTotal + shipping - discount;
}
