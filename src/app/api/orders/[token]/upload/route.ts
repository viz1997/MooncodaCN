/**
 * 用户端 - 提交已上传原图 URL 并触发效果图生成
 * POST /api/orders/[token]/upload
 *
 * 语义：**增量 append**。已上传图片与已选选择保留，只为本次新增的原图生成候选。
 * 每完成一组立刻落库，前端轮询 candidateGroups 可看到真实进度。
 *
 * 入参：`{ files: Array<{ publicUrl: string }> }`，URL 必须事先通过
 * /api/orders/[token]/upload-url 走 R2 预签名直传拿到（白名单 host 校验）。
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { submitGeneration } from "@/features/gpt-image/lib/generation-service";
import {
  parseSelections,
  parseUploadedImages,
} from "@/features/gpt-image/lib/order-helpers";
import { getR2PublicHosts, isR2Configured } from "@/features/image-gen/lib/r2";
import { withApiLogging } from "@/lib/api-logger";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPLOADABLE = new Set(["PENDING", "CANDIDATES_READY", "FAILED"]);

interface UploadFileItem {
  publicUrl?: unknown;
}

function isAllowedPublicUrl(value: string): boolean {
  if (!/^https:\/\//i.test(value)) return false;
  const host = (() => {
    try {
      return new URL(value).host;
    } catch {
      return "";
    }
  })();
  if (!host) return false;
  const allowed = getR2PublicHosts();
  return allowed.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}

async function postHandler(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      files?: unknown;
    };
    const files = body.files;

    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json(
        { success: false, error: "请至少上传一张图片" },
        { status: 400 }
      );
    }

    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      with: {
        template: { columns: { candidateCount: true } },
      },
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

    if (!isR2Configured()) {
      return NextResponse.json(
        {
          success: false,
          error: "R2 未配置，无法接收原图 URL",
          code: "R2_NOT_CONFIGURED",
        },
        { status: 503 }
      );
    }

    // 校验每个 URL：必须是 https 且 host 在白名单内（R2 公开域）
    const accepted: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const item = files[i] as UploadFileItem;
      const url = typeof item?.publicUrl === "string" ? item.publicUrl : "";
      if (!url) {
        return NextResponse.json(
          { success: false, error: `第 ${i + 1} 张缺少 publicUrl` },
          { status: 400 }
        );
      }
      if (!isAllowedPublicUrl(url)) {
        return NextResponse.json(
          {
            success: false,
            error: `第 ${i + 1} 张 publicUrl 不在允许的 R2 域名内`,
          },
          { status: 400 }
        );
      }
      accepted.push(url);
    }

    const existing = parseUploadedImages(order.uploadedImages as string | null);
    if (existing.length + accepted.length > order.uploadCount) {
      return NextResponse.json(
        {
          success: false,
          error: `本订单最多 ${order.uploadCount} 张，已上传 ${existing.length} 张，本次最多再传 ${
            order.uploadCount - existing.length
          } 张`,
        },
        { status: 400 }
      );
    }

    const merged = [...existing, ...accepted];

    // 已有选择补齐到新长度（新增原图的选择位为 null），已选的保持不变
    const prevSelections = parseSelections(order.selections as string | null);
    const nextSelections =
      prevSelections === null
        ? null
        : JSON.stringify(
            Array.from(
              { length: merged.length },
              (_, i) => prevSelections[i] ?? null
            )
          );

    await db
      .update(promptOrder)
      .set({
        uploadedImages: JSON.stringify(merged),
        status: "GENERATING",
        uploadedAt: order.uploadedAt ?? new Date(),
        errorMessage: null,
        updatedAt: new Date(),
        ...(nextSelections !== null ? { selections: nextSelections } : {}),
      })
      .where(eq(promptOrder.id, order.id));

    const candidateCount = order.template.candidateCount;

    logger.info(
      {
        orderId: order.id,
        fromIdx: existing.length,
        total: merged.length,
        candidateCount,
      },
      "提交效果图生成任务"
    );
    // 只做 submit（拿 task_id 落库），在本请求周期内完成，不留后台任务。
    // 后续轮询由前端调 POST /api/orders/[token]/poll 驱动。
    await submitGeneration(
      order.id,
      existing.length,
      merged.length,
      candidateCount
    );

    return NextResponse.json(
      {
        success: true,
        message: `${accepted.length} 张图片已上传，正在生成效果图`,
        data: {
          status: "GENERATING",
          uploadedImageCount: merged.length,
          newImageCount: accepted.length,
        },
      },
      { status: 202 }
    );
  } catch (err) {
    logger.error({ err }, "上传失败");
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "上传失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler);
