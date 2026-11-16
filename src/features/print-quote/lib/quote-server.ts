/**
 * 打印服务报价 —— **应用侧**那一层
 *
 * ## 引擎搬走了
 *
 * `computePrintQuote()` 现在住在
 * `@mooncoda/print-tool-core/quote/compute-quote`(纯函数、零依赖、
 * 浏览器 / Node / Worker 都能跑)—— 见那个文件的头,公式、取整口径、
 * 交期加价比例都在那边讲清楚了。
 *
 * 这里**再导出一次**,是为了**已有 import 一个字都不用改**。
 *
 * ## 留在这儿的是**应用专属**的东西
 *
 * `generatePrintOrderNo()` 用 `node:crypto` 的 `randomBytes` —— 那是
 * **服务端业务**(订单号),不属于「可复用的引擎」,所以不进那个包。
 */

import { randomBytes } from "node:crypto";

/**
 * 报价引擎 —— **再导出一次**
 *
 * 已有代码从 `@/features/print-quote/lib/quote-server` 拿它,那就不用改
 * import。新的代码**直接从 `@mooncoda/print-tool-core/quote` 拿**。
 */
export { computePrintQuote } from "@mooncoda/print-tool-core/quote/compute-quote";

/**
 * 生成业务订单号 —— `PO-20261101-3F7K2A`
 *
 * 格式:前缀 + 日期 + 6 位大写 hex。随机段用 `randomBytes` 而不是
 * `Math.random()` —— 订单号要能挡住「按顺序猜下一个」的枚举。
 */
export function generatePrintOrderNo(now = new Date()): string {
  const ymd = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const rand = randomBytes(3).toString("hex").toUpperCase();
  return `PO-${ymd}-${rand}`;
}
