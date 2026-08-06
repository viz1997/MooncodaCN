/**
 * 管理端 - 订单列表 / 创建
 * GET  /api/admin/orders
 * POST /api/admin/orders
 */

import { revalidateTag, unstable_cache } from "next/cache";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import type { PromptOrderStatus } from "@/db/schema";
import {
  createOrder as createOrderSvc,
  listOrders as listOrdersSvc,
} from "@/features/gpt-image/lib/admin-services";
import { promptOrderCreateSchema } from "@/features/gpt-image/lib/validation";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

const ORDERS_TAG = "admin-orders";

/**
 * 带缓存的列表查询 —— 60s 内复用同一份结果，避免每次管理端打开页面
 * 都打 Supabase（ap-southeast-1 跨区往返 500ms-2s）。
 * 创建 / 删除订单时通过 revalidateTag(ORDERS_TAG) 强制失效。
 */
const cachedListOrders = unstable_cache(
  async (status: string, templateId: string) =>
    listOrdersSvc({
      ...(status ? { status: status as PromptOrderStatus } : {}),
      ...(templateId ? { templateId } : {}),
    }),
  ["admin-orders-list"],
  { revalidate: 60, tags: [ORDERS_TAG] }
);

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "未登录" },
      { status: 401 }
    );
  }
  return null;
}

async function getHandler(req: NextRequest) {
  const authError = await requireSession();
  if (authError) return authError;
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") ?? undefined;
    const templateId = searchParams.get("templateId") ?? undefined;
    const orders = await cachedListOrders(status ?? "", templateId ?? "");
    return NextResponse.json({ success: true, data: orders });
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
  const authError = await requireSession();
  if (authError) return authError;
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = promptOrderCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.error.issues[0]?.message ?? "参数错误",
        },
        { status: 400 }
      );
    }
    const order = await createOrderSvc(parsed.data);
    // 创建后立即让缓存失效，保证下次 GET 拿到新数据
    // Next.js 16 要求 revalidateTag 第二参数（cache profile）
    revalidateTag(ORDERS_TAG, "max");
    return NextResponse.json({ success: true, data: order });
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
