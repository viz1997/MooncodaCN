/**
 * POST /api/admin/showcases/upload-url —— 案例图片的 R2 预签名上传 URL
 *
 * 语义跟 `/api/print-orders/upload-url` 一样:先签 URL,客户端把文件
 * raw binary PUT 到 R2,**服务端不碰字节**(Vercel 请求体上限 4.5MB,
 * 案例图虽然小,但走同一条直传的路更省事,也避免服务端处理二进制)。
 *
 * ## ⚠️ 只有管理员能签
 *
 * 签 URL 等于给桶发一张写权限的通行证 —— 匿名签的话,这个端点就变成
 * 「任意文件托管」,而 R2 那个桶是**公网桶**。
 *
 * ## 白名单
 *
 * 只接受图片格式。`Content-Type` **按扩展名定死**(不采信浏览器给的),
 * 并且**签进签名里** —— 客户端必须原样带回,否则 R2 拒收。
 */

import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { isR2Configured, presignUpload } from "@/features/image-gen/lib/r2";
import {
  buildShowcaseObjectKey,
  extractShowcaseExtension,
  SHOWCASE_ALLOWED_EXTENSIONS,
} from "@/features/showcase/lib/upload-key";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
/** 签发 URL,10s 够 */
export const maxDuration = 10;

/**
 * 12MB —— 案例图是手机拍的实拍图,12MB 足够(原图能到 8~10MB)。
 *
 * 再大就该让客户端先压一遍了 —— 案例墙上一张 20MB 的图会把页面拖垮。
 */
const MAX_BYTES = 12 * 1024 * 1024;

/** 签名有效期 —— 10 分钟,够传一张图 */
const EXPIRES_IN = 600;

/**
 * 扩展名 → Content-Type
 *
 * **定死,不采信浏览器给的** —— 浏览器可能给 `image/jpeg` 也可能给空串,
 * 而 Content-Type 参与 R2 签名,两边不一致就拒收。
 */
const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

const bodySchema = z.object({
  /** 文件名(只取扩展名用) */
  fileName: z.string().min(1).max(255),
  /** 文件字节数 */
  size: z.number().int().positive().max(MAX_BYTES),
});

async function handle(request: NextRequest) {
  // ---- 管理员鉴权 ----
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "未登录", code: "UNAUTHORIZED" },
      { status: 401 }
    );
  }
  if (session.user.role !== "admin") {
    return NextResponse.json(
      { success: false, error: "无管理员权限", code: "FORBIDDEN" },
      { status: 403 }
    );
  }

  if (!isR2Configured()) {
    return NextResponse.json(
      { success: false, error: "R2 未配置", code: "R2_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "请求体非法", code: "BAD_BODY" },
      { status: 400 }
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
      { status: 400 }
    );
  }

  const ext = extractShowcaseExtension(parsed.data.fileName);
  if (!(SHOWCASE_ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return NextResponse.json(
      {
        success: false,
        error: `格式不支持,仅 ${SHOWCASE_ALLOWED_EXTENSIONS.join(" / ")}`,
        code: "INVALID_TYPE",
      },
      { status: 400 }
    );
  }

  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const objectKey = buildShowcaseObjectKey(ext);

  try {
    const presigned = await presignUpload({
      objectKey,
      contentType,
      expiresIn: EXPIRES_IN,
      // 把声明的字节数签进签名里 —— 客户端必须原样带回 Content-Length,
      // 否则 R2 拒收。堵死「声明 1KB、实际传 1GB」这条路
      contentLength: parsed.data.size,
    });
    return NextResponse.json({
      success: true,
      uploadUrl: presigned.uploadUrl,
      publicUrl: presigned.publicUrl,
      objectKey: presigned.objectKey,
      headers: presigned.headers,
      contentType,
      maxBytes: MAX_BYTES,
      expiresIn: EXPIRES_IN,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json(
      { success: false, error: `签名失败: ${msg}`, code: "PRESIGN_FAILED" },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(handle);
