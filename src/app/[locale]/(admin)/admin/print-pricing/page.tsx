/**
 * /admin/print-pricing 打印定价后台（2026-11-06）
 *
 * RSC：仅渲染客户端组件 <PrintPricingAdminView />。
 *
 * RBAC：由父 layout `src/app/[locale]/(admin)/admin/layout.tsx` 的 `checkAdmin()`
 * 守卫；非 admin 自动 redirect 到 `/`。本页不重复校验。
 *
 * ## 这一页管什么
 *
 * 打印服务跟「钱」和「工艺」有关的所有口径：材料库、计价基础、支撑加价的
 * 分段规则、交期三档比例、支撑几何参数（托底高度 / 底板留边）。
 *
 * 改完之后，工具页（/tools/weight）和打印单（/print-order）**一律跟这里走**
 * —— 访客改不了，服务端结算时重算。
 *
 * 数据在 RSC 里不取：这一页要能「改完立刻看到生效值」，所以由客户端组件
 * 自己去调 admin action 拉，保存后原地刷新。
 */

import { PrintPricingAdminView } from "@/features/print-quote/admin/components/print-pricing-admin-view";

export default function AdminPrintPricingPage() {
  return <PrintPricingAdminView />;
}
