/**
 * /admin/taobao-links 淘宝链接后台(2026-11-17)
 *
 * RSC:仅渲染客户端组件 <TaobaoLinksAdminView />。
 *
 * RBAC:由父 layout `src/app/[locale]/(admin)/admin/layout.tsx` 的 `checkAdmin()`
 * 守卫;非 admin 自动 redirect 到 `/`。本页不重复校验。
 *
 * ## 这一页管什么
 *
 * 买家不信任一个新店 ⇒ 结算页除了支付宝,多一个「**淘宝下单**」:点了跳到
 * 淘宝的商品页,在淘宝付款(享受平台担保)。钱进的是**淘宝那个账户**,不在本
 * 仓库的收钱链路里。
 *
 * 这一页把「本站这件设计」和「淘宝上那个商品」连起来 —— **一个设计一个
 * 链接**(商城卖的是 12 件设计,不是 6 个型号)。
 *
 * 收钱那一半在 `/admin/store-orders`:工作室在淘宝后台看到钱到了,回那边
 * 把那笔单**手工标成已收款**。
 *
 * 数据不在 RSC 里取:这一页要能「改完立刻看到生效值」,所以由客户端组件
 * 自己去调 admin action 拉,保存后原地刷新。
 */

import { TaobaoLinksAdminView } from "@/features/taobao/admin/components/taobao-links-admin-view";

export default function AdminTaobaoLinksPage() {
  return <TaobaoLinksAdminView />;
}
