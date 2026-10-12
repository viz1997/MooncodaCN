/**
 * 管理端 - 模板列表 / 创建
 * GET  /api/admin/templates
 * POST /api/admin/templates
 */

import { revalidateTag, unstable_cache } from "next/cache";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import {
  createTemplate as createTemplateSvc,
  listTemplatesWithCounts,
} from "@/features/gpt-image/lib/admin-services";
import { promptTemplateSchema } from "@/features/gpt-image/lib/validation";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

const TEMPLATES_TAG = "admin-templates";

/** 带 60s 缓存的模板列表（避免每次都打 Supabase） */
const cachedListTemplates = unstable_cache(
  async () => listTemplatesWithCounts(),
  ["admin-templates-list"],
  { revalidate: 60, tags: [TEMPLATES_TAG] }
);

async function requireAdmin() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "未登录" },
      { status: 401 }
    );
  }
  if (session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: "无管理员权限" },
      { status: 403 }
    );
  }
  return null;
}

async function getHandler() {
  const authError = await requireAdmin();
  if (authError) return authError;
  try {
    const templates = await cachedListTemplates();
    return NextResponse.json({ success: true, data: templates });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "查询失败",
      },
      { status: 500 }
    );
  }
}

async function postHandler(req: NextRequest) {
  const authError = await requireAdmin();
  if (authError) return authError;
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = promptTemplateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? "参数错误",
        },
        { status: 400 }
      );
    }
    const template = await createTemplateSvc({
      ...parsed.data,
      coverUrl: parsed.data.coverUrl ?? null,
    });
    revalidateTag(TEMPLATES_TAG, "max");
    return NextResponse.json({ success: true, data: template });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "创建失败",
      },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler);
export const POST = withApiLogging(postHandler);
