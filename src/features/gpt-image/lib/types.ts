/**
 * GPT-Image 业务共享类型定义
 *
 * 与 src/db/schema.ts 的数据库类型不同：
 * - 这里返回给前端的类型用 camelCase + ISO 字符串时间
 * - 与源项目 D:\gpt-image-2-source-2026-08-04 的 src/lib/types.ts 保持一致
 */

import type { PromptOrderHistoryTrigger, PromptOrderStatus } from "@/db/schema";

export type OrderStatus =
  | "PENDING" // 等待用户上传图片
  | "GENERATING" // 效果图生成中
  | "CANDIDATES_READY" // 效果图就绪，等待用户选择
  | "SELECTED" // 用户已选择（不可修改，只能取消）
  | "CANCELLED" // 已取消
  | "FAILED"; // 生成失败

/** 模板在前端的展示结构（不含 prompt） */
export interface PromptTemplateView {
  id: string;
  name: string;
  description: string;
  /** 仅管理端可见的提示词内容 */
  prompt: string;
  size: string;
  candidateCount: number;
  coverUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** 关联订单数（管理端列表用） */
  orderCount?: number | undefined;
}

/** 订单来源平台：与 DB schema 枚举保持一致 */
export const ORDER_PLATFORMS = [
  "taobao",
  "douyin",
  "xiaohongshu",
  "kol",
  "partner",
] as const;
export type OrderPlatform = (typeof ORDER_PLATFORMS)[number];

export const ORDER_PLATFORM_LABELS: Record<OrderPlatform, string> = {
  taobao: "淘宝",
  douyin: "抖音",
  xiaohongshu: "小红书",
  kol: "红人",
  partner: "合作方",
};

/** 用户端订单详情结构（不含 prompt） */
export interface OrderView {
  id: string;
  orderNo: string;
  templateId: string;
  /** 用户昵称（创建订单时选填，留空时不在任何页面显示） */
  recipientName: string;
  token: string;
  /** 订单来源平台（可空） */
  platform: OrderPlatform | null;
  status: OrderStatus;
  hasUploadedImage: boolean;
  /** 实际已上传的图片数量（渐进式上传，可能 < uploadCount） */
  uploadedImageCount: number;
  /** 用户需要上传的图片数量（1-50） */
  uploadCount: number;
  /** 每张原图对应的效果图数量（来自模板） */
  candidateCount: number;
  /** 已生成的候选组数（外层数组长度） */
  candidateGroups: number;
  /**
   * 用户主动"重新生成第 N 张"的次数上限。仅 imageIdx 单图路径计数；
   * 批量重跑 / FAILED 一键重试不计。
   */
  regenerateLimit: number;
  /**
   * 已用重新生成次数（promptOrderHistory 中 trigger='regenerate_single' 的行数）。
   * 仅在用户端订单视图出现；admin 列表暂不展开（admin 通过历史快照间接看到）。
   */
  regenerateUsedCount?: number | undefined;
  /**
   * 每张原图的候选选择（长度 = uploadedImageCount）。
   * partial select 语义下：
   * - **CANDIDATES_READY** 状态：非 null = 已提交锁定（不可改），null = 待选
   * - **SELECTED** 终态：所有位都已锁定，整张订单确认完毕
   * - **PENDING / GENERATING** 下：尚未生成候选，整段为 null 数组
   * - **FAILED** 下：保留 FAILED 前最后一次 selections（用于恢复参考）
   */
  selections: (number | null)[] | null;
  /** 已选择数量（管理端列表用，等于 selections 中非 null 的个数） */
  selectionCount?: number | undefined;
  /** 兼容旧字段 */
  selectedIndex: number | null;
  errorMessage: string | null;
  uploadedAt: string | null;
  generatedAt: string | null;
  selectedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  template: {
    id: string;
    name: string;
    description: string;
    coverUrl: string | null;
    candidateCount: number;
  };
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "待上传",
  GENERATING: "生成中",
  CANDIDATES_READY: "待选择",
  SELECTED: "已提交",
  CANCELLED: "已取消",
  FAILED: "生成失败",
};

export const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  PENDING: "bg-slate-100 text-slate-700",
  GENERATING: "bg-blue-100 text-blue-700",
  CANDIDATES_READY: "bg-amber-100 text-amber-700",
  SELECTED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-zinc-200 text-zinc-600",
  FAILED: "bg-red-100 text-red-700",
};

/** 模板输出尺寸选项（与源项目保持一致） */
export const IMAGE_SIZES = [
  { value: "1024x1024", label: "正方形 1024×1024" },
  { value: "1344x768", label: "横版 1344×768" },
  { value: "768x1344", label: "竖版 768×1344" },
  { value: "1440x720", label: "宽幅 1440×720" },
  { value: "720x1440", label: "长图 720×1440" },
  { value: "1152x864", label: "横版 1152×864" },
  { value: "864x1152", label: "竖版 864×1152" },
] as const;

/** 效果图数量选项 */
export const CANDIDATE_COUNTS = [1, 2, 4, 9] as const;
export type CandidateCount = (typeof CANDIDATE_COUNTS)[number];

/** 模板启用的最大候选数（与 schema 默认对齐） */
export const MAX_CANDIDATE_COUNT = 9;

// ============================================
// 效果图历史快照（前端展示用）
// ============================================

/** 归档触发原因（与 DB schema 的 prompt_order_history_trigger 同步） */
export type OrderHistoryTrigger = PromptOrderHistoryTrigger;
export const HISTORY_TRIGGER_LABELS: Record<OrderHistoryTrigger, string> = {
  regenerate_single: "重新生成第 {idx} 张前",
  regenerate_all: "全部重新生成前",
  failed_reupload: "失败后换图前",
  restore: "恢复历史版本前",
};

export interface OrderHistorySnapshotView {
  id: string;
  round: number;
  trigger: OrderHistoryTrigger;
  imageIdx: number | null;
  candidateIdx: number;
  imageCount: number;
  candidateCount: number;
  size: string;
  /** selections 中非 null 数量 */
  selectionCount: number;
  createdAt: string;
  /** 走 /api/orders/[token]/candidates/[imageIdx]/0?historyId=... 拉缩略图 */
  thumbnailUrl: string;
  /** 当前订单 + 模板是否兼容（结构性 + 上传前缀 + 模板） */
  restorable: boolean;
  /** 不可恢复时的具体原因（前端 tooltip 用） */
  incompatibilityReason: string | null;
}

export interface RestoreHistoryResponseData {
  status: PromptOrderStatus;
  restoredHistoryId: string;
  round: number;
  selections: (number | null)[];
  uploadedImageCount: number;
  updatedAt: string;
}
