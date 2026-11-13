/**
 * /admin/shipments 后台发货台(2026-11-13)
 *
 * RSC:仅渲染客户端组件 <ShipmentsAdminView />。
 *
 * RBAC:由父 layout `src/app/[locale]/(admin)/admin/layout.tsx` 的 `checkAdmin()`
 * 守卫;非 admin 自动 redirect 到 `/`。本页不重复校验。
 *
 * ## 这一页管什么
 *
 * **寄出去了,买家要看得见。** 工作室在这一页填「快递公司 + 运单号」,买家在
 * 订单详情页看得见物流(快递公司 + 单号 + 状态)。
 *
 * **商城订单和打印工单摆一张表** —— 工作室一天几十单,拆成两个页面等于来回切。
 *
 * ## 一期不做的
 *
 * 第三方物流对接(快递鸟 / 快递100 / 菜鸟)、快递轨迹查询、运费价表、退货入库、
 * 商城订单的完整后台管理页 —— 那些是二期。
 *
 * 数据不在 RSC 里取:这一页是「改完立刻看到」的交互式表格,由客户端组件自己
 * 调 admin action 拉,保存后原地刷新。
 */

import { ShipmentsAdminView } from "@/features/shipment/admin/components/shipments-admin-view";

export default function AdminShipmentsPage() {
  return <ShipmentsAdminView />;
}
