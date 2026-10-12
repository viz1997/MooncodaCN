import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ImageWorkbenchClient } from "@/features/canvas/pages/image-workbench-client";
import { auth } from "@/lib/auth";

/**
 * /dashboard/generate-v2 —— 生图工作台 V2（来自 infinite-canvas image page）
 *
 * - RSC entry：auth gate 防御
 * - 客户端壳走 dynamic ssr:false 屏障
 * - 与 /dashboard/generate (V1) 共存，按需切换
 *
 * feature flag：
 * - NEXT_PUBLIC_GENERATE_V2_ENABLED !== "false" 时挂载（默认开启）
 * - 关闭后整个 /dashboard/generate-v2 不可访问
 *
 * 与画布编辑器的差异：
 * - 画布编辑器在 /dashboard/canvas/[projectId]，全屏 fixed inset-0 z-50
 * - V2 工作台挂在 dashboard 主区，享受 sidebar 导航
 */
export default async function GenerateV2Page() {
  const enabled = process.env.NEXT_PUBLIC_GENERATE_V2_ENABLED !== "false";
  if (!enabled) {
    redirect("/dashboard");
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  return (
    <Suspense fallback={null}>
      <ImageWorkbenchClient />
    </Suspense>
  );
}
