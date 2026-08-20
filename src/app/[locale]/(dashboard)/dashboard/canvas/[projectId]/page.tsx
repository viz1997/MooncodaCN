import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CanvasEditorClient } from "@/features/canvas/pages/canvas-editor-client";
import { auth } from "@/lib/auth";

interface CanvasEditorPageProps {
  params: Promise<{ projectId: string }>;
}

/**
 * /dashboard/canvas/[projectId] —— 画布编辑器入口
 *
 * - RSC 入口：auth gate 防御（父 layout 已经做了，这里再校验一次）
 * - CanvasEditorClient 走 next/dynamic ssr:false，绕过 localforage SSR
 * - 三层 Provider 由 CanvasEditorClient 内部挂载（CanvasI18nProvider + AntdProvider）
 *
 * feature flag：
 * - NEXT_PUBLIC_CANVAS_ENABLED !== "true" 时返回 404（默认开启）
 * - 关闭后整个 /dashboard/canvas/** 不可访问
 */
export default async function CanvasEditorPage({
  params,
}: CanvasEditorPageProps) {
  const enabled = process.env.NEXT_PUBLIC_CANVAS_ENABLED !== "false";
  if (!enabled) {
    redirect("/dashboard");
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  const { projectId } = await params;
  return <CanvasEditorClient projectId={projectId} />;
}
