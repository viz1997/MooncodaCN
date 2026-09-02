/**
 * 用户端 - 获取 R2 预签名上传 URL（公开 token 接口）
 * POST /api/orders/[token]/upload-url
 *
 * 语义：客户端先请求本接口拿到 uploadUrl + publicUrl，
 * 再用 PUT 把原图直传到 R2，最后把 publicUrl 列表交给 /upload 落库。
 * 整个链路不再传 base64 / dataUrl，DB 也只存公开 URL。
 */

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { isR2Configured, presignUpload } from "@/features/image-gen/lib/r2";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);
// 2026-09-02：上限统一 5MB —— Lingting/WellAPI `/v1/images/edits` multipart body
// 上限约 8MB，前端 10MB 会被上游返 413。前端会先客户端降采样到 ≤5MB
// 再 presign，这里与服务端 MAX_REF_IMAGE_BYTES 保持单点常量。
const MAX_BYTES = 5 * 1024 * 1024;
const UPLOADABLE = new Set(["PENDING", "CANDIDATES_READY", "FAILED"]);

interface PresignRequestBody {
  contentType?: string;
  size?: number;
  ext?: string;
}

async function postHandler(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;

    if (!isR2Configured()) {
      return NextResponse.json(
        {
          success: false,
          error: "R2 未配置，无法上传原图",
          code: "R2_NOT_CONFIGURED",
        },
        { status: 503 }
      );
    }

    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      columns: { id: true, status: true },
    });
    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }
    if (!UPLOADABLE.has(order.status)) {
      const reason =
        order.status === "GENERATING"
          ? "正在生成中，请等待本轮完成"
          : order.status === "SELECTED"
            ? "已提交，不可再上传"
            : "订单已取消";
      return NextResponse.json(
        {
          success: false,
          error: `当前状态为 ${order.status}，无法上传。${reason}`,
        },
        { status: 400 }
      );
    }

    let body: PresignRequestBody = {};
    try {
      body = (await req.json()) as PresignRequestBody;
    } catch {
      return NextResponse.json(
        { success: false, error: "请求体非法" },
        { status: 400 }
      );
    }

    const contentType = (body.contentType ?? "").toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return NextResponse.json(
        {
          success: false,
          error: "格式不支持，仅 JPG/PNG/WebP/GIF",
        },
        { status: 400 }
      );
    }
    if (typeof body.size === "number" && body.size > MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: "文件过大，最大 5MB（请先在客户端压缩）" },
        { status: 400 }
      );
    }

    const ext =
      body.ext ?? contentType.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
    const safeExt = ext
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()
      .slice(0, 8);
    const objectKey = `gpt-image/orders/${token}/${Date.now()}-${nanoid(10)}.${safeExt}`;

    const presigned = await presignUpload({ objectKey, contentType });
    return NextResponse.json({
      success: true,
      uploadUrl: presigned.uploadUrl,
      publicUrl: presigned.publicUrl,
      objectKey: presigned.objectKey,
      headers: presigned.headers,
      maxBytes: MAX_BYTES,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "签名失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler);
