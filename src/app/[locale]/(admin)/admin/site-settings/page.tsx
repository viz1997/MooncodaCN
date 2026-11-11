/**
 * /admin/site-settings 站点设置后台(2026-11-11)
 *
 * RSC:仅渲染客户端组件 <SiteSettingsAdminView />。
 *
 * RBAC:由父 layout `src/app/[locale]/(admin)/admin/layout.tsx` 的 `checkAdmin()`
 * 守卫;非 admin 自动 redirect 到 `/`。本页不重复校验。
 *
 * ## 这一页管什么
 *
 * **后台能改、不用重新部署**的站点级设置。第一项是**海外独立站(Shopify)
 * 的顾客访问地址** —— 工作室 2026-11-11 的原话:「**不需要环境变量,在后台
 * 设置**」。
 *
 * ⚠️ **这跟 `src/features/payments/providers/shopify/` 那个支付通道不是一
 * 回事** —— 那个 2026-11-05 就下线了(`SHOPIFY_STORE_DOMAIN` 那套是
 * Admin API,给收款用的)。这里说的是**另一个 Shopify 店铺的顾客访问
 * 地址**:工作室的独立站在境外,境外的买家在那儿下单。本仓库**只提供一个
 * 入口**,不接单、不算价、不碰钱。
 *
 * 数据在 RSC 里不取:这一页要能「改完立刻看到生效值」,所以由客户端组件
 * 自己去调 admin action 拉,保存后原地刷新。
 */

import { SiteSettingsAdminView } from "@/features/site-settings/admin/components/site-settings-admin-view";

export default function AdminSiteSettingsPage() {
  return <SiteSettingsAdminView />;
}
