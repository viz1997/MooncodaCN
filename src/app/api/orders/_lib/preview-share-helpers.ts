/**
 * preview_share 共享 helpers（2026-09-14）
 *
 * 提供给 10 个 /api/orders/[token]/* 路由复用：
 * - getPreviewShareByToken(token): 单点查询入口（preview 优先）
 * - projectPreviewToOrderView(share): 把 preview_share 投影成 OrderView 形状
 *   让 /api/orders/[token] GET 路由返回的 OrderView 客户端 useOrder 解析无感
 *
 * 设计动机：preview 流走自己的 preview_share 表（独立实体，分享链接 ≠ 下单），
 * 但客人侧 6 步 UI（UploadStep/GenerateStep/SelectStep/ResultStep）期望 OrderView
 * 形状。最简单的做法：服务端把 preview_share 投影成 OrderView，客户端 0 改造。
 *
 * 字段映射细节见 projectPreviewToOrderView 注释。
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { type PreviewShare, previewShare } from "@/db/schema";
import { parseCandidates } from "@/features/gpt-image/lib/order-helpers";
import type { OrderStatus, OrderView } from "@/features/gpt-image/lib/types";

/**
 * previewShare + template 关联查询的返回类型。Drizzle query 的 with relations
 * 在 TS 推断下偶尔丢字段（运行时正常），这里显式声明让所有路由 import
 * 时拿到完整形状。
 */
export type PreviewShareWithTemplate = PreviewShare & {
  template: {
    id: string;
    name: string;
    description: string;
    coverUrl: string | null;
    candidateCount: number;
    outputMode: string | null;
  };
};

/**
 * 按 token 查 preview_share 凭证（status/expires 都不校验，由调用方决定）。
 * 找不到返 null。
 */
export async function getPreviewShareByToken(
  token: string
): Promise<PreviewShareWithTemplate | null> {
  const share = await db.query.previewShare.findFirst({
    where: eq(previewShare.token, token),
    with: {
      template: {
        columns: {
          id: true,
          name: true,
          description: true,
          coverUrl: true,
          candidateCount: true,
          outputMode: true,
        },
      },
    },
  });
  return (share ?? null) as PreviewShareWithTemplate | null;
}

/**
 * preview 流状态字符串 → OrderView 状态枚举。
 *
 * preview 9 态：pending / uploaded / generating / candidates_ready / selected /
 * confirmed / failed / cancelled / expired
 * OrderView 6 态：PENDING / GENERATING / CANDIDATES_READY / SELECTED / CANCELLED / FAILED
 *
 * 映射策略：
 * - uploaded → PENDING（客人已传图但还没点开始生图 → 显示「等待生成」）
 * - confirmed → SELECTED（终态，对客人等价于订单已确认）
 * - expired → CANCELLED（客人侧「链接失效」与「已取消」同视觉处理）
 */
export function previewStatusToOrderStatus(previewStatus: string): OrderStatus {
  switch (previewStatus) {
    case "pending":
    case "uploaded":
      return "PENDING";
    case "generating":
      return "GENERATING";
    case "candidates_ready":
      return "CANDIDATES_READY";
    case "selected":
    case "confirmed":
      return "SELECTED";
    case "failed":
      return "FAILED";
    case "cancelled":
    case "expired":
      return "CANCELLED";
    default:
      return "PENDING";
  }
}

/**
 * 把 preview_share 行投影成 OrderView 形状。
 *
 * 字段差异与映射策略：
 * - id: 用 preview_share.id（与 promptOrder.id 同样 nanoid）
 * - orderNo: 用 preview_share.orderNo（IG-YYYYMMDD-XXXXXX 格式）
 * - token: preview_share.token
 * - status: 走 previewStatusToOrderStatus 映射
 * - recipientName: 始终空字符串（preview 流无收件人概念）
 * - hasUploadedImage: parsed uploadedImages 长度 > 0
 * - uploadedImageCount: parsed uploadedImages 长度
 * - uploadCount: preview_share.uploadCount（默认 1）
 * - imagesPerUpload: preview 流硬编码 1
 * - candidateCount: 从 template.candidateCount 读
 * - candidateGroups: parsed candidates 外层数组长度
 * - regenerateLimit: preview_share.regenerateLimit（默认 3）
 * - regenerateUsedByBatch: 投影成 [usedRegenerateCount]，长度对齐 candidateGroups
 *   —— preview 流 batchCount=1 时只有一个 batch 用量
 * - selections: 解析 preview_share.selections JSON
 * - selectedIndex: preview_share.selectedIndex
 * - errorMessage: preview_share.errorMessage
 * - uploadedAt / generatedAt / selectedAt / cancelledAt: 直接镜像
 * - createdAt / updatedAt: 直接镜像
 * - spec 字段（productTypeCode/productSize/...）: 直接镜像
 * - template: 从 with 加载的关联
 *
 * 缺失的 promptOrder 字段（agentId / regenerateLimitBatch / expiresAt 等）一律置默认值，
 * 客户端 useOrder / useSelections 不会读这些字段。
 */
export function projectPreviewToOrderView(
  share: PreviewShareWithTemplate
): OrderView {
  const uploaded = parseUploadedImages(share.uploadedImages);
  const candidates = parseCandidates(share.candidates as string | null);
  const selections = parseSelections(share.selections);
  const status = previewStatusToOrderStatus(share.status);
  const candidateGroups = candidates.length;
  const regenerateUsedByBatch = Array.from(
    { length: Math.max(1, candidateGroups) },
    () => share.usedRegenerateCount ?? 0
  );

  return {
    id: share.id,
    orderNo: share.orderNo,
    templateId: share.templateId,
    recipientName: "",
    token: share.token,
    status,
    hasUploadedImage: uploaded.length > 0,
    uploadedImageCount: uploaded.length,
    uploadCount: share.uploadCount ?? 1,
    imagesPerUpload: share.imagesPerUpload ?? 1,
    candidateCount: share.template.candidateCount,
    candidateGroups,
    regenerateLimit: share.regenerateLimit ?? 3,
    regenerateUsedByBatch,
    selections,
    selectionCount: selections?.filter((s) => s !== null).length,
    selectedIndex: share.selectedIndex ?? null,
    errorMessage: share.errorMessage ?? null,
    uploadedAt: share.uploadedAt?.toISOString() ?? null,
    generatedAt: share.generatedAt?.toISOString() ?? null,
    selectedAt: share.selectedAt?.toISOString() ?? null,
    cancelledAt: share.cancelledAt?.toISOString() ?? null,
    createdAt: share.createdAt.toISOString(),
    updatedAt: share.updatedAt.toISOString(),
    // spec 字段镜像
    productTypeCode: share.productTypeCode ?? null,
    productSize: share.productSize ?? null,
    accessoryCode: share.accessoryCode ?? null,
    engravingText: share.engravingText ?? null,
    engravingExposed: share.engravingExposed ?? null,
    leatherColor: share.leatherColor ?? null,
    leatherExposed: share.leatherExposed ?? null,
    pvcProtection: share.pvcProtection ?? null,
    remarks: share.remarks ?? null,
    platform: (share.platform as OrderView["platform"]) ?? null,
    platformOrderNo: share.platformOrderNo ?? null,
    template: {
      id: share.template.id,
      name: share.template.name,
      description: share.template.description,
      coverUrl: share.template.coverUrl,
      candidateCount: share.template.candidateCount,
      outputMode:
        (share.template.outputMode as "grid" | "separate" | null) === "separate"
          ? "separate"
          : "grid",
    },
  };
}

/** 解析 preview_share.uploadedImages JSON（与 promptOrder.uploadedImages 同结构） */
function parseUploadedImages(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === "string");
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * 解析 preview_share.selections JSON → 与 promptOrder.selections 同结构（number | null）[]
 *
 * preview_share.selections 形态：JSON `{"0": 2}` 或 `[]` —— 客人选的 cell 索引按 batchIdx 索引。
 * 缺 batchIdx 的槽位补 null —— 与 OrderView.selections 语义对齐。
 */
function parseSelections(
  raw: string | null | undefined
): (number | null)[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const map = parsed as Record<string, number>;
    const keys = Object.keys(map)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0)
      .sort((a, b) => a - b);
    if (keys.length === 0) return null;
    const result: (number | null)[] = [];
    for (const k of keys) {
      result[k] = map[String(k)] ?? null;
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * 校验 preview_share 状态是否允许进入 6 步工作台（客人扫码可见）。
 *
 * 与 /p/[token]/page.tsx 的 RSC 分发一致：pending / uploaded / generating /
 * candidates_ready / selected / failed / cancelled 全部进入 PreviewOrderView，
 * confirmed / expired 单独处理（confirmed → redirect 到 promptOrder token；
 * expired → InvalidLinkScreen）。
 */
export function isPreviewVisible(share: PreviewShare): boolean {
  return [
    "pending",
    "uploaded",
    "generating",
    "candidates_ready",
    "selected",
    "failed",
    "cancelled",
  ].includes(share.status);
}

/** preview 流 9 态字面量，与 schema.ts previewShareStatusValues 对齐 */
export const PREVIEW_STATUSES = [
  "pending",
  "uploaded",
  "generating",
  "candidates_ready",
  "selected",
  "confirmed",
  "expired",
  "failed",
  "cancelled",
] as const;

export type PreviewStatus = (typeof PREVIEW_STATUSES)[number];
