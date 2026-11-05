/**
 * 支付链接没生成的原因 —— **纯函数**
 *
 * ## 为什么值得单独一个文件
 *
 * 「收款通道没配好」和「这次调用挂了」对用户是两件完全不同的事:
 *
 * - 没配好(环境变量缺)—— 重试**没用**。得等部署补上配置,用户在「我的
 *   订单」里点多少次「重新获取支付链接」都是同一个结果。
 * - 调用挂了(网络 / Stripe / 上游)—— 重试就能好。
 *
 * 混成一句话「生成支付链接失败,请稍后重试」的话,用户就在反复重试一件根本
 * 不会成功的事。2026-11-05 线上真实踩到过:一次部署刚加好 Sellbase 环境
 * 变量,但那一次构建没赶上,用户下了一单既没有 Sellbase 订单也没有支付链
 * 接,而提示语让他「稍后重试」。
 *
 * ## 单独一个文件的原因
 *
 * 判断逻辑要能进 `unit` project(纯计算,不碰 DB、不碰网络)。放在
 * `checkout.ts` 里的话,import 它就会把 `@/db` 拖进来 —— 那是集成测试的
 * 依赖,不是单元测试的。
 */

import { SellbaseNotConfiguredError } from "@/features/sellbase/lib/env";
import { SellbaseOrderCreationError } from "@/features/sellbase/lib/orders";

/**
 * 支付链接没生成的原因
 *
 * - `SELLBASE_NOT_CONFIGURED` —— 收款通道没配好(环境变量缺),重试没用
 * - `SELLBASE_FAILED` —— 通道配好了但这次调用失败,重试有意义
 */
export type StorefrontPaymentIssue =
  | "SELLBASE_NOT_CONFIGURED"
  | "SELLBASE_FAILED";

/**
 * 判断一次建单失败属于哪一类
 *
 * **幂等**:同样的错误永远得到同样的分类。
 */
export function classifyPaymentIssue(
  error: unknown
): StorefrontPaymentIssue {
  // 配置没配好 —— 直接抛的
  if (error instanceof SellbaseNotConfiguredError) {
    return "SELLBASE_NOT_CONFIGURED";
  }
  // 配置没配好 —— 被建单那层包进了 SellbaseOrderCreationError
  //
  // `createSellbaseOrder()` 里 `getSellbaseAdmin()` 是在 try **外面**调的,
  // 所以配置错误本来是原样抛上来的;但如果哪天它被挪进 try,cause 就是
  // 唯一的线索 —— 两条路都认,别让重构悄悄改掉这个分类。
  if (
    error instanceof SellbaseOrderCreationError &&
    error.cause instanceof SellbaseNotConfiguredError
  ) {
    return "SELLBASE_NOT_CONFIGURED";
  }
  return "SELLBASE_FAILED";
}
