/**
 * /admin/refunds 后台退款管理(2026-11-14)
 *
 * RSC:仅渲染客户端组件 <RefundsAdminView />。
 *
 * RBAC:由父 layout `src/app/[locale]/(admin)/admin/layout.tsx` 的 `checkAdmin()`
 * 守卫;非 admin 自动 redirect 到 `/`。本页不重复校验。
 *
 * ## 这一页管什么
 *
 * **买家申请了退款,工作室在这一页处理。**
 *
 * 工作室点「执行退款」⇒ **系统自动调微信 / 支付宝的退款 API** ⇒ 平台回了
 * 「钱退了」⇒ 本地状态变「已退款」⇒ 买家在订单详情页看得见。
 *
 * 工作室在商家后台**手工**退完钱的,回这一页点「标记已退款」—— 那条路保留着
 * (通道没配好 / 平台拒了的时候只有它能用)。
 *
 * **商城订单和打印工单摆一张表** —— 工作室一天几十单,拆成两个页面等于来回切。
 *
 * 数据不在 RSC 里取:这一页是「改完立刻看到」的交互式表格,由客户端组件自己
 * 调 admin action 拉,保存后原地刷新。
 */

import { RefundsAdminView } from "@/features/refund/admin/components/refunds-admin-view";

export default function AdminRefundsPage() {
  return <RefundsAdminView />;
}
