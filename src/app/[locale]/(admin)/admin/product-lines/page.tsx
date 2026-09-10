import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProductLinesAdminView } from "@/features/image-gen/admin/components/product-lines-admin-view";
import { auth } from "@/lib/auth";

/**
 * 产品线管理 - Admin 路由
 *
 * 2026-09-10：已从 mooncada-source ENRICHED mock 切换到 product_line Drizzle 表
 * （ProductLinesAdminView 内部用 listProductLinesAdminAction 加载）。
 * - 3 张统计卡片（产品线 / 上架中 / 草稿）
 * - 卡片网格 + 详情对话框（规格/定价）
 * - 新建/编辑/删除走 productLineFormDialog + admin actions
 */
export default async function ProductLinesAdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  return (
    <div className="space-y-6">
      <ProductLinesAdminView />
    </div>
  );
}
