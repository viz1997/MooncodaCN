/**
 * 退款申请 —— 轮询指纹
 *
 * ## 为什么需要指纹
 *
 * 工作室在后台点「退款」是**外部写入** —— 买家这边的页面一个字都不会变。
 * 轮询回来的数据跟上一轮**完全一样** ⇒ 不 setState ⇒ 页面停在「等工作室处理」
 * 直到用户手动刷新。
 *
 * 跟物流那个坑一模一样(`shipment/lib/fingerprint.ts`)—— 所以指纹**只定义一次**,
 * 两个轮询 hook 共用。两处各写一份,迟早漂(工单那个 hook 本来就有两处指纹,
 * 已经漂过一次了)。
 *
 * ## 指纹里放什么
 *
 * 放**买家能看到的那些变化**:
 *
 * - `status` —— 申请状态变了(待处理 → 已同意 → 已退款)
 * - `refundedCents` —— 工作室实际退的金额变了
 * - `providerRefundStatus` —— 平台那边的状态变了(钱在路上了 / 退成了)
 * - `updatedAt` —— 兜底:任何一列被改都会刷新它
 *
 * ⚠️ **`refundError` 不进指纹** —— 它是给工作室看的失败原因,买家侧不显示。
 * 它变了但 `updatedAt` 也会变,所以不影响变更检测。
 */

import type { RefundView } from "./types";

/**
 * 一个订单的退款申请的指纹
 *
 * 没有申请 ⇒ **空串** —— 「没有申请」和「有一个待处理的申请」必须算出**不同**
 * 的指纹,否则买家提交申请之后页面不会更新。
 */
export function refundFingerprint(refund: RefundView | null): string {
  if (!refund) {
    return "";
  }
  return [
    refund.id,
    refund.status,
    refund.refundedCents ?? "",
    refund.providerRefundStatus ?? "",
    refund.updatedAt,
  ].join(":");
}
