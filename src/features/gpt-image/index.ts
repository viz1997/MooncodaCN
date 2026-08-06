/**
 * GPT-Image feature 公共导出
 */

// Server Actions
export {
  createOrderAction,
  deleteOrderAction,
  listOrdersAction,
  listTemplatesAction,
} from "./actions/orders";
export {
  createTemplateAction,
  deleteTemplateAction,
  toggleTemplateActiveAction,
  updateTemplateAction,
} from "./actions/templates";
// 生图服务
export {
  generateCandidate,
  generateOrderToken,
  isLingtingConfigured,
  triggerGeneration,
} from "./lib/generation-service";
// 工具函数
export {
  countCandidateGroups,
  countSelections,
  countUploadedImages,
  parseCandidates,
  parseSelections,
  parseUploadedImages,
} from "./lib/order-helpers";
export type {
  CandidateCount,
  OrderStatus,
  OrderView,
  PromptTemplateView,
} from "./lib/types";
// 类型与常量
export {
  CANDIDATE_COUNTS,
  IMAGE_SIZES,
  MAX_CANDIDATE_COUNT,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_LABELS,
} from "./lib/types";
