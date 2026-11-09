/**
 * /admin/coupons 优惠码后台(2026-11-08)
 *
 * RSC:仅渲染客户端组件 <CouponsAdminView />。
 *
 * RBAC:由父 layout `src/app/[locale]/(admin)/admin/layout.tsx` 的 `checkAdmin()`
 * 守卫;非 admin 自动 redirect 到 `/`。本页不重复校验。
 *
 * ## 这一页管什么
 *
 * 订单级优惠码的**全部**生命周期:建券、改券、停用。折扣本身由服务端算
 * (`features/coupon/lib/coupon-calc.ts`),这一页只管「这张券长什么样、
 * 什么时候能用、谁能用」。
 *
 * 数据在 RSC 里不取:这一页要能「改完立刻看到生效值」,所以由客户端组件
 * 自己去调 admin action 拉,保存后原地刷新。
 */

import { CouponsAdminView } from "@/features/coupon/admin/components/coupons-admin-view";

export default function AdminCouponsPage() {
  return <CouponsAdminView />;
}
