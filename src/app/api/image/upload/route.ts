// 登录用户参考图直传 API
// R2 预签名直传，objectKey 按用户隔离

import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import {
  getClientIp,
  isR2Configured,
  logImageGen,
  presignUpload,
} from "@/features/image-gen";
import { auth } from "@/lib/auth";
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
  const headersList = await headers();
  const session = await auth.api.getSession({ headers: headersList });

  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "请先登录" },
      { status: 401 }
    );
  }

  const userId = session.user.id;
  const ip = getClientIp(req.headers);

  const rl = await checkRateLimit(userId, "upload");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  if (!isR2Configured()) {
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "internal",
      model: "upload",
      errorCode: "R2_NOT_CONFIGURED",
      errorMessage: "R2 未配置，参考图直传不可用",
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
  const objectKey = `user-uploads/${userId}/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  try {
    const presigned = await presignUpload({ objectKey, contentType });
    logImageGen({
      event: "submit",
      outcome: "success",
      source: "internal",
      model: "upload",
      hasRefImage: true,
      ip,
    });
    return NextResponse.json(
      { success: true, ...presigned },
      { headers: getRateLimitHeaders(rl) }
    );
  } catch (error) {
    console.error("[Internal Presign Error]", error);
    const msg = error instanceof Error ? error.message : "未知错误";
    logImageGen({
      event: "submit",
      outcome: "failed",
      source: "internal",
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
