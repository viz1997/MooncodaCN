import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PromptLibraryPageClient } from "@/features/canvas/pages/library-page-client";
import { auth } from "@/lib/auth";

/**
 * /dashboard/prompts —— 提示词库管理页
 *
 * RSC entry：auth gate 防御
 * 客户端壳走 PromptLibraryPageClient（dynamic ssr:false + 三层 Provider）
 * 共用 PromptLibraryContent，与工作台弹窗保持单一数据源。
 */
export default async function PromptsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  return (
    <Suspense fallback={null}>
      <PromptLibraryPageClient />
    </Suspense>
  );
}
