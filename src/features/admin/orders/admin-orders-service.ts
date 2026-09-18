/**
 * /admin/orders 全局订单管理 — 服务层（2026-09-18）
 *
 * 纯服务端函数，被 adminAction 调用。**不**做任何 RBAC（adminAction 包装保证 role==='admin'）。
 *
 * 3 个核心操作：
 * 1. listAllOrdersAdmin({ filters, cursor, limit })
 *    - Drizzle select + JOIN user/template
 *    - WHERE: status / platform / createdBy / search / dateRange / cursor
 *    - ORDER BY created_at DESC, id DESC
 *    - LIMIT 30+1（keyset cursor 翻页）
 *    - 走 drizzle/0043_admin_prompt_order_indexes.sql 的两个新索引
 *
 * 2. cancelOrderForAdmin(orderId, reason?)
 *    - 原子 UPDATE WHERE status != 'CANCELLED' RETURNING
 *    - 仅第一个拿到 RETURNING 行的 caller 会触发 refund
 *    - refund 走 grantCredits（sourceType=refund / transactionType=refund）
 *    - 退 creditsCharged：与 preview 流 cancel 对齐（区别：preview 退预扣 creditsLocked；
 *      promptOrder 退已扣 creditsCharged）
 *
 * 3. updateOrderRemarksForAdmin(orderId, remarks)
 *    - 单字段 UPDATE remarks（last-write-wins，无并发冲突）
 *
 * 设计选择：service 层不调 revalidatePath，由 adminAction 层负责刷缓存。
 */

import { and, desc, eq, gte, like, lt, lte, ne, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { promptOrder, promptTemplate, user } from "@/db/schema";
import { grantCredits } from "@/features/credits/grant";
// 复用 order-helpers.ts 的 JSON 列解析（与 admin-services.ts/listOrders 一致）
import {
  parseCandidates,
  parseUploadedImages,
} from "@/features/gpt-image/lib/order-helpers";
import { logger } from "@/lib/logger";
import type {
  AdminOrderCursor,
  AdminOrderFilters,
  AdminOrderRow,
  AdminOrdersListResponse,
} from "./types";

const DEFAULT_LIMIT = 30;

/**
 * Resolve selected image idx from selections / selectedIndex，兼容老 schema。
 * 直接移植 src/features/image-gen/actions/order.ts:resolveSelectedImageIdx（私有）。
 */
function resolveSelectedImageIdx(
  selectionsRaw: string | null,
  selectedIndex: number | null
): number {
  if (selectionsRaw) {
    try {
      const selections: unknown = JSON.parse(selectionsRaw);
      if (Array.isArray(selections)) {
        for (let i = 0; i < selections.length; i++) {
          if (typeof selections[i] === "number") return i;
        }
      }
    } catch {
      // ignore
    }
  }
  return selectedIndex ?? 0;
}

/**
 * Resolve selected cell（demo 流 / gpt-image 流语义对齐）。
 * 移植 src/features/image-gen/actions/order.ts:resolveSelectedCell。
 */
function resolveSelectedCell(
  selectionsRaw: string | null,
  selectedImageIdx: number
): number | null {
  if (!selectionsRaw) return null;
  try {
    const selections: unknown = JSON.parse(selectionsRaw);
    if (!Array.isArray(selections)) return null;
    const cell = selections[selectedImageIdx];
    return typeof cell === "number" ? cell : null;
  } catch {
    return null;
  }
}

/**
 * Flatten nested candidates → string[]（OrderDetailView.candidateUrls）。
 * 移植 src/features/image-gen/actions/order.ts:parseCandidates（私有）。
 */
function flattenCandidates(raw: string | null): string[] {
  const nested = parseCandidates(raw);
  const flat: string[] = [];
  for (const group of nested) {
    for (const url of group) {
      if (typeof url === "string") flat.push(url);
    }
  }
  return flat;
}

/**
 * Extract thumbnail URL（列表行展示用）：
 * - 优先 selections[selectedImageIdx][cellIdx]
 * - 退回 candidates[0][0]
 * - null = 还没候选图
 * 移植 src/features/image-gen/actions/order.ts:extractOrderThumbnail。
 */
function extractThumbnail(
  candidatesRaw: string | null,
  selectionsRaw: string | null,
  selectedIndex: number | null
): string | null {
  if (!candidatesRaw) return null;
  try {
    const candidates: unknown = JSON.parse(candidatesRaw);
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const firstImage = candidates[0];
    if (!Array.isArray(firstImage) || firstImage.length === 0) return null;
    const firstUrl = firstImage[0];
    if (typeof firstUrl !== "string") return null;
    if (selectionsRaw) {
      try {
        const selections: unknown = JSON.parse(selectionsRaw);
        if (
          Array.isArray(selections) &&
          typeof selectedIndex === "number" &&
          selectedIndex >= 0 &&
          selectedIndex < selections.length
        ) {
          const candIdx = selections[selectedIndex];
          if (typeof candIdx === "number" && firstImage[candIdx]) {
            return firstImage[candIdx] as string;
          }
        }
      } catch {
        // ignore
      }
    }
    return firstUrl;
  } catch {
    return null;
  }
}

/**
 * /admin/orders 列表查询（admin 全局视角 + keyset cursor 翻页）
 *
 * @param filters 过滤维度（status / platform / createdBy / search / dateFrom / dateTo）
 * @param cursor 上一页最后一条的 { createdAt: ISO, id }；null = 第一页
 * @param limit 单页行数（默认 30；最大 100 防误用）
 */
export async function listAllOrdersAdmin({
  filters,
  cursor,
  limit = DEFAULT_LIMIT,
}: {
  filters: AdminOrderFilters;
  cursor: AdminOrderCursor | null;
  limit?: number;
}): Promise<AdminOrdersListResponse> {
  // limit 上限保护
  const safeLimit = Math.min(Math.max(limit, 1), 100);

  // ============================================
  // WHERE 构造
  // ============================================
  const whereClauses: ReturnType<typeof and>[] = [];

  if (filters.status) {
    whereClauses.push(eq(promptOrder.status, filters.status));
  }
  if (filters.platform) {
    whereClauses.push(eq(promptOrder.platform, filters.platform));
  }
  if (filters.createdBy) {
    whereClauses.push(eq(promptOrder.createdBy, filters.createdBy));
  }
  if (filters.search && filters.search.length > 0) {
    // orderNo LIKE —— 与 listUserOrdersAction 一致（不扩到模板名，避免拖累主表）
    whereClauses.push(like(promptOrder.orderNo, `%${filters.search}%`));
  }
  if (filters.dateFrom) {
    whereClauses.push(gte(promptOrder.createdAt, new Date(filters.dateFrom)));
  }
  if (filters.dateTo) {
    // dateTo 闭区间 = 当天 23:59:59.999
    const endOfDay = new Date(filters.dateTo);
    endOfDay.setHours(23, 59, 59, 999);
    whereClauses.push(lte(promptOrder.createdAt, endOfDay));
  }

  // cursor：keyset 翻页（OR + AND）
  if (cursor) {
    const cursorDate = new Date(cursor.createdAt);
    whereClauses.push(
      or(
        lt(promptOrder.createdAt, cursorDate),
        and(
          eq(promptOrder.createdAt, cursorDate),
          lt(promptOrder.id, cursor.id)
        )
      )!
    );
  }

  // ============================================
  // SELECT（+ limit+1 用于判断 hasMore）
  // ============================================
  const rows = await db
    .select({
      // promptOrder 全部字段（详情 modal 用；只 SELECT 必要列更省但表不大）
      id: promptOrder.id,
      orderNo: promptOrder.orderNo,
      templateId: promptOrder.templateId,
      recipientName: promptOrder.recipientName,
      token: promptOrder.token,
      status: promptOrder.status,
      uploadCount: promptOrder.uploadCount,
      imagesPerUpload: promptOrder.imagesPerUpload,
      regenerateLimit: promptOrder.regenerateLimit,
      uploadedImages: promptOrder.uploadedImages,
      candidates: promptOrder.candidates,
      selectedIndex: promptOrder.selectedIndex,
      selections: promptOrder.selections,
      errorMessage: promptOrder.errorMessage,
      uploadedAt: promptOrder.uploadedAt,
      generatedAt: promptOrder.generatedAt,
      selectedAt: promptOrder.selectedAt,
      cancelledAt: promptOrder.cancelledAt,
      createdAt: promptOrder.createdAt,
      updatedAt: promptOrder.updatedAt,
      productTypeCode: promptOrder.productTypeCode,
      productSize: promptOrder.productSize,
      accessoryCode: promptOrder.accessoryCode,
      engravingText: promptOrder.engravingText,
      engravingExposed: promptOrder.engravingExposed,
      leatherColor: promptOrder.leatherColor,
      leatherExposed: promptOrder.leatherExposed,
      pvcProtection: promptOrder.pvcProtection,
      remarks: promptOrder.remarks,
      platform: promptOrder.platform,
      platformOrderNo: promptOrder.platformOrderNo,
      creditsCharged: promptOrder.creditsCharged,
      creditsBreakdown: promptOrder.creditsBreakdown,
      // JOIN user（createdBy 信息）
      createdBy: promptOrder.createdBy,
      createdByName: user.name,
      createdByEmail: user.email,
      // JOIN promptTemplate（templateName / outputMode / candidateCount）
      tName: promptTemplate.name,
      tCandidateCount: promptTemplate.candidateCount,
      tOutputMode: promptTemplate.outputMode,
    })
    .from(promptOrder)
    .leftJoin(user, eq(promptOrder.createdBy, user.id))
    .leftJoin(promptTemplate, eq(promptOrder.templateId, promptTemplate.id))
    .where(whereClauses.length > 0 ? and(...whereClauses) : sql`true`)
    .orderBy(desc(promptOrder.createdAt), desc(promptOrder.id))
    .limit(safeLimit + 1);

  // ============================================
  // 翻页：limit+1 → 多一条即 nextCursor = 末行；lastPageRow 不返回
  // ============================================
  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const lastPageRow = pageRows.at(-1);
  const nextCursor: AdminOrderCursor | null =
    hasMore && lastPageRow
      ? {
          createdAt: lastPageRow.createdAt.toISOString(),
          id: lastPageRow.id,
        }
      : null;

  // ============================================
  // Map → AdminOrderRow（含模板字段 / 缩略图 / 解析后的 JSON 列）
  // ============================================
  const mappedRows: AdminOrderRow[] = pageRows.map((r) => {
    const selectedImageIdx = resolveSelectedImageIdx(
      r.selections,
      r.selectedIndex
    );
    const selectedCell = resolveSelectedCell(r.selections, selectedImageIdx);
    const cc = r.tCandidateCount ?? 1;
    const om = (r.tOutputMode ?? "grid") as "grid" | "separate";

    return {
      // OrderDetail 基础
      orderId: r.id,
      orderNo: r.orderNo,
      token: r.token,
      status: r.status,
      productTypeCode: r.productTypeCode ?? null,
      productSize: r.productSize ?? null,
      accessoryCode: r.accessoryCode ?? null,
      engravingText: r.engravingText ?? null,
      engravingExposed: r.engravingExposed ?? null,
      leatherColor: r.leatherColor ?? null,
      leatherExposed: r.leatherExposed ?? null,
      pvcProtection: r.pvcProtection ?? null,
      remarks: r.remarks ?? null,
      platform: r.platform ?? null,
      platformOrderNo: r.platformOrderNo ?? null,
      creditsCharged: r.creditsCharged ?? null,
      creditsBreakdown: r.creditsBreakdown ?? null,
      templateName: r.tName ?? "（模板已删除）",
      templateId: r.templateId,
      candidateCount: cc,
      outputMode: om,
      selectedCell,
      candidateUrls: flattenCandidates(r.candidates),
      selectedImageIdx,
      uploadedImageUrls: parseUploadedImages(r.uploadedImages),
      thumbnailUrl: extractThumbnail(
        r.candidates,
        r.selections,
        r.selectedIndex
      ),
      createdAt: r.createdAt.toISOString(),
      // admin 独有
      // promptOrder.createdBy 在 DB 上是 nullable，但业务上每个订单必有创建者；
      // 落到 UI 这里用空串兜底（createdByName/Email 已 null-safe）。
      createdById: r.createdBy ?? "",
      createdByName: r.createdByName ?? "未知用户",
      createdByEmail: r.createdByEmail ?? "",
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
    };
  });

  return { rows: mappedRows, nextCursor };
}

/**
 * 管理员取消订单 —— 原子 compare-and-set + 退 credits
 *
 * 与 /api/orders/[token]/cancel/route.ts 的 promptOrder 分支行为差异：
 * - 原版只翻 status=CANCELLED，不退积分（终态动作）
 * - 本函数额外调 grantCredits 退还 creditsCharged（与 preview 流对齐）
 * - 注释见 src/app/api/orders/[token]/cancel/route.ts:25-29
 *
 * 并发安全：
 *   UPDATE ... WHERE status != 'CANCELLED' RETURNING —— 双 admin 抢同一单时
 *   只有第一个拿到 RETURNING 行的人会触发 refund。第二个会拿到空数组 → 抛 "已取消"。
 *
 * 退款失败保护：
 *   try/catch 包 grantCredits，失败 logger.error 记 metadata.orderId/adminId，
 *   不让 cancel 整体翻车（status 已变 CANCELLED，留给 reconcile 脚本扫）。
 *
 * @param orderId 订单 id（不是 token）
 * @param adminId 操作管理员 id（用于退款 metadata 审计）
 * @param reason 取消原因（可空，仅写日志 / 不持久化；promptOrder 无 reason 列）
 */
export async function cancelOrderForAdmin({
  orderId,
  adminId,
  reason,
}: {
  orderId: string;
  adminId: string;
  reason?: string | null;
}): Promise<{
  orderId: string;
  status: "CANCELLED";
  refundedCredits: number;
}> {
  // 1) 原子 compare-and-set：status 必须不是 CANCELLED 才更新
  const [updated] = await db
    .update(promptOrder)
    .set({
      status: "CANCELLED",
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(promptOrder.id, orderId), ne(promptOrder.status, "CANCELLED"))
    )
    .returning({
      id: promptOrder.id,
      status: promptOrder.status,
      creditsCharged: promptOrder.creditsCharged,
      createdBy: promptOrder.createdBy,
      orderNo: promptOrder.orderNo,
    });

  if (!updated) {
    throw new Error("订单已取消或不存在");
  }
  if (updated.status !== "CANCELLED") {
    throw new Error("订单状态异常");
  }

  // 2) 退 creditsCharged（仅当 > 0 且有 createdBy）
  const creditsToRefund = updated.creditsCharged ?? 0;
  const createdBy = updated.createdBy;
  let refundedCredits = 0;
  if (creditsToRefund > 0 && createdBy) {
    try {
      await grantCredits({
        userId: createdBy,
        amount: creditsToRefund,
        sourceType: "refund",
        transactionType: "refund",
        debitAccount: "SYSTEM:admin_cancel_refund",
        description: `管理员取消订单 ${updated.orderNo}，退还 ${creditsToRefund} 积分${
          reason ? `（原因：${reason}）` : ""
        }`,
        metadata: {
          trigger: "admin_cancel",
          orderId: updated.id,
          orderNo: updated.orderNo,
          adminId,
          reason: reason ?? null,
        },
      });
      refundedCredits = creditsToRefund;
    } catch (err) {
      logger.error(
        {
          err,
          orderId: updated.id,
          orderNo: updated.orderNo,
          adminId,
          creditsToRefund,
        },
        "admin cancel: 退还积分失败（status 已翻 CANCELLED，需 reconcile）"
      );
      // 不抛：cancel 已经成功，退款失败留给 reconcile 扫
    }
  }

  return {
    orderId: updated.id,
    status: "CANCELLED",
    refundedCredits,
  };
}

/**
 * 管理员改订单备注 —— 仅修改 remarks 字段
 *
 * 单字段 UPDATE：last-write-wins 可接受（多 admin 同时改同单备注的业务场景罕见）。
 *
 * @returns 更新后的 remarks（写入可能被 DB 规范化，这里返 echo）
 */
export async function updateOrderRemarksForAdmin({
  orderId,
  remarks,
}: {
  orderId: string;
  /** null/undefined = 清空备注；空字符串也按清空处理 */
  remarks: string | null | undefined;
}): Promise<{ orderId: string; remarks: string | null }> {
  // trim 后空字符串 → null（与 /image-gen SpecModal 端到端约束一致）
  const trimmed =
    typeof remarks === "string" && remarks.trim().length > 0
      ? remarks.trim()
      : null;

  const [updated] = await db
    .update(promptOrder)
    .set({
      remarks: trimmed,
      updatedAt: new Date(),
    })
    .where(eq(promptOrder.id, orderId))
    .returning({ id: promptOrder.id, remarks: promptOrder.remarks });

  if (!updated) {
    throw new Error("订单不存在");
  }

  return { orderId: updated.id, remarks: updated.remarks ?? null };
}
