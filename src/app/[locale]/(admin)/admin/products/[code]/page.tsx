import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { ProductVariantsView } from "@/features/image-gen/admin/components/product-variants-view";
import { auth } from "@/lib/auth";

/**
 * 商品 SKU 管理 - Admin 路由
 *
 * 2026-10-21 新增。左栏改商品资料 / 基础价，右栏逐行维护 SKU 变体的
 * 绝对价和上下架。SKU 行对应 product_variant 表，对外暴露为
 * ProductCapability.variants[]。
 *
 * 页面本身不取数 —— ProductVariantsView 用 getProductAdminAction 在
 * 客户端拉（与 product-lines-admin-view 同款），避免多一次 RSC 往返。
 */
export default async function ProductVariantsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  const { code } = await params;

  return (
    <div className="space-y-6">
      <ProductVariantsView productCode={code} />
    </div>
  );
}
