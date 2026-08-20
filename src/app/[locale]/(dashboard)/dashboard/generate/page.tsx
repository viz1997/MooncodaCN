import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getActivePromptTemplates } from "@/features/image-gen/lib/prompt-template-source";
import { auth } from "@/lib/auth";

import { ImageWorkbenchV1Client } from "./image-workbench-v1-client";

export default async function GeneratePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  // Phase C：image-gen 工作台改读 promptTemplate（与 gpt-image 共用单一数据源）
  const templates = await getActivePromptTemplates();

  // 2026-08-18：ExternalImageGenCard 不再横在页面顶部，独立嵌进工作台
  // 「生成结果」标题栏右侧的 action 区（与「新建会话」按钮并列），hover
  // Popover 才显示完整链接 / 复制按钮。避免工作台用户每次进站被一条横条
  // 提醒"免登录入口" —— 它属于边缘功能，常驻 UI 太抢戏。
  //
  // 2026-08-19：套 ImageWorkbenchV1Client（CanvasI18nProvider + AntdProvider
  // + CanvasQueryProvider），与 V2 共用 PromptSelectDialog / AssetPickerModal
  // 三 Tab / 双 Tab 的提示词与资产管理能力。
  return <ImageWorkbenchV1Client templates={templates} />;
}
