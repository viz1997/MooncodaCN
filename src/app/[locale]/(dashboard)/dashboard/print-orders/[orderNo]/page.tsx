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
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

interface PrintOrderDetailPageProps {
  /**
   * Next 16:params 是 Promise
   *
   * 漏了 `await` 会拿到 `"[object Promise]"` —— 查不到单,页面看着像
   * 「工单不存在」,其实是自己写错了。
   */
  params: Promise<{ orderNo: string }>;
}

/**
 * /dashboard/print-orders/[orderNo] —— 工单详情
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
export default async function PrintOrderDetailPage({
  params,
}: PrintOrderDetailPageProps) {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/dashboard/print-orders");
  }

  const { orderNo } = await params;

  const row = await getUserPrintOrderByOrderNo(session.user.id, orderNo);
  if (!row) {
    // 不存在 和 不是你的 —— 同一个答案
    notFound();
  }

  const events = await listPrintOrderEvents(row.id);

  return (
    <PrintOrderDetailView
      order={toUserPrintOrderDetail(row)}
      events={events.map(toPrintOrderEventView)}
    />
  );
}
