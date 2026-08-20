/**
 * GET /api/image-gen/photos/list
 *
 * 列出当前用户上传的图片（photo 表，仅本人可见）。
 *
 * 鉴权：仅要求登录。
 * 数据源：photo.userId = ctx.userId（与 listPhotosAction 同源）。
 *
 * 用途：
 *   - ImageWorkbench V2 的「AssetPickerModal → 我的图片」Tab
 *   - 移动端 / 第三方调用入口（与 /dashboard/generate 的 Photo 库对等）
 *
 * Query 参数：
 *   - limit：1-100，默认 50
 *   - offset：默认 0
 *
 * 与 listPhotosAction（Server Action）的差异：本路由走 fetch，给客户端组件用；
 * Server Action 仍保留供 /dashboard/photos 直接调用。
 *
 * maxDuration = 30s：单次 DB 查询。
 */

import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { photo } from "@/db/schema";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 30;

async function getHandler(req: NextRequest) {
  // 鉴权：仅要求登录
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "请先登录" },
      { status: 401 }
    );
  }

  // query 参数解析
  const { searchParams } = new URL(req.url);
  const limitParam = Number(searchParams.get("limit") ?? "50");
  const offsetParam = Number(searchParams.get("offset") ?? "0");
  const limit = Math.max(
    1,
    Math.min(100, Number.isFinite(limitParam) ? limitParam : 50)
  );
  const offset = Math.max(0, Number.isFinite(offsetParam) ? offsetParam : 0);

  try {
    const photos = await db.query.photo.findMany({
      where: and(eq(photo.userId, session.user.id)),
      orderBy: [desc(photo.createdAt)],
      limit,
      offset,
    });

    return NextResponse.json({ success: true, data: { photos } });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "获取图片失败",
      },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging(getHandler);
