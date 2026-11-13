/**
 * 物流指纹 —— 「物流有没有变」的判定
 *
 * ## 为什么需要它
 *
 * 工作室在后台填了运单号,是**外部写入** —— 买家这边订单状态一个字都没变。
 * 轮询回来的数据跟上一轮**完全一样** ⇒ 不 setState ⇒ 页面一直停在
 * 「还没发货」。工作室明明填了单号,买家看着像没发货。
 *
 * **两个指纹都必须带它** —— 轮询那一轮的和 RSC 初始同步那一轮的。
 * 漏了任何一个,买家都得手动刷新才看得到单号。
 *
 * ## 为什么带 `updatedAt`
 *
 * `updatedAt` 在**建发货单**和**改状态**时都会顶起来 —— 它覆盖了状态改动
 * 和备注改动。运单号再带一遍是双保险。
 *
 * ## 放在 `features/shipment/lib/` 而不是某个 hook 里
 *
 * 打印工单详情页和商城订单详情页**都要**用它 —— 两个 hook 各自写一份,
 * 改了一边另一边就漂(一边带 `updatedAt` 一边不带 = 一边能刷一边刷不出来)。
 */

import type { ShipmentView } from "./types";

/**
 * 物流指纹 —— 一串能唯一定位「物流有没有变」的字符串
 *
 * 空数组 ⇒ 空字符串 ⇒ 「没有物流」这件事本身也是一个稳定的状态。
 */
export function shipmentFingerprint(shipments: ShipmentView[]): string {
  return shipments
    .map(
      (s) => `${s.packageIndex}:${s.status}:${s.trackingNumber}:${s.updatedAt}`
    )
    .join(",");
}
