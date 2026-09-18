/**
 * /admin/orders 全局订单管理 — 共享类型（2026-09-18）
 *
 * 设计要点：
 * - `AdminOrderRow` 完整覆盖 OrderDetail（直接复用 OrderDetailView）+ admin 视角
 *   独有字段（createdById/Name/Email），不另发请求即在 modal 内转 OrderDetail。
 * - `AdminOrderCursor` 对齐 listUserOrdersAction 的 keyset cursor 形
 *   （{ createdAt: ISO string, id }），复用同套 OR/AND 翻页 SQL。
 * - `AdminOrdersListResponse` 是单页响应：admin 前端用 useInfiniteQuery 风格累加。
 *
 * 与 listUserOrdersAction 的区别：
 * - 跨 createdBy（admin 全局视角）
 * - 加 status / platform / createdBy / dateRange / search 5 个维度过滤
 * - 走 drizzle 的 (status, createdAt DESC, id DESC) / (createdAt DESC, id DESC)
 *   两索引（drizzle/0043_admin_prompt_order_indexes.sql）
 */

import type { PromptOrderStatus } from "@/db/schema";
import type { PlatformCode } from "@/features/gpt-image/lib/product-catalog";
import type { OrderDetail } from "@/features/image-gen/components/order-detail-view";

/**
 * /admin/orders 列表行 —— 完整 OrderDetail + admin 独有字段（创建者信息）
 *
 * 字段覆盖（与 OrderDetail 完全对齐）：
 * - 已选规格（productTypeCode / productSize / accessoryCode / engraving*）
 * - LB 皮革徽章定制（leatherColor / leatherExposed / pvcProtection / remarks）
 * - 订单来源（platform / platformOrderNo）
 * - 主图 / 原图 / 候选（candidateUrls / uploadedImageUrls / selectedImageIdx / selectedCell）
 * - 模板信息（templateName / templateId / candidateCount / outputMode）
 * - 缩略图（thumbnailUrl）
 * - 积分对账（creditsCharged / creditsBreakdown）
 *
 * admin 独有：
 * - createdById / createdByName / createdByEmail：admin 表格行展示「由谁下单」
 * - cancelledAt：取消时间，方便审计
 */
export interface AdminOrderRow extends OrderDetail {
  /**
   * 订单创建者 user.id（admin 表格行展示「由谁下单」）。
   * 等于 promptOrder.createdBy。
   */
  createdById: string;
  /**
   * 创建者姓名（user.name）。null/空 → "未知用户"。
   */
  createdByName: string;
  /**
   * 创建者邮箱（user.email），admin 排查 / 对账辅助。
   */
  createdByEmail: string;
  /**
   * 取消时间 ISO 字符串（status=CANCELLED 时才有值；其余 null）。
   */
  cancelledAt: string | null;
}

/**
 * Keyset cursor —— 与 listUserOrdersAction 同一形
 * （{ createdAt: ISO, id }），翻页 SQL 直接 OR/AND 复用。
 */
export interface AdminOrderCursor {
  createdAt: string;
  id: string;
}

/**
 * 过滤维度（admin 端 5 维）：
 * - status：单选（与 OrderStatus 对齐）
 * - platform：单选 PLATFORMS code（null/undefined = 不限平台）
 * - createdBy：单选 user.id（null/undefined = 不限创建者）
 * - search：模糊匹配 orderNo（LIKE %X%），复用 listUserOrdersAction 已 suffer 的实现
 * - dateFrom / dateTo：createdAt 闭区间（含 endOfDay）
 */
export interface AdminOrderFilters {
  status?: PromptOrderStatus | undefined;
  platform?: PlatformCode | undefined;
  createdBy?: string | undefined;
  /**
   * 搜索关键字：当前对齐 listUserOrdersAction，只 LIKE orderNo。
   * 若需扩「按模板名搜索」可参考 listUserOrdersAction 的 matchingTemplateIds 模式。
   */
  search?: string | undefined;
  /** ISO string e.g. "2026-09-01"；转 Date(start-of-day) */
  dateFrom?: string | undefined;
  /** ISO string；转 Date(end-of-day) */
  dateTo?: string | undefined;
}

/**
 * 单页 list 响应：rows + nextCursor（null = 已到底）。
 */
export interface AdminOrdersListResponse {
  rows: AdminOrderRow[];
  nextCursor: AdminOrderCursor | null;
}
