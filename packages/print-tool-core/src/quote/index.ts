/**
 * 报价 —— 定价设置 / 交期档位 / 取整 / 优惠基数 / 报价引擎
 *
 * ## 金额口径(整个包里只有这一处)
 *
 * - **对外一律「分」**(整数)
 * - **一律向上取整到分**(`rounding.ts` 的 `ceilCents` / `yuanToCentsCeil`)
 * - 引擎内部用「元」(浮点),转换只发生在元 → 分那**一个**边界上
 */

export * from "./compute-quote";
export * from "./coupon-base";
export * from "./delivery-tier";
export * from "./pricing-settings";
export * from "./rounding";
export * from "./types";
