import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Providers3DAdminView } from "@/features/image-gen/admin/components/providers-3d-admin-view";
import { auth } from "@/lib/auth";

/**
 * 3D 引擎管理 - Admin 路由
 *
 * 仿 mooncada-source/modules/providers-3d.tsx 设计：
 * - 5 张统计卡片
 * - 场景推荐引擎（6 个使用场景 → 首选 + 备选）
 * - 引擎卡片网格 + 详情对话框 + 对比视图
 * 数据来自 PROVIDER_LIST_3D（src/features/mooncada/lib/providers/types.ts）
 */
export default async function Providers3DAdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  return (
    <div className="space-y-6">
      <Providers3DAdminView />
    </div>
  );
}
