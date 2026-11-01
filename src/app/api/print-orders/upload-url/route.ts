/**
 * POST /api/print-orders/upload-url —— 打印订单模型文件的 R2 预签名上传 URL
 *
 * 语义跟 `/api/public/upload-url` 一样:先签 URL,客户端把文件 raw binary
 * PUT 到 R2,服务端不碰字节。
 *
 * ## 为什么不走 BFF multipart
 *
 * Vercel serverless function 的请求体上限是 4.5MB。3D 模型(尤其是带
 * 全彩纹理的 zip)轻松超过这个数,走 `/api/public/upload` 那条 multer 通道
 * 必然 413。所以必须直传。
 *
 * ## 白名单
 *
 * 只接受 3D 模型格式,别的一律不签 —— 否则这个端点就变成「任意文件
 * 托管」,R2 公网桶可不是什么好地方。
 *
 * Content-Type 统一用 `application/octet-stream`:它参与 R2 签名,客户端
 * 必须原样带回,固定成一个值最省事(不同浏览器对 .obj 给什么 mime 并不
 * 一致)。
 */

import { nanoid } from "nanoid";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isR2Configured, presignUpload } from "@/features/image-gen/lib/r2";
import { withApiLogging } from "@/lib/api-logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
/** 签发 URL,10s 够 */
export const maxDuration = 10;

/** 允许的模型格式(与克重工具的 accept 一致) */
const ALLOWED_EXTENSIONS = [
  "zip",
  "rar",
  "7z",
  "obj",
  "stl",
  "ply",
  "glb",
  "gltf",
] as const;

/**
 * 50MB。模型带纹理时 zip 会比较大,但再大就得上分片直传了 ——
 * 打印服务现在不做分片,超限直接拒。
 */
const MAX_BYTES = 50 * 1024 * 1024;
const EXPIRES_IN = 600; // 10 分钟,够大文件 PUT
const CONTENT_TYPE = "application/octet-stream";

const bodySchema = z.object({
  /** 文件名(只取扩展名用) */
  fileName: z.string().min(1).max(255),
  /** 文件字节数 */
  size: z.number().int().positive().max(MAX_BYTES),
});

async function handle(request: NextRequest) {
  const ip = getClientIp(request);

  const rl = await checkRateLimit(ip, "upload");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  if (!isR2Configured()) {
    return NextResponse.json(
      {
        success: false,
        error: "R2 未配置",
        code: "R2_NOT_CONFIGURED",
      },
      { status: 503, headers: getRateLimitHeaders(rl) }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "请求体非法", code: "BAD_BODY" },
      { status: 400, headers: getRateLimitHeaders(rl) }
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "参数不合法",
        code: "INVALID_INPUT",
        issues: parsed.error.issues,
      },
      { status: 400, headers: getRateLimitHeaders(rl) }
    );
  }

  // 扩展名白名单 —— 取最后一段,兼容 "model.tar.gz" 这种双扩展名
  const rawExt = parsed.data.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(rawExt)) {
    return NextResponse.json(
      {
        success: false,
        error: `格式不支持,仅 ${ALLOWED_EXTENSIONS.join(" / ")}`,
        code: "INVALID_TYPE",
      },
      { status: 400, headers: getRateLimitHeaders(rl) }
    );
  }

  const objectKey =
    `print-orders/${new Date().toISOString().slice(0, 10)}/` +
    `${Date.now()}-${nanoid(10)}.${rawExt}`;

  try {
    const presigned = await presignUpload({
      objectKey,
      contentType: CONTENT_TYPE,
      expiresIn: EXPIRES_IN,
      // 把声明的字节数签进签名里 —— 客户端必须原样带回 Content-Length,
      // 否则 R2 拒收。这样「声明 1KB、实际传 1GB」这条路就堵死了
      contentLength: parsed.data.size,
    });
    return NextResponse.json(
      {
        success: true,
        uploadUrl: presigned.uploadUrl,
        publicUrl: presigned.publicUrl,
        objectKey: presigned.objectKey,
        headers: presigned.headers,
        maxBytes: MAX_BYTES,
        expiresIn: EXPIRES_IN,
      },
      { headers: getRateLimitHeaders(rl) }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "未知错误";
    return NextResponse.json(
      {
        success: false,
        error: `签名失败: ${msg}`,
        code: "PRESIGN_FAILED",
      },
      { status: 500, headers: getRateLimitHeaders(rl) }
    );
  }
}

export const POST = withApiLogging(handle);
