/**
 * GET /api/image-gen/prompt-templates
 *
 * 列出所有启用的提示词模板（与 gpt-image 共用 prompt_template 表）。
 *
 * 鉴权：仅要求登录（不限管理员）。
 * 数据源：`listActivePromptTemplatesForWorkbench()` —— 已剔除 prompt 字段的版本，
 * 这里走 `getActivePromptTemplates()`（含 prompt）以让客户端能渲染 {{变量}} 替换。
 *
 * 用途：
 *   - ImageWorkbench V2 的「PromptSelectDialog → 模板库」Tab
 *   - V1 工作台（generate-workbench-view.tsx）已经从 RSC 拿这个数据，本 API
 *     给 V2 客户端 / 移动端 / 第三方调用提供对等入口
 *
 * 与 /api/admin/templates 的差异：那个路由仅管理员可用，且需要登录态校验。
 *
 * maxDuration = 30s：单次 DB 查询 + serialize，毫秒级完成。
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { getActivePromptTemplates } from "@/features/image-gen/lib/prompt-template-source";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

async function getHandler(_req: NextRequest) {
  // 鉴权：仅要求登录，不限管理员
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "请先登录" },
      { status: 401 }
    );
  }

  try {
    const templates = await getActivePromptTemplates();
    return NextResponse.json({ success: true, data: { templates } });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "获取模板失败",
      },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler);
