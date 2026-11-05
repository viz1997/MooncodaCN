/**
 * 结算相关的两个小工具 —— 备注 + 回跳地址
 *
 * ## 为什么单独一个文件
 *
 * `checkout.ts` 和 `order-payment.ts` 都要用这两个函数,但 `order-payment.ts`
 * 也要从 `checkout.ts` 里 import「复用一单」的逻辑 —— 放在一起会绕成
 * **循环依赖**(A import B,B import A)。拆出来就干净了。
 */

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
