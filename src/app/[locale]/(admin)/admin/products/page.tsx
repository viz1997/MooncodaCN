import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ProductsAdminView } from "@/features/image-gen/admin/components/products-admin-view";
import { auth } from "@/lib/auth";

/**
 * 商品管理 - Admin 路由
 *
 * 2026-10-21 新增。商品资料 / 基础价 / SKU 变体从 product-catalog.ts 的
 * 硬编码常量搬到 product + product_variant 两张表，由这里管理。
 *
 * - 卡片网格：名称 / 基础价 / SKU 价格区间 / 在售数
 * - 「SKU 管理」进 /admin/products/[code] 逐行改 SKU 绝对价和上下架
 * - 对外由 GET /api/image-gen/products 暴露给小程序（CDN 缓存 10 分钟）
 */
export default async function ProductsAdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  return (
    <div className="space-y-6">
      <ProductsAdminView />
    </div>
  );
}
