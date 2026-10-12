import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AssetLibraryPageClient } from "@/features/canvas/pages/library-page-client";
import { auth } from "@/lib/auth";

/**
 * /dashboard/assets —— 我的资产管理页
 *
 * RSC entry：auth gate 防御
 * 客户端壳走 AssetLibraryPageClient（dynamic ssr:false + 三层 Provider）
 * 共用 AssetLibraryContent，与工作台弹窗保持单一数据源。
 */
export default async function AssetsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  return (
    <Suspense fallback={null}>
      <AssetLibraryPageClient />
    </Suspense>
  );
}
