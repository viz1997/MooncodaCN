import { redirect } from "next/navigation";

import { PrintOrdersDashboardView } from "@/features/print-quote/components/print-orders-dashboard-view";
import {
  listUserPrintOrders,
  toUserPrintOrder,
} from "@/features/print-quote/lib/order-store";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

/**
 * /dashboard/print-orders —— 「我的打印订单」
 *
 * 2026-11-01:打印服务改成登录后下单,订单挂在账号名下,所以这里按
 * `user_id` 查 —— 用户只看得到自己下的单。
 *
 * 鉴权由 `(dashboard)/layout.tsx` 兜住(那边是真的查库校验 session),
 * 这里再判一次是为了把类型收窄 —— 万一哪天这个页面被挪出 dashboard
 * 布局,也不会变成一个谁都能看的页面。
 *
 * 首屏数据由这里查好传下去(不用等客户端那一趟往返);列表页接上轮询,
 * 工作室改了状态用户不用刷新页面就能看到。
 */
export default async function PrintOrdersPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/dashboard/print-orders");
  }

  const rows = await listUserPrintOrders(session.user.id, 50);

  return (
    <PrintOrdersDashboardView initialOrders={rows.map(toUserPrintOrder)} />
  );
}
