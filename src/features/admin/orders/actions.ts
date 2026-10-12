"use server";

/**
 * /admin/orders 全局订单管理 — server actions（2026-09-18）
 *
 * 3 个 action 全部 adminAction 包装 —— 普通用户撞到就抛 "此操作需要管理员权限"。
 * 服务层实现在 ./admin-orders-service.ts。
 *
 * 缓存策略：
 * - 列表查询：每次返回最新 DB 数据，不 revalidatePath（admin 自己刷新即可）。
 *   若有 revalidateTag('orders') 之类的全局缓存可以挂，但项目里目前没有统一 orders tag。
 * - 写操作（cancel / updateRemarks）：revalidatePath('/admin/orders') +
 *   revalidatePath('/dashboard/prompt-orders')（旧 admin view 在 dashboard 还在用，
 *   保持数据一致），以及 revalidatePath 用户的 /image-gen/orders（如果是同一用户）。
 *
 *   不过严格说，revalidatePath 需要 path 而非 router segment，需要走具体路径。
 *   实际只需要 revalidatePath('/admin/orders') —— 旧 /dashboard/prompt-orders 是
 *   user 自服务入口，与 admin 取消行为不冲突（user 自己取消走 protectedAction，
 *   数据自然一致；admin 取消 SELECTED 后 user 端也要看到 CANCELLED，但 user 端
 *   列表在 (dashboard)/prompt-orders/page.tsx 下，会被 revalidatePath('/') + 通配刷掉）。
 *
 * 鉴权：
 * - adminAction 已确认 role === 'admin'，无需在 action 内再查 role
 * - 不动旧 /dashboard/prompt-orders 用的 protectedAction（user 自服务仍需）
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { adminAction } from "@/lib/safe-action";

import {
  cancelOrderForAdmin,
  listAllOrdersAdmin,
  updateOrderRemarksForAdmin,
} from "./admin-orders-service";
import type {
  AdminOrderCursor,
  AdminOrderFilters,
  AdminOrdersListResponse,
} from "./types";

const withAdminOrdersAction = (name: string) =>
  adminAction.metadata({ action: `admin.orders.${name}` });

// ============================================
// Schema —— zod 校验客户端输入
// ============================================

/**
 * PLATFORMS 字典 code（来自 product-catalog.PlatformCode union）。
 * 这里列出所有合法 code：adminSelect 选了非法值直接 400。
 */
const PLATFORM_CODE_SCHEMA = z.enum([
  "taobao",
  "xiaohongshu",
  "douyin",
  "independent_site",
  "domestic_influencer",
  "foreign_influencer",
  "partner",
  "marketing",
]);

const ORDER_STATUS_SCHEMA = z.enum([
  "PENDING",
  "GENERATING",
  "CANDIDATES_READY",
  "SELECTED",
  "CANCELLED",
  "FAILED",
]);

/**
 * 列表查询 schema
 *
 * cursor 是 nullable object（首屏不传 → null；后续页传上一页 nextCursor）。
 */
const listAllOrdersSchema = z.object({
  status: ORDER_STATUS_SCHEMA.optional(),
  platform: PLATFORM_CODE_SCHEMA.nullable().optional(),
  createdBy: z.string().min(1).max(64).nullable().optional(),
  search: z.string().max(100).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  cursor: z
    .object({
      createdAt: z.string().datetime(),
      id: z.string().min(1).max(64),
    })
    .nullable()
    .optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/**
 * 取消订单 schema
 *
 * 必填 orderId；reason 可选（管理员可留空）。
 * adminId 不由客户端传——从 ctx.userId 取，避免越权。
 */
const cancelOrderSchema = z.object({
  orderId: z.string().min(1).max(64),
  reason: z.string().trim().max(500).optional().nullable(),
});

/**
 * 改备注 schema
 *
 * remarks 可空字符串 / null → 服务层 trim 后落 null；
 * max 500 与 schema.ts 的 remarks 列宽对齐。
 */
const updateRemarksSchema = z.object({
  orderId: z.string().min(1).max(64),
  remarks: z.string().trim().max(500).nullable().optional(),
});

// ============================================
// Actions
// ============================================

/**
 * 列表查询 —— 内部走 service.listAllOrdersAdmin，
 * 自动应用 admin 全局视角（不带 createdBy 过滤）。
 *
 * 返回结构与 listUserOrdersAction 一致：
 * { rows: AdminOrderRow[], nextCursor: { createdAt, id } | null }
 */
export const adminListAllOrdersAction = withAdminOrdersAction("listAll")
  .schema(listAllOrdersSchema)
  .action(async ({ parsedInput }) => {
    const {
      status,
      platform,
      createdBy,
      search,
      dateFrom,
      dateTo,
      cursor,
      limit,
    } = parsedInput;

    // 把 nullable optional 归一为 undefined（service 层用 undefined 判断）
    const filters: AdminOrderFilters = {
      ...(status ? { status } : {}),
      ...(platform ? { platform } : {}),
      ...(createdBy ? { createdBy } : {}),
      ...(search && search.length > 0 ? { search } : {}),
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
    };

    const cursorArg: AdminOrderCursor | null = cursor ?? null;
    const limitArg = limit ?? 30;

    const result: AdminOrdersListResponse = await listAllOrdersAdmin({
      filters,
      cursor: cursorArg,
      limit: limitArg,
    });

    return result;
  });

/**
 * 取消订单 —— adminAction 守卫 → service 原子 compare-and-set → 退 credits
 *
 * 返 { orderId, status: 'CANCELLED', refundedCredits } 让前端 toast 显示退还额度。
 *
 * 并发安全由 service 层 UPDATE...WHERE status != 'CANCELLED' RETURNING 保证，
 * action 层无需额外乐观锁。
 */
export const adminCancelOrderAction = withAdminOrdersAction("cancel")
  .schema(cancelOrderSchema)
  .action(async ({ parsedInput, ctx }) => {
    const { orderId, reason } = parsedInput;

    try {
      const result = await cancelOrderForAdmin({
        orderId,
        adminId: ctx.userId,
        ...(reason !== undefined ? { reason } : {}),
      });

      // 刷新 /admin/orders + 旧 /dashboard/prompt-orders + 用户 /image-gen/orders
      // （旧 admin view + user 自服务 view 都依赖 promptOrder 最新状态）
      revalidatePath("/admin/orders");
      revalidatePath("/dashboard/prompt-orders");
      revalidatePath("/image-gen/orders");

      return {
        orderId: result.orderId,
        status: result.status,
        refundedCredits: result.refundedCredits,
        message:
          result.refundedCredits > 0
            ? `订单已取消，已退还 ${result.refundedCredits} 积分`
            : "订单已取消",
      };
    } catch (err) {
      // service 抛 "订单已取消或不存在" / "订单状态异常" 等友好错误直接透传
      logger.error(
        { err, orderId, adminId: ctx.userId },
        "admin cancel order failed"
      );
      throw err;
    }
  });

/**
 * 改订单备注 —— adminAction 守卫 → service 单字段 UPDATE
 */
export const adminUpdateRemarksAction = withAdminOrdersAction("updateRemarks")
  .schema(updateRemarksSchema)
  .action(async ({ parsedInput }) => {
    const { orderId, remarks } = parsedInput;

    const result = await updateOrderRemarksForAdmin({
      orderId,
      remarks: remarks ?? null,
    });

    revalidatePath("/admin/orders");
    // /image-gen/orders 也展示 remarks（OrderDetailView 内），同步刷
    revalidatePath("/image-gen/orders");

    return {
      orderId: result.orderId,
      remarks: result.remarks,
      message: result.remarks ? "备注已更新" : "备注已清空",
    };
  });
