import { notFound, redirect } from "next/navigation";

import { PrintOrderDetailView } from "@/features/print-quote/components/print-order-detail-view";
import {
  listPrintOrderEvents,
  toPrintOrderEventView,
} from "@/features/print-quote/lib/order-events";
import {
  getUserPrintOrderByOrderNo,
  toUserPrintOrderDetail,
} from "@/features/print-quote/lib/order-store";
import {
  getLatestRefundRequestForOrder,
  toRefundView,
} from "@/features/refund/lib/refund-store";
import {
  listShipmentsForOrder,
  toShipmentView,
} from "@/features/shipment/lib/shipment-store";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

interface AccountPrintOrderDetailPageProps {
  /**
   * Next 16:params 是 Promise
   *
   * 漏了 `await` 会拿到 `"[object Promise]"` —— 查不到单,页面看着像
   * 「工单不存在」,其实是自己写错了。
   */
  params: Promise<{ orderNo: string }>;
}

/**
 * /account/print-orders/[orderNo] —— 工单详情
 *
 * 2026-11-06 从 `/dashboard/print-orders/[orderNo]` 搬过来(理由见
 * `/account/orders/page.tsx` 的文件头 —— 买家的东西不放控制台)。
 *
 * ## 归属校验写在查询里
 *
 * `getUserPrintOrderByOrderNo(userId, orderNo)` 查不到就是 null(别人的单
 * 和不存在的单返回**同一个答案**)。403 等于告诉别人「这个订单号确实
 * 存在」,而订单号是可以被枚举的 —— 所以这里是 `notFound()`。
 *
 * ## 时间线一并查出来
 *
 * 事件跟订单在同一个库里,一次查完传给客户端。客户端之后靠轮询保持新鲜
 * (工作室改状态是外部写入,用户不刷新就看不到)。
 */
export default async function AccountPrintOrderDetailPage({
  params,
}: AccountPrintOrderDetailPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/account/print-orders");
  }

  const { orderNo } = await params;

  const row = await getUserPrintOrderByOrderNo(session.user.id, orderNo);
  if (!row) {
    // 不存在 和 不是你的 —— 同一个答案
    notFound();
  }

  const events = await listPrintOrderEvents(row.id);
  // 物流(2026-11-13)—— 一个工单可能有多个包裹(补发 / 分开发)
  const shipments = await listShipmentsForOrder("print", row.id);
  // 退款申请(2026-11-14)—— **最新那一条**;没有就是 null
  //
  // 「最新」而不是「唯一」:被拒之后买家可以再申请一条 ⇒ 一个工单可能有多条。
  // 买家侧只该看见**当前那一条**。
  const refundRow = await getLatestRefundRequestForOrder("print", row.id);

  return (
    <PrintOrderDetailView
      order={toUserPrintOrderDetail(row)}
      events={events.map(toPrintOrderEventView)}
      shipments={shipments.map(toShipmentView)}
      refund={refundRow ? toRefundView(refundRow) : null}
    />
  );
}
