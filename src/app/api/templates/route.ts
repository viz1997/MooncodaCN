/**
 * 模板列表（公开给登录用户）
 *
 * GET /api/templates
 *
 * 任何登录用户可调用 —— 用于创建订单时填充模板下拉。
 * 仅返回 isActive = true 的模板的最小字段，**不返回 prompt**。
 * 管理端 (CRUD / 含 prompt / 全部模板) 仍走 /api/admin/templates。
 */

import { revalidateTag, unstable_cache } from "next/cache";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { listActiveTemplatesForOrderCreate } from "@/features/gpt-image/lib/admin-services";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

const TEMPLATES_TAG = "templates";

const cachedList = unstable_cache(
  async () => listActiveTemplatesForOrderCreate(),
  ["templates-list-active"],
  { revalidate: 60, tags: [TEMPLATES_TAG] }
);

async function handler() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "未登录" },
      { status: 401 }
    );
  }
  try {
    const templates = await cachedList();
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

export const GET = withApiLogging(handler);

// 管理员模板管理触发 revalidateTag 时，把这里也失效掉，避免新建的 active
// 模板在 60s 缓存里看不到。
export { revalidateTag, TEMPLATES_TAG };
