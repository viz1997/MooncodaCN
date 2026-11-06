/**
 * /account/print-orders —— 「我的打印订单」
 *
 * 2026-11-06 从 `/dashboard/print-orders` 搬过来(理由见
 * `/account/orders/page.tsx` 的文件头 —— 买家的东西不放控制台)。
 *
 * 打印服务改成登录后下单,订单挂在账号名下,所以这里按 `user_id` 查 ——
 * 用户只看得到自己下的单。
 *
 * 鉴权在这一页自己做(`(marketing-atelier)` 是公开组,layout 里没有会话守卫)。
 *
 * 首屏数据由这里查好传下去(不用等客户端那一趟往返);列表页接上轮询,
 * 工作室改了状态用户不用刷新页面就能看到。
 */

import { redirect } from "next/navigation";

import { PrintOrdersView } from "@/features/print-quote/components/print-orders-view";
import {
  listUserPrintOrders,
  toUserPrintOrder,
} from "@/features/print-quote/lib/order-store";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function AccountPrintOrdersPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/account/print-orders");
  }

  const rows = await listUserPrintOrders(session.user.id, 50);

  return <PrintOrdersView initialOrders={rows.map(toUserPrintOrder)} />;
}
