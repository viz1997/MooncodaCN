/**
 * 小程序 SDK —— 订单预览流(/p/[token] 共享)
 *
 * Token 即凭证(不可猜测的 nanoid,128-bit 熵),完全免登录。
 *
 * 6 步工作台时序:
 *   1. createOrder() 或外部拿 token
 *   2. orderUploadUrl() + wx.uploadFile() 或 orderUpload()
 *   3. configure({ sizeCm, accessoryCode, ... })
 *   4. submitGenerate({ maskId, imageUrls, ... })  ← 走 image-gen 模块
 *   5. pollOrder(token) 循环,直到 status=COMPLETED
 *   6. selectCandidate(token, imageIdx, candIdx) 选定一张
 *   7. guestConfirm(token) / regenerate / cancel
 *
 * 完整 type 字段对照 PRODUCT_TYPES 字典 + VALID_SIZES,见 [[product-types-dictionary-extending]]。
 */

import { sdkRequest } from "./request";
import type {
  CreateOrderRequest,
  CreateOrderResponse,
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
  OrderStatusResponse,
  OrderStopResponse,
} from "./types";

/** 创建新订单(POST /api/orders) */
export async function createOrder(
  payload: CreateOrderRequest
): Promise<CreateOrderResponse> {
  return sdkRequest<CreateOrderResponse>("/api/orders", {
    method: "POST",
    json: payload,
    timeoutMs: 30_000,
  });
}

/** GET /api/orders/[token] —— 完整详情(含 candidates + uploadedImages 数组) */
export async function getOrderDetail(
  token: string
): Promise<OrderDetailResponse> {
  return sdkRequest<OrderDetailResponse>(
    `/api/orders/${encodeURIComponent(token)}`,
    { method: "GET", timeoutMs: 30_000 }
  );
}

/** GET /api/orders/[token]/status —— 轻量状态(轮询首屏用) */
export async function getOrderStatus(
  token: string
): Promise<OrderStatusResponse> {
  return sdkRequest<OrderStatusResponse>(
    `/api/orders/${encodeURIComponent(token)}/status`,
    { method: "GET", timeoutMs: 15_000 }
  );
}

/**
 * POST /api/orders/[token]/poll —— 推进生成并返回状态
 *
 * 与 GET /status 同构,但会主动驱动服务端 advance() —— 轮询用 POST。
 * 推荐策略:每 2-3s 调一次,直到 status=COMPLETED / FAILED / CANCELLED。
 * maxDuration=90s 覆盖最坏链路。
 */
export async function pollOrder(
  token: string,
  options?: { signal?: AbortSignal }
): Promise<OrderPollResponse> {
  return sdkRequest<OrderPollResponse>(
    `/api/orders/${encodeURIComponent(token)}/poll`,
    {
      method: "POST",
      signal: options?.signal,
      timeoutMs: 90_000,
    }
  );
}

/** POST /api/orders/[token]/configure —— 提交定制规格(尺寸/配件/数量/刻字等) */
export async function configureOrder(
  token: string,
  spec: OrderSpecRequest
): Promise<OrderConfigureResponse> {
  return sdkRequest<OrderConfigureResponse>(
    `/api/orders/${encodeURIComponent(token)}/configure`,
    { method: "POST", json: spec, timeoutMs: 30_000 }
  );
}

/** POST /api/orders/[token]/candidates/[imageIdx]/[candIdx] —— 选定候选图 */
export async function selectCandidate(
  token: string,
  imageIdx: number,
  candIdx: number
): Promise<OrderSelectResponse> {
  return sdkRequest<OrderSelectResponse>(
    `/api/orders/${encodeURIComponent(token)}/candidates/${imageIdx}/${candIdx}`,
    { method: "POST", timeoutMs: 30_000 }
  );
}

/** POST /api/orders/[token]/regenerate —— 重新生成(扣积分) */
export async function regenerateOrder(
  token: string
): Promise<OrderRegenerateResponse> {
  return sdkRequest<OrderRegenerateResponse>(
    `/api/orders/${encodeURIComponent(token)}/regenerate`,
    { method: "POST", timeoutMs: 60_000 }
  );
}

/** POST /api/orders/[token]/stop-generation —— 主动停止生成(未扣积分则释放) */
export async function stopOrderGeneration(
  token: string
): Promise<OrderStopResponse> {
  return sdkRequest<OrderStopResponse>(
    `/api/orders/${encodeURIComponent(token)}/stop-generation`,
    { method: "POST", timeoutMs: 15_000 }
  );
}

/** POST /api/orders/[token]/cancel —— 取消订单(可能触发积分退还) */
export async function cancelOrder(token: string): Promise<OrderCancelResponse> {
  return sdkRequest<OrderCancelResponse>(
    `/api/orders/${encodeURIComponent(token)}/cancel`,
    { method: "POST", timeoutMs: 15_000 }
  );
}

/** POST /api/orders/[token]/guest-confirm —— 客户确认(代理商 demo 流关键) */
export async function guestConfirmOrder(
  token: string
): Promise<OrderGuestConfirmResponse> {
  return sdkRequest<OrderGuestConfirmResponse>(
    `/api/orders/${encodeURIComponent(token)}/guest-confirm`,
    { method: "POST", timeoutMs: 15_000 }
  );
}

/** GET /api/orders/[token]/history —— 历史快照列表(用户回退用) */
export async function getOrderHistory(
  token: string
): Promise<OrderHistoryResponse> {
  return sdkRequest<OrderHistoryResponse>(
    `/api/orders/${encodeURIComponent(token)}/history`,
    { method: "GET", timeoutMs: 15_000 }
  );
}

/** POST /api/orders/[token]/history/[id]/restore —— 恢复历史快照 */
export async function restoreOrderHistory(
  token: string,
  historyId: string
): Promise<OrderHistoryRestoreResponse> {
  return sdkRequest<OrderHistoryRestoreResponse>(
    `/api/orders/${encodeURIComponent(token)}/history/${encodeURIComponent(historyId)}/restore`,
    { method: "POST", timeoutMs: 15_000 }
  );
}
