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
  getQuota,
  listPhotos,
  listTemplates,
  pollImageTask,
  proxyImageUrl,
  submitGenerate,
} from "./image-gen";
// v1.4.0 起 SDK 暴露 readTaroFileAsArrayBuffer 给 mp 业务自取 Taro
// tempFilePath → ArrayBuffer。原 publicUploadDirectFromMp 内部用的就是
// 这个逻辑,现在不再包成"上传助手",让业务自己组合 Blob + publicUploadDirect。
export { readTaroFileAsArrayBuffer } from "./image-utils";
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
// 产品能力接口(v1.6.0 起)
export { getProduct, listProducts } from "./products";
// 配置 & 错误
export {
  getSdkApiKey,
  getSdkBaseUrl,
  getSdkToken,
  isSdkRequestError,
  SdkRequestError,
  sdkRequest,
  setSdkApiKey,
  setSdkToken,
  setupSdk,
} from "./request";
// Storefront:见 MEDUSA_INTEGRATION.md —— commerce 不在 NextDevTpl,
// 走独立部署的 Medusa Store API + 官方 @medusajs/medusa-js SDK。
// 类型
export type {
  AccessoryCategory,
  AccessoryDef,
  AccessoryVariantDef,
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
  ProductCapabilities,
  ProductCapability,
  ProductCategory,
  ProductListResponse,
  ProductSizeDef,
  ProductTemplateSummary,
  PromptTemplatesResponse,
  // 生图
  PublicGenerateRequest,
  PublicGenerateResponse,
  // 上传
  PublicUploadRequest,
  PublicUploadResponse,
  PublicUploadUrlRequest,
  PublicUploadUrlResponse,
  QuotaResponse,
  SdkConfig,
  // 模板样式(v1.5.0 起,templates[i].styles 元素类型)
  TemplateStyle,
  // 图片代理
  ThumbnailQuery,
  // 认证
  WeChatLoginRequest,
  WeChatLoginResponse,
} from "./types";
// 上传
// v1.4.0 起 publicUploadDirectFromMp 已删除(server 端接管归一化,mp 端
// 用 sizeType:['compressed'] 即可)。mp 业务代码如果还在 import,会得到
// "no exported member" 编译错 —— 这是预期的破坏性变更,提醒升级。
export {
  orderUpload,
  orderUploadUrl,
  publicUpload,
  publicUploadDirect,
  publicUploadUrl,
} from "./upload";
