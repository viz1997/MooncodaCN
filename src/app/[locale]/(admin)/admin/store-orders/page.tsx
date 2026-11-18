/**
 * /admin/store-orders 商城订单后台(2026-11-18)
 *
 * RSC:仅渲染客户端组件 <StoreOrdersAdminView />。
 *
 * RBAC:由父 layout `src/app/[locale]/(admin)/admin/layout.tsx` 的 `checkAdmin()`
 * 守卫;非 admin 自动 redirect 到 `/`。本页不重复校验。
 *
 * ## 这一页管什么
 *
 * **把「淘宝上那笔钱」和「本站这一单」对上。**
 *
 * 买家不信任一个新店 ⇒ 结算页除了支付宝,多一个「**淘宝下单**」:点了跳到
 * 淘宝,在淘宝付款(享受平台担保)。钱进的是**淘宝那个账户** ⇒ 工作室在淘宝
 * 后台看到钱到了,回这一页把那笔单**手工标成已收款**。
 *
 * ## 为什么是**新开**的一页
 *
 * `/admin/orders` 是 gpt-image 的**生图订单**(`prompt_order` 表),跟商城订单
 * (`storefront_order` 表)是两套数据 —— 商城订单以前只出现在退款页和发货台
 * 里,工作室要「手工标已收款」没有地方下手。
 *
 * 配链接那一半在 `/admin/taobao-links`。
 *
 * 数据不在 RSC 里取:这一页要能「标完立刻看到生效值」,所以由客户端组件
 * 自己去调 admin action 拉,保存后原地刷新。
 */

import { StoreOrdersAdminView } from "@/features/storefront/admin/components/store-orders-admin-view";

export default function AdminStoreOrdersPage() {
  return <StoreOrdersAdminView />;
}
