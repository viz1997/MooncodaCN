/**
 * 管理端 - 单个模板：更新 / 删除
 * PUT    /api/admin/templates/[id]
 * DELETE /api/admin/templates/[id]
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import {
  deleteTemplate as deleteTemplateSvc,
  toggleTemplateActive as toggleTemplateActiveSvc,
  updateTemplate as updateTemplateSvc,
} from "@/features/gpt-image/lib/admin-services";
import { promptTemplateSchema } from "@/features/gpt-image/lib/validation";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
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

async function putHandler(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const authError = await requireAdmin();
  if (authError) return authError;
  try {
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    // 支持 { isActive: bool } 这种轻量 toggle
    if (
      typeof body === "object" &&
      body !== null &&
      Object.keys(body).length === 1 &&
      typeof (body as Record<string, unknown>).isActive === "boolean"
    ) {
      const updated = await toggleTemplateActiveSvc(
        id,
        (body as { isActive: boolean }).isActive
      );
      return NextResponse.json({ success: true, data: updated });
    }
    const parsed = promptTemplateSchema.partial().safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? "参数错误",
        },
        { status: 400 }
      );
    }
    const updated = await updateTemplateSvc(id, parsed.data);
    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "更新失败",
      },
      { status: 500 }
    );
  }
}

async function deleteHandler(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const authError = await requireAdmin();
  if (authError) return authError;
  try {
    const { id } = await ctx.params;
    await deleteTemplateSvc(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "删除失败",
      },
      { status: 500 }
    );
  }
}

export const PUT = withApiLogging(putHandler);
export const DELETE = withApiLogging(deleteHandler);
