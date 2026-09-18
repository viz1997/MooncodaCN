/**
 * 小程序 SDK —— 统一出口
 *
 * 一次性 import:
 *   import {
 *     setupSdk, loginWithWechat, submitGenerate, pollImageTask,
 *     createOrder, pollOrder, selectCandidate, listProducts, addLineItem,
 *     getSdkToken, setSdkToken, SdkRequestError,
 *   } from "@/api/sdk";
 */

// 认证
export { loginWithWechat, logout } from "./auth";
// AI 生图
export {
  listPhotos,
  listTemplates,
  pollImageTask,
  proxyImageUrl,
  submitGenerate,
} from "./image-gen";
// 订单预览流
export {
  cancelOrder,
  configureOrder,
  createOrder,
  getOrderDetail,
  getOrderHistory,
  getOrderStatus,
  guestConfirmOrder,
  pollOrder,
  regenerateOrder,
  restoreOrderHistory,
  selectCandidate,
  stopOrderGeneration,
} from "./orders";
// 配置 & 错误
export {
  getSdkBaseUrl,
  getSdkToken,
  isSdkRequestError,
  SdkRequestError,
  sdkRequest,
  setSdkToken,
  setupSdk,
} from "./request";
// Storefront:见 MEDUSA_INTEGRATION.md —— commerce 不在 NextDevTpl,
// 走独立部署的 Medusa Store API + 官方 @medusajs/medusa-js SDK。
// 类型
export type {
  ApiEnvelope,
  // 公共
  ApiError,
  CreateOrderRequest,
  CreateOrderResponse,
  DownloadQuery,
  ImageTaskStatusResponse,
  OrderCancelResponse,
  OrderConfigureResponse,
  OrderDetailResponse,
  OrderGuestConfirmResponse,
  OrderHistoryResponse,
  OrderHistoryRestoreResponse,
  OrderPollResponse,
  OrderRegenerateResponse,
  OrderSelectResponse,
  OrderSpecRequest,
  // 订单
  OrderStatus,
  OrderStatusResponse,
  OrderStopResponse,
  OrderUploadResponse,
  OrderUploadUrlRequest,
  OrderUploadUrlResponse,
  PhotosListResponse,
  PromptTemplatesResponse,
  // 生图
  PublicGenerateRequest,
  PublicGenerateResponse,
  // 上传
  PublicUploadRequest,
  PublicUploadResponse,
  SdkConfig,
  // 图片代理
  ThumbnailQuery,
  // 认证
  WeChatLoginRequest,
  WeChatLoginResponse,
} from "./types";
// 上传
export { orderUpload, orderUploadUrl, publicUpload } from "./upload";
