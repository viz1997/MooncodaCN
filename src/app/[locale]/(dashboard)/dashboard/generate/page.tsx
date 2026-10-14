import { inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { getActiveEffects } from "@/features/image-gen/lib/effects-store";
import { auth } from "@/lib/auth";

import { ImageWorkbenchV1Client } from "./image-workbench-v1-client";

export default async function GeneratePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  // 2026-10-14：数据源从 prompt_template 表切到 product_effect 表,
  // 原因:prompt_template 与 product_effect 双轨存储,admin 在
  // /admin/product-effects 建模板后,RSC 工作台读不到(只显示"暂无"),
  // 但 /api/image-gen/templates (v2.1 小程序路径)能读到 product_effect,
  // 形成两条路径数据不一致。统一到 product_effect 与小程序 SDK 对齐。
  //
  // candidateCount / outputMode 是 prompt_template 表独有字段,
  // productEffect.promptTemplateId 关联过去。一次 inArray join 拿全,
  // 避免 N+1。fallback = 1 / 'grid' 与 /api/image-gen/templates 同形态。
  const effects = await getActiveEffects();
  const promptTemplateIds = Array.from(
    new Set(
      effects
        .map((e) => e.promptTemplateId ?? null)
        .filter((id): id is string => Boolean(id))
    )
  );
  const templates =
    promptTemplateIds.length > 0
      ? await db.query.promptTemplate.findMany({
          where: (t, { eq }) =>
            promptTemplateIds.length === 1
              ? eq(t.id, promptTemplateIds[0]!)
              : inArray(t.id, promptTemplateIds),
          columns: {
            id: true,
            candidateCount: true,
            outputMode: true,
          },
        })
      : [];
  const templateMap = new Map(templates.map((t) => [t.id, t] as const));

  const workbenchTemplates = effects.map((e) => {
    const tmpl = e.promptTemplateId
      ? templateMap.get(e.promptTemplateId)
      : null;
    return {
      ...e,
      candidateCount: tmpl?.candidateCount ?? 1,
      outputMode: (tmpl?.outputMode ?? "grid") as "grid" | "separate",
    };
  });

  // 2026-08-18：ExternalImageGenCard 不再横在页面顶部，独立嵌进工作台
  // 「生成结果」标题栏右侧的 action 区（与「新建会话」按钮并列），hover
  // Popover 才显示完整链接 / 复制按钮。避免工作台用户每次进站被一条横条
  // 提醒"免登录入口" —— 它属于边缘功能，常驻 UI 太抢戏。
  //
  // 2026-08-19：套 ImageWorkbenchV1Client（CanvasI18nProvider + AntdProvider
  // + CanvasQueryProvider），与 V2 共用 PromptSelectDialog / AssetPickerModal
  // 三 Tab / 双 Tab 的提示词与资产管理能力。
  return <ImageWorkbenchV1Client templates={workbenchTemplates} />;
}
