/**
 * 公共 R2 预签名上传 URL(2026-10-15)
 *
 * POST /api/public/upload-url
 *
 * 语义:与 /api/orders/[token]/upload-url 同形态,但不绑订单。
 * 客户端先请求本接口拿到 uploadUrl + publicUrl,再用 PUT 把原图
 * 直传到 R2,最后把 publicUrl 喂给 /api/image-gen/submit。
 *
 * 为什么需要这条直传通道(2026-10-15 线上事故后):
 *  旧链路 publicUpload(file) → POST multipart → BFF multer 收 → BFF
 *  putObject → R2。两段跳,撞 Vercel 4.5MB body 上限(实际 multer
 *  cap=5MB);更关键的是 mp 在 wx.uploadFile 阶段会丢真实 Content-Type
 *  上下文,后续 submitGenerate 走 proxyImageInputsToR2 时,
 *  fetch 回来的 Content-Type 经常被上游 CDN / 签名 URL 误标为
 *  image/octet-stream,触发 input 格式归一化分支,白名单外格式
 *  会被服务端拒绝("明明是 JPG 为什么不支持")。
 *
 *  直传后 mp → R2 是 raw binary PUT,Content-Type 由 mp 端在
 *  presign 阶段就确定,BFF 永远不碰字节,proxyImageInputsToR2
 *  看到的就是 R2 自己的 metadata Content-Type(可信),整条链
 *  不再依赖外部上游的 Content-Type。
 *
 * 鉴权:与 /api/public/upload 一致(2026-10-15 沿用 IP 限流,R2
 * 未配时返 503)。x-api-key 校验两条 sibling 端点都没做,这里
 * 保持对称;后续要加外部 API Key 校验时两条一起改。
 */

import { nanoid } from "nanoid";
import { type NextRequest, NextResponse } from "next/server";

import { getClientIp, logImageGen } from "@/features/image-gen";
import { isR2Configured, presignUpload } from "@/features/image-gen/lib/r2";
import { withApiLogging } from "@/lib/api-logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);
// 与 /api/public/upload (multer)、/api/orders/[token]/upload-url 一致:
const MAX_BYTES = 5 * 1024 * 1024;
const EXPIRES_IN = 300; // 5 分钟,够 mp wx.uploadFile 走完

interface PresignRequestBody {
  contentType?: string;
  size?: number;
  ext?: string;
}

async function postHandler(req: NextRequest) {
  const ip = getClientIp(req.headers);

  // ============ IP 限流(沿用 upload 限流配置) ============
  const rl = await checkRateLimit(ip ?? "unknown", "upload");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  // ============ R2 配置检查 ============
  if (!isR2Configured()) {
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "public",
      model: "upload-url",
      errorCode: "R2_NOT_CONFIGURED",
      errorMessage: "R2 未配置,无法签发直传 URL",
      ip,
    });
    return NextResponse.json(
      {
        success: false,
        error: "R2 未配置",
        code: "R2_NOT_CONFIGURED",
      },
      { status: 503, headers: getRateLimitHeaders(rl) }
    );
  }

  // ============ 解析 body ============
  let body: PresignRequestBody = {};
  try {
    body = (await req.json()) as PresignRequestBody;
  } catch {
    return NextResponse.json(
      { success: false, error: "请求体非法", code: "BAD_BODY" },
      { status: 400, headers: getRateLimitHeaders(rl) }
    );
  }

  // ============ MIME 白名单 ============
  const contentType = (body.contentType ?? "").toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return NextResponse.json(
      {
        success: false,
        error: "格式不支持,仅 JPG/PNG/WebP",
        code: "INVALID_TYPE",
      },
      { status: 400, headers: getRateLimitHeaders(rl) }
    );
  }

  // ============ 大小上限 ============
  // 不强制 size(SDK 可能不知道),但如果传了就校验,挡住"声明 2MB 实际
  // 100MB"的恶意请求。R2 单次 PUT 自身 5GB,这里 5MB 是业务层 cap。
  if (typeof body.size === "number" && body.size > MAX_BYTES) {
    return NextResponse.json(
      {
        success: false,
        error: "文件过大,最大 5MB(请先在客户端压缩)",
        code: "FILE_TOO_LARGE",
      },
      { status: 400, headers: getRateLimitHeaders(rl) }
    );
  }

  // ============ 计算 objectKey ============
  // 与 /api/public/upload (multer path) 同前缀 public-uploads/{date}/
  // 这样两路写入的对象落在同一目录,运维 ls 友好。
  const sub = contentType.split("/")[1] ?? "bin";
  const ext = body.ext ?? (sub === "jpeg" ? "jpg" : sub);
  const safeExt = ext
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase()
    .slice(0, 8);
  const objectKey =
    `public-uploads/${new Date().toISOString().slice(0, 10)}/` +
    `${Date.now()}-${nanoid(10)}.${safeExt}`;

  try {
    const presigned = await presignUpload({
      objectKey,
      contentType,
      expiresIn: EXPIRES_IN,
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
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "public",
      model: "upload-url",
      errorCode: "PRESIGN_FAILED",
      errorMessage: msg,
      ip,
    });
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

export const POST = withApiLogging(postHandler);
