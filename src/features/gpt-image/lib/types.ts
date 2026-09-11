/**
 * GPT-Image 业务共享类型定义
 *
 * 与 src/db/schema.ts 的数据库类型不同：
 * - 这里返回给前端的类型用 camelCase + ISO 字符串时间
 * - 与源项目 D:\gpt-image-2-source-2026-08-04 的 src/lib/types.ts 保持一致
 */

import type { PromptOrderHistoryTrigger, PromptOrderStatus } from "@/db/schema";
import type { PlatformCode } from "./product-catalog";

export type OrderStatus =
  | "PENDING" // 等待用户上传图片
  | "GENERATING" // 效果图生成中
  | "CANDIDATES_READY" // 效果图就绪，等待用户选择
  | "SELECTED" // 用户已选择（不可修改，只能取消）
  | "CANCELLED" // 已取消
  | "FAILED"; // 生成失败

/** 模板在前端的展示结构 */
export interface PromptTemplateView {
  id: string;
  name: string;
  description: string;
  /**
   * 提示词内容。管理端（/admin/prompt-templates）始终返回；
   * 公开 API（/api/templates，给登录用户创建订单时下拉用）刻意不返回，避免提示词泄漏给非管理员。
   * image-gen 工作台是 RSC 直接读 DB，能拿到 prompt —— 见 prompt-template-source.ts 的注释。
   */
  prompt?: string;
  size: string;
  candidateCount: number;
  coverUrl: string | null;
  isActive: boolean;
  /**
   * 2026-09-01：候选输出模式（参见 DB schema 注释）。
   * - "grid"（默认）：Lingting 返 1 张拼接图，UI 用 QuadrantGrid CSS overlay 切分
   * - "separate"：Lingting 返 N 张独立图，UI 遍历渲染
   * 老模板 DB 默认 'grid'；新建/编辑时可在 admin UI 切。
   */
  outputMode?: "grid" | "separate";
  /**
   * 提示词变量定义（Phase A 起 image-gen 工作台与 gpt-image 共用 promptTemplate 表后新增）。
   * 让管理员能配置 {{变量}} 模板，工作台用户在生成前填值替换。
   * gpt-image 用户端无消费但仍保留字段以保持 admin UI 一致。
   */
  variables?: PromptVariable[];
  /**
   * 推荐生图模型 id。image-gen 工作台选中模板时会锁定该模型；
   * gpt-image 用户端无消费。null/undefined = 用户在 UI 自由选。
   */
  model?: string | null;
  /**
   * 模板价格（元，整数）。image-gen 工作台 Select item 末尾展示 `· ¥{price}`；
   * gpt-image 用户端无消费。0 = 免费。
   */
  price?: number;
  /**
   * 2026-09-07：关联商品类别（R/A/P/RM/LB）。
   * null = 未指定（老 ToC 模板）。
   */
  productTypeCode?: string | null;
  createdAt: string;
  updatedAt: string;
  /** 关联订单数（管理端列表用） */
  orderCount?: number | undefined;
}

import type { PromptVariable } from "@/db/image-gen-types";

/** 订单来源平台：业务侧 ToB 渠道归因
 *
 * 2026-09-11：从 5 项老字典（taobao/douyin/xiaohongshu/kol/partner）扩到 8 项，
 * 字典统一迁到 src/features/gpt-image/lib/product-catalog.ts 的 PLATFORMS /
 * PlatformCode。历史 OrderPlatform / ORDER_PLATFORMS / ORDER_PLATFORM_LABELS
 * 在本次重构里全部删除（前者只是 5 项 subset，留着会跟新字典撞名）。
 *
 * DB schema 端 promptOrderPlatformEnum 列与本字典解耦：表里 `platform` 列
 * 是 text（无 CHECK），保留任意字符串值。pgEnum `prompt_order_platform` 是
 * 历史遗留，本次新增字段不挂 enum，避免对生产 DB 做 migration。
 */
export type OrderPlatform = PlatformCode;
export type { PlatformCode } from "./product-catalog";

/** 用户端订单详情结构（不含 prompt） */
export interface OrderView {
  id: string;
  orderNo: string;
  templateId: string;
  /** 用户昵称（创建订单时选填，留空时不在任何页面显示） */
  recipientName: string;
  token: string;
  status: OrderStatus;
  hasUploadedImage: boolean;
  /** 实际已上传的图片数量（渐进式上传，可能 < uploadCount） */
  uploadedImageCount: number;
  /** 用户可上传的批次次数（默认 1）。总容量 = uploadCount × imagesPerUpload */
  uploadCount: number;
  /** 每批上传的原图参考图数量（1-3，默认 3） */
  imagesPerUpload: number;
  /** 每张原图对应的效果图数量（来自模板） */
  candidateCount: number;
  /** 已生成的候选组数（外层数组长度） */
  candidateGroups: number;
  /**
   * 每批可主动"重新生成"的次数上限。仅 batchIdx 单批路径计数；
   * 批量重跑 / FAILED 一键重试不计。每个 batchIdx 独立计数，互不挤占。
   */
  regenerateLimit: number;
  /**
   * 每批已用重新生成次数（promptOrderHistory 中 trigger='regenerate_single'
   * AND imageIdx=batchIdx 的行数）。长度对齐 batchCount。
   * 仅在用户端订单视图出现；admin 列表暂不展开（admin 通过历史快照间接看到）。
   */
  regenerateUsedByBatch?: number[] | undefined;
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
  // ============================================
  // 2026-09-08：(agent) 业务已砍 —— 删 agentId / agentName 字段。
  // promptOrder.agentId 列保留（DB 端不删，老订单归属仍可查），
  // 但前端 UI / listOrders 不再返回 / 展示。
  // ============================================
  /** 产品型号（R/A/P/RM/LB），null = 未指定 */
  productTypeCode: string | null;
  /** 尺寸（厘米数字字符串），null = 未指定 */
  productSize: string | null;
  /** 配件（leather/pvc/bracket），null = 无配件或未指定 */
  accessoryCode: string | null;
  // ============================================
  // 2026-09-07：终端用户定制（/p/[token] 上由用户填）
  // 2 字段全部 nullable，能力外或未填时都是 null。
  //
  // 历史：初版还有 hasLeatherBadge 字段（R 钥匙扣的能力），同日下午
  // 重构为 LB（皮革徽章）独立产品型号，已删除。
  // ============================================
  /** 刻字内容（仅 canEngrave=true 的型号可填） */
  engravingText: string | null;
  /** 刻字是否外露（独立 boolean） */
  engravingExposed: boolean | null;
  // ============================================
  // 2026-09-10：LB 皮革徽章扩展定制（capability-gated）
  // 4 字段全部 nullable；非 LB 型号 / 未填时为 null。
  // leatherExposed 与 engravingExposed 独立语义（实物外露 vs 文字外露）。
  // ============================================
  /** 皮革颜色 code（仅 canLeatherColor=true 可填，对应 LEATHER_COLORS 字典） */
  leatherColor: string | null;
  /** 皮革实物是否外露（仅 canLeatherExposed=true；与 engravingExposed 解耦） */
  leatherExposed: boolean | null;
  /** 是否带 PVC 透明保护膜（仅 canPvcProtection=true） */
  pvcProtection: boolean | null;
  /** 备注（仅 canHaveRemarks=true；不参与生图，内部沟通用） */
  remarks: string | null;
  /**
   * 2026-09-11：订单来源平台（仅 canPlatform=true 可填，对应 PLATFORMS 字典）。
   * 业务侧 ToB 渠道归因：admin 复盘 + 活动结算按这个 group by。
   * null = 用户未选 / 未知渠道；非 LB 型号不渲染此字段。
   *
   * 类型沿用 ProductCapabilities.canPlatform 的字典 PlatformCode —— 8 项
   * （taobao / xiaohongshu / douyin / independent_site / domestic_influencer /
   * foreign_influencer / partner / marketing）；OrderPlatform 只是 PlatformCode
   * 的别名（向下兼容老调用点）。
   */
  platform: PlatformCode | null;
  /**
   * 2026-09-11：渠道订单号（与 platform 配对；仅 LB canPlatform=true 业务）。
   * 用户在淘宝 / 小红书 / 抖音 等外部渠道下单时填入的"渠道侧订单号"，用于
   * 代理商对账。null = 用户未选 platform / 渠道订单号不知道 / 不展示。
   *
   * 跨平台订单号体系：淘宝 15~18 位数字、小红书字母数字混合、抖音 ID 等，
   * 不强制结构化。DB 存 text，应用层只在 canPlatform=true 且 platform 有值
   * 时建议填，不强校验格式。
   */
  platformOrderNo: string | null;
  template: {
    id: string;
    name: string;
    description: string;
    coverUrl: string | null;
    candidateCount: number;
    /**
     * 2026-09-01：候选输出模式（参见 PromptTemplateView.outputMode）。
     * UI 用它分支：grid 走 QuadrantGrid 切 1 张拼接图；separate 遍历 N 张独立候选。
     */
    outputMode?: "grid" | "separate";
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
  /**
   * 2026-09-02：保留 imageCount 字段 = 快照时实际原图张数（向后兼容老快照）。
   * batchCount 是派生字段（新快照附带）= ceil(imageCount / imagesPerUpload)；
   * select-step 用 batchCount 索引 candidates，老快照缺此字段时回退用 imageCount。
   */
  imageCount: number;
  batchCount?: number;
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
