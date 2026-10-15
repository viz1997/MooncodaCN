/**
 * 小程序 SDK —— 上传
 *
 * 三种上传路径(按场景选):
 *   1. publicUpload()                — 公共桶,免登录,生图前临时上传(formData 走 BFF)
 *   2. publicUploadDirect()          — 公共桶直传 R2(v1.3.0 起推荐,跳 BFF)
 *   3. orderUploadUrl() + 自己 PUT   — 订单专用桶(走 R2 presigned PUT,免服务端中转)
 *   4. orderUpload()                 — 订单桶表单直传(简单,文件小时可用)
 *
 * v1.4.0 起:mp 端不再有 SDK 内部格式归一化(helper `publicUploadDirectFromMp`
 * 已删除)。iOS 微信用户选 sizeType:['compressed'],微信内置 HEIC→JPG,
 * 链路 0 风险;任何不在白名单的格式由 server 端
 * proxyImageInputsToR2.normalizeToSupported 兜底,落 image-gen/input/
 * 时附带 x-moon-normalized metadata,后续 submit 走 fast-path skip。
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
  PublicUploadUrlRequest,
  PublicUploadUrlResponse,
} from "./types";

/**
 * 公共上传(formData,单文件,免登录)
 *
 * 用法:选完图片 → publicUpload(file) → 拿 url 喂给 submitGenerate
 *
 * 历史路径,2026-10-15 之前唯一选择。走 BFF multer 中转,5MB cap。
 * 新代码建议用 publicUploadDirect():直传 R2,跳过 BFF 4.5MB body
 * 限制 + Vercel 60s timeout;mp 端 PUT 阶段不会丢 Content-Type
 * 上下文,后续 submitGenerate.proxyImageInputsToR2 不会因上游
 * CDN/签名 URL 误标 Content-Type 而触发格式拒绝。
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
 * 拿公共 R2 presigned URL(2026-10-15 v1.3.0)
 *
 * 与 orderUploadUrl 同形态,但不绑订单,直接打 /api/public/upload-url。
 * 拿到 uploadUrl 后业务自己 PUT 上去(本 SDK 不替你 PUT,因 mp / 浏览器
 * 走 fetch 还是 wx.request 走 PUT 行为不一致;调用方最清楚自己的环境)。
 *
 * 用法:
 *   const presign = await publicUploadUrl({ contentType: "image/jpeg" });
 *   await fetch(presign.uploadUrl, { method: "PUT", body: file, headers: presign.headers });
 *   // presign.publicUrl → 喂给 submitGenerate.imageUrls
 */
export async function publicUploadUrl(
  payload: PublicUploadUrlRequest
): Promise<PublicUploadUrlResponse> {
  return sdkRequest<PublicUploadUrlResponse>("/api/public/upload-url", {
    method: "POST",
    json: payload,
  });
}

/**
 * 公共上传直传 R2(v1.3.0 起推荐)
 *
 * 一步完成:sniff content-type → 拿 presigned URL → 用 fetch PUT
 * 原图字节到 R2 → 返回 publicUrl。publicUpload() 的 drop-in 替换。
 *
 * 关键收益(相对 publicUpload):
 *   - 不再被 Vercel 4.5MB body cap 卡住(R2 单次 PUT 可到 5GB)
 *   - mp → R2 直传,Content-Type 不会跨段丢,后续 proxyImageInputsToR2
 *     不依赖外部上游的 Content-Type
 *   - BFF 永远不碰字节,服务端攻击面变小
 *
 * v1.4.0 起 HEIC / BMP / TIFF 等非常规格式由 server 端接管:
 *   - 本函数不预先归一化,file.type 是啥就传啥给 R2
 *   - mp 端 iOS 微信用户:用 sizeType:['compressed'](微信内置 HEIC→JPG),
 *     链路 0 风险
 *   - mp 端必须 sizeType:['original'] 拿 HEIC:server 端
 *     normalizeToSupported 兜底(BMP/TIFF/GIF 转 PNG,SVG resvg 渲染);
 *     HEIC server 解不开,会抛 ImageFormatError,提示用户改用
 *     sizeType:['compressed']
 *   - 业务侧已经做过客户端归一化的场景(浏览器 / RN / 自定义 mp 链路)
 *     直接用,无需特殊处理
 *
 * 兼容性:依赖 globalThis.fetch 支持 method:'PUT' + body:Blob。
 * 现代浏览器、Taro H5、React Native 都没问题。**老版本 WeChat
 * 原生 wx.request 不支持 PUT** —— 这种环境仍用 publicUpload()
 * (走 BFF multipart),SDK 自动 fallback 由调用方决定。
 *
 * @param file        File/Blob,需 file.type 已设(浏览器 chooseFile 自带;
 *                    其它环境手动指定)
 * @param contentType 显式覆盖,优先级高于 file.type;可选
 */
export async function publicUploadDirect(
  file: File | Blob,
  contentType?: string
): Promise<PublicUploadResponse> {
  const ct = (contentType ?? file.type ?? "").toLowerCase();
  if (!ct) {
    throw new Error(
      "publicUploadDirect: 缺少 content-type,请在 file.type 指定或传 contentType 参数"
    );
  }
  // exactOptionalPropertyTypes:true → size 字段不能传 undefined,只能 omit
  const presignReq: PublicUploadUrlRequest = { contentType: ct };
  const size = file instanceof Blob ? file.size : undefined;
  if (typeof size === "number") presignReq.size = size;
  const presign = await publicUploadUrl(presignReq);

  // presign.uploadUrl 是 R2 绝对 URL,直接打。BFF 永远不碰字节。
  // R2 PUT 成功返 200;失败(签名不匹配/类型不符)直接走 sdkRequest 抛
  // SdkRequestError,业务上层 catch 后能看到 HTTP status 自己判断。
  // skipAuth=true:presign URL 自带签名,不要再叠加 Authorization /
  // x-api-key(会被 R2 当成额外 header,signature 校验不通过 403)。
  // setupSdk 未调 → sdkRequest 自己会抛 "setupSdk() must be called before any API call"
  await sdkRequest<unknown>(presign.uploadUrl, {
    method: "PUT",
    rawBody: file,
    customHeaders: presign.headers,
    timeoutMs: 60_000,
    skipAuth: true,
  });
  return { url: presign.publicUrl };
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
