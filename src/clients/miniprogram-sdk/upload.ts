/**
 * 小程序 SDK —— 上传
 *
 * 三种上传路径(按场景选):
 *   1. publicUpload()                — 公共桶,免登录,生图前临时上传
 *   2. orderUploadUrl() + wx.uploadFile — 订单专用桶(走 R2 presigned PUT,免服务端中转)
 *   3. orderUpload()                 — 订单桶表单直传(简单,文件小时可用)
 *
 * 微信小程序 uploadFile 域名白名单严,上传后只能拿 R2 URL 在 downloadFile 白名单
 * 内访问,所以 R2 URL 不直连,展示统一走 /api/image-gen/{thumbnail,download} 代理。
 */

import { sdkRequest } from "./request";
import type {
  OrderUploadResponse,
  OrderUploadUrlRequest,
  OrderUploadUrlResponse,
  PublicUploadResponse,
} from "./types";

/**
 * 公共上传(formData,单文件,免登录)
 *
 * 用法:选完图片 → publicUpload(file) → 拿 url 喂给 submitGenerate
 */
export async function publicUpload(
  file: File | Blob
): Promise<PublicUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return sdkRequest<PublicUploadResponse>("/api/public/upload", {
    method: "POST",
    formData,
    timeoutMs: 60_000,
  });
}

/**
 * 拿订单专用 R2 presigned URL(推荐用于大图上传,免服务端中转流量)
 *
 * 用法:
 *   const { uploadUrl, publicUrl } = await orderUploadUrl(token, { contentType: "image/jpeg" });
 *   await Taro.uploadFile({ url: uploadUrl, filePath, name: "file", header: { "Content-Type": "image/jpeg" } });
 *   // publicUrl → 喂给 orderConfigure 或 submitGenerate
 */
export async function orderUploadUrl(
  token: string,
  payload: OrderUploadUrlRequest
): Promise<OrderUploadUrlResponse> {
  return sdkRequest<OrderUploadUrlResponse>(
    `/api/orders/${encodeURIComponent(token)}/upload-url`,
    {
      method: "POST",
      json: payload,
    }
  );
}

/**
 * 订单上传(formData,服务端中转,适合 ≤2MB 小图)
 */
export async function orderUpload(
  token: string,
  file: File | Blob,
  filename?: string
): Promise<OrderUploadResponse> {
  const formData = new FormData();
  formData.append("file", file, filename);
  return sdkRequest<OrderUploadResponse>(
    `/api/orders/${encodeURIComponent(token)}/upload`,
    {
      method: "POST",
      formData,
      timeoutMs: 60_000,
    }
  );
}
