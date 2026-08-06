// 外部用户参考图直传 API（免登录，R2 预签名直传）
// R2 未配置时返回 503，由前端回退到 base64 data URI（仅小图可行）
import { type NextRequest, NextResponse } from "next/server";
import {
  getClientIp,
  isR2Configured,
  logImageGen,
  presignUpload,
} from "@/features/image-gen";
import {
  checkRateLimit,
  createRateLimitResponse,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 10 * 1024 * 1024;

interface PresignRequestBody {
  contentType?: string;
  size?: number;
  ext?: string;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req.headers);

  // IP 限流：上传复用 upload 限流配置
  const rl = await checkRateLimit(ip ?? "unknown", "upload");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  if (!isR2Configured()) {
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "public",
      model: "upload",
      errorCode: "R2_NOT_CONFIGURED",
      errorMessage: "R2 未配置，参考图直不可用",
      ip,
    });
    return NextResponse.json(
      { success: false, error: "R2 未配置", code: "R2_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  let body: PresignRequestBody = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "请求体非法", code: "BAD_BODY" },
      { status: 400 }
    );
  }

  const contentType = (body.contentType ?? "").toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) {
    return NextResponse.json(
      {
        success: false,
        error: "格式不支持，仅 JPG/PNG/WEBP",
        code: "INVALID_TYPE",
      },
      { status: 400 }
    );
  }

  if (typeof body.size === "number" && body.size > MAX_BYTES) {
    return NextResponse.json(
      { success: false, error: "文件过大，最大 10MB", code: "FILE_TOO_LARGE" },
      { status: 400 }
    );
  }

  const ext = body.ext ?? contentType.split("/")[1] ?? "bin";
  // 使用 Date.now() + 随机后缀生成 objectKey，避免覆盖
  const objectKey = `public-uploads/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  try {
    const presigned = await presignUpload({ objectKey, contentType });
    logImageGen({
      event: "submit",
      outcome: "success",
      source: "public",
      model: "upload",
      hasRefImage: true,
      ip,
    });
    return NextResponse.json(
      { success: true, ...presigned },
      { headers: getRateLimitHeaders(rl) }
    );
  } catch (error) {
    console.error("[Presign Error]", error);
    const msg = error instanceof Error ? error.message : "未知错误";
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "public",
      model: "upload",
      errorCode: "PRESIGN_FAILED",
      errorMessage: msg,
      ip,
    });
    return NextResponse.json(
      { success: false, error: `签名失败: ${msg}`, code: "PRESIGN_FAILED" },
      { status: 500 }
    );
  }
}
