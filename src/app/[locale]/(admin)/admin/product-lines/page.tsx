import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProductLinesAdminView } from "@/features/image-gen/admin/components/product-lines-admin-view";
import { auth } from "@/lib/auth";

/**
 * 产品线管理 - Admin 路由
 *
 * 仿 mooncada-source/modules/product-lines.tsx 设计：
 * - 5 张统计卡片
 * - 卡片网格 + 详情对话框（4 Tab：规格/定价/生产/兼容效果）
 * 数据使用前端 mock（MOCK_PRODUCT_LINES），后续接入 Drizzle 表时扩展
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
