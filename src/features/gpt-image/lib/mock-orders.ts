/**
 * dev-only mock 数据 —— 给 /order-preview 预览页用，让前端能在没有真实订单的情况下
 * 切换各种状态走查 UI。生产路径不会引用。
 */

import type { OrderView } from "./types";

const now = new Date().toISOString();
const ago = new Date(Date.now() - 10 * 60 * 1000).toISOString();

/** 用 picsum 占位图造一张候选宫格 URL（4 宫格） */
function picsumCandidate(seed: string): string {
  return `https://picsum.photos/seed/${seed}/1024/1024`;
}

/** 用 picsum 占位图造一张原图 URL（3:4 比例） */
function picsumOriginal(seed: string): string {
  return `https://picsum.photos/seed/${seed}/768/1024`;
}

/**
 * 造一组候选宫的临时结构 —— 不强求服务端 schema，SelectStep 渲染时只读 url。
 * 这里直接复用 OrderView.candidateGroups 表示"已生成 N 组候选"，不展开具体每个候选 url。
 */
function candidateGroupsView(imageCount: number): number {
  return imageCount;
}

export const MOCK_ORDERS: Record<string, OrderView> = {
  upload1: {
    id: "mock-1",
    token: "mock-token",
    orderNo: "ORD-001",
    templateId: "t1",
    recipientName: "张三",
    platform: null,
    status: "PENDING",
    hasUploadedImage: false,
    uploadedImageCount: 0,
    uploadCount: 3,
    candidateCount: 4,
    candidateGroups: 0,
    selections: null,
    selectionCount: 0,
    selectedIndex: null,
    errorMessage: null,
    uploadedAt: null,
    generatedAt: null,
    selectedAt: null,
    cancelledAt: null,
    createdAt: ago,
    updatedAt: ago,
    template: {
      id: "t1",
      name: "证件照定制",
      description: "",
      coverUrl: null,
      candidateCount: 4,
    },
  },

  generating: {
    id: "mock-2",
    token: "mock-token",
    orderNo: "ORD-002",
    templateId: "t1",
    recipientName: "李四",
    platform: null,
    status: "GENERATING",
    hasUploadedImage: true,
    uploadedImageCount: 1,
    uploadCount: 3,
    candidateCount: 4,
    candidateGroups: 0,
    selections: [null],
    selectionCount: 0,
    selectedIndex: null,
    errorMessage: null,
    uploadedAt: ago,
    generatedAt: null,
    selectedAt: null,
    cancelledAt: null,
    createdAt: ago,
    updatedAt: now,
    template: {
      id: "t1",
      name: "艺术写真",
      description: "",
      coverUrl: null,
      candidateCount: 4,
    },
  },

  select1: {
    id: "mock-3",
    token: "mock-token",
    orderNo: "ORD-003",
    templateId: "t1",
    recipientName: "王五",
    platform: null,
    status: "CANDIDATES_READY",
    hasUploadedImage: true,
    uploadedImageCount: 1,
    uploadCount: 3,
    candidateCount: 4,
    candidateGroups: 1,
    selections: [null],
    selectionCount: 0,
    selectedIndex: null,
    errorMessage: null,
    uploadedAt: ago,
    generatedAt: ago,
    selectedAt: null,
    cancelledAt: null,
    createdAt: ago,
    updatedAt: ago,
    template: {
      id: "t1",
      name: "职业形象照",
      description: "",
      coverUrl: null,
      candidateCount: 4,
    },
  },

  upload2: {
    id: "mock-4",
    token: "mock-token",
    orderNo: "ORD-004",
    templateId: "t1",
    recipientName: "赵六",
    platform: null,
    status: "CANDIDATES_READY",
    hasUploadedImage: true,
    uploadedImageCount: 1,
    uploadCount: 3,
    candidateCount: 4,
    candidateGroups: 1,
    selections: [2],
    selectionCount: 1,
    selectedIndex: 2,
    errorMessage: null,
    uploadedAt: ago,
    generatedAt: ago,
    selectedAt: null,
    cancelledAt: null,
    createdAt: ago,
    updatedAt: ago,
    template: {
      id: "t1",
      name: "证件照定制",
      description: "",
      coverUrl: null,
      candidateCount: 4,
    },
  },

  selectSingle: {
    id: "mock-5",
    token: "mock-token",
    orderNo: "ORD-005",
    templateId: "t1",
    recipientName: "郑十",
    platform: null,
    status: "CANDIDATES_READY",
    hasUploadedImage: true,
    uploadedImageCount: 1,
    uploadCount: 1,
    candidateCount: 4,
    candidateGroups: 1,
    selections: [null],
    selectionCount: 0,
    selectedIndex: null,
    errorMessage: null,
    uploadedAt: ago,
    generatedAt: ago,
    selectedAt: null,
    cancelledAt: null,
    createdAt: ago,
    updatedAt: ago,
    template: {
      id: "t1",
      name: "单张证件照",
      description: "",
      coverUrl: null,
      candidateCount: 4,
    },
  },

  allDone: {
    id: "mock-6",
    token: "mock-token",
    orderNo: "ORD-006",
    templateId: "t1",
    recipientName: "孙七",
    platform: null,
    status: "SELECTED",
    hasUploadedImage: true,
    uploadedImageCount: 3,
    uploadCount: 3,
    candidateCount: 4,
    candidateGroups: 3,
    selections: [0, 1, 2],
    selectionCount: 3,
    selectedIndex: 0,
    errorMessage: null,
    uploadedAt: ago,
    generatedAt: ago,
    selectedAt: now,
    cancelledAt: null,
    createdAt: ago,
    updatedAt: now,
    template: {
      id: "t1",
      name: "个人写真",
      description: "",
      coverUrl: null,
      candidateCount: 4,
    },
  },

  failed: {
    id: "mock-7",
    token: "mock-token",
    orderNo: "ORD-007",
    templateId: "t1",
    recipientName: "周八",
    platform: null,
    status: "FAILED",
    hasUploadedImage: true,
    uploadedImageCount: 2,
    uploadCount: 2,
    candidateCount: 4,
    candidateGroups: 0,
    selections: [null, null],
    selectionCount: 0,
    selectedIndex: null,
    errorMessage: "GENERATION_TIMEOUT",
    uploadedAt: ago,
    generatedAt: null,
    selectedAt: null,
    cancelledAt: null,
    createdAt: ago,
    updatedAt: now,
    template: {
      id: "t1",
      name: "艺术写真",
      description: "",
      coverUrl: null,
      candidateCount: 4,
    },
  },

  cancelled: {
    id: "mock-8",
    token: "mock-token",
    orderNo: "ORD-008",
    templateId: "t1",
    recipientName: "吴九",
    platform: null,
    status: "CANCELLED",
    hasUploadedImage: false,
    uploadedImageCount: 0,
    uploadCount: 1,
    candidateCount: 4,
    candidateGroups: 0,
    selections: null,
    selectionCount: 0,
    selectedIndex: null,
    errorMessage: null,
    uploadedAt: null,
    generatedAt: null,
    selectedAt: null,
    cancelledAt: now,
    createdAt: ago,
    updatedAt: now,
    template: {
      id: "t1",
      name: "证件照定制",
      description: "",
      coverUrl: null,
      candidateCount: 4,
    },
  },

  /**
   * Partial lock：双图订单，第一张已锁定（partial submit），第二张待选。
   *
   * 用于预览 SelectStep 在 partial select 下的视觉：
   * - 第 1 张角标 = "已锁定 #2" + Lock 图标（emerald-600）
   * - OriginalStrip 第 1 张永久 emerald 边框
   * - QuadrantGrid disabled
   * - 底部"已提交 #N"按钮 disabled，"重新生成第 1 张"按钮 disabled
   * - 标题区"已锁定 1/2 张，剩余可继续上传或挑选"
   * - 第 2 张可正常选 + 提交
   */
  partialLocked: {
    id: "mock-9",
    token: "mock-token",
    orderNo: "ORD-009",
    templateId: "t1",
    recipientName: "冯十一",
    platform: null,
    status: "CANDIDATES_READY",
    hasUploadedImage: true,
    uploadedImageCount: 2,
    uploadCount: 2,
    candidateCount: 4,
    candidateGroups: 2,
    selections: [1, null],
    selectionCount: 1,
    selectedIndex: 1,
    errorMessage: null,
    uploadedAt: ago,
    generatedAt: ago,
    selectedAt: null,
    cancelledAt: null,
    createdAt: ago,
    updatedAt: now,
    template: {
      id: "t1",
      name: "双图定制",
      description: "",
      coverUrl: null,
      candidateCount: 4,
    },
  },
};

export const MOCK_STATES: Array<{ key: string; label: string }> = [
  { key: "upload1", label: "上传①" },
  { key: "generating", label: "生成中" },
  { key: "select1", label: "选图①" },
  { key: "upload2", label: "上传②" },
  { key: "selectSingle", label: "单图选" },
  { key: "partialLocked", label: "部分锁定" },
  { key: "allDone", label: "完成" },
  { key: "failed", label: "失败" },
  { key: "cancelled", label: "取消" },
];

// 保留给将来真正生成 mock 候选宫格时用
export { picsumCandidate, picsumOriginal, candidateGroupsView };
