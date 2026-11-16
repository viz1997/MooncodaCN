/**
 * 报价 —— 定价设置 / 交期档位 / 配送方式 / 件数 / 取整 / 优惠基数 / 报价引擎
 *
 * ## 金额口径(整个包里只有这一处)
 *
 * - **对外一律「分」**(整数)
 * - **一律向上取整到分**(`rounding.ts` 的 `ceilCents` / `yuanToCentsCeil`)
 * - 引擎内部用「元」(浮点),转换只发生在元 → 分那**一个**边界上
 *
 * ## 两个正交的轴(别混)
 *
 * - **交期档位**(`delivery-tier.ts`)—— 多快发货,**按小计的比例**加钱
 * - **配送方式**(`shipping-option.ts`)—— 怎么寄,**按单收**绝对金额
 */

export * from "./compute-quote";
export * from "./coupon-base";
export * from "./delivery-tier";
export * from "./pricing-settings";
export * from "./quantity";
export * from "./rounding";
export * from "./shipping-option";
export * from "./types";
