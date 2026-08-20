import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CanvasProjectList } from "@/features/canvas/pages/project-list";
import { auth } from "@/lib/auth";

/**
 * /dashboard/canvas —— 画布项目列表页
 *
 * 注意：dashboard/(dashboard)/layout.tsx 已经做了 auth 校验，
 * 这里额外做一道防御（直接访问页面 + 父 layout 绕过）。
 *
 * useSearchParams() 的 null 防御已下放到 project-list.tsx（用 ?. 链式访问）。
 * 不在此包 <Suspense> 是为了避免跟 CanvasEditorClient 同一类 Suspense 嵌套循环问题。
 */
export default async function CanvasListPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  return <CanvasProjectList />;
}
