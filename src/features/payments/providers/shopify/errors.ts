/**
 * Shopify 通道的错误
 *
 * ## 为什么单独一个文件
 *
 * `env.ts`(读环境变量)和 `money.ts`(算汇率)都要抛「没配好」这个错,
 * 而 `env.ts` 又要用 `money.ts` 的换算函数 —— 错误类要是住在 `env.ts` 里,
 * `money.ts` 导入 `env.ts` 就成了循环依赖。
 *
 * 所以它住在这儿:两个文件都导入它,谁也不依赖谁。
 *
 * ## 「没配好」跟「这次挂了」的分界
 *
 * - **`ShopifyNotConfiguredError`** —— 环境变量没配 / 配错了(币种、汇率、
 *   凭据、app 没装)。**重试没用**,得改配置。
 * - `PaymentProviderError`(`@/features/payments/lib/types`)—— 网络、5xx、
 *   Shopify 算出来的金额对不上。**重试就能好**。
 *
 * 这两类对用户是两件完全不同的事,见
 * `@/features/storefront/lib/payment-issue.ts`。
 */

export class ShopifyNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyNotConfiguredError";
  }
}
