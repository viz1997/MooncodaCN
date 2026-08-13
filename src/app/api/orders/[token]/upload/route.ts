/**
 * 用户端 - 提交已上传原图 URL 并触发效果图生成
 * POST /api/orders/[token]/upload
 *
 * 语义：
 * - 普通状态（PENDING / CANDIDATES_READY）→ **增量 append**。已上传图片与已选选择保留，
 *   只为本次新增的原图生成候选。
 * - FAILED → **按位置覆盖**（见 isRetryAfterFailure 分支），允许用户换图重试。
 *   若用户没碰到某张槽位，旧图保留；若用户重传了 N 张，从前往后替换 N 个槽位。
 *
 * 终态（SELECTED / CANCELLED / GENERATING）→ 直接 400 拒绝，不允许再次上传。
 * SELECTED 后只能取消订单后联系服务方重开。
 *
 * 每完成一组立刻落库，前端轮询 candidateGroups 可看到真实进度。
 *
 * 入参：`{ files: Array<{ publicUrl: string }> }`，URL 必须事先通过
 * /api/orders/[token]/upload-url 走 R2 预签名直传拿到（白名单 host 校验）。
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import { inngest } from "@/inngest";
import { submitGeneration } from "@/features/gpt-image/lib/generation-service";
import {
  parseSelections,
  parseUploadedImages,
} from "@/features/gpt-image/lib/order-helpers";
import { archiveOrderSnapshot } from "@/features/gpt-image/lib/order-history";
import { getR2PublicHosts, isR2Configured } from "@/features/image-gen/lib/r2";
import { withApiLogging } from "@/lib/api-logger";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
// 300s（Vercel Pro 上限）：主路径是 Inngest 异步（路由 30s 内就返回 202），
// 但 Inngest send 可能失败（未配 INNGEST_EVENT_KEY、未跑 dev server、
// 网络抖动等）→ 降级同步 submitGeneration，需要 245s 墙钟预算。
//
// 详见下方 `triggerSubmit` 的 try/catch。
export const maxDuration = 300;

/**
 * 触发 submitGeneration：优先 Inngest 异步 send，失败降级到同步调用。
 *
 * Inngest 没配（生产缺 INNGEST_EVENT_KEY / 本地未跑 inngest-cli dev）
 * 时 send 会抛"找不到 event key"——直接降级同步，让用户至少能跑通。
 * 降级路径仍走 /upload maxDuration=300s 预算（submitGeneration 245s
 * 墙钟 + DB 5s）。
 */
async function triggerSubmit(
  orderId: string,
  fromIdx: number,
  total: number,
  candidateCount: number
): Promise<{ mode: "ingest" | "sync" }> {
  try {
    await inngest.send({
      name: "gpt-image/submit-generation",
      data: { orderId, fromIdx, total, candidateCount },
    });
    return { mode: "ingest" };
  } catch (err) {
    logger.warn(
      { err, orderId, fromIdx, total },
      "Inngest send 失败，降级到同步 submitGeneration（未配 INNGEST_EVENT_KEY 或 dev server 未启动？）"
    );
    await submitGeneration(orderId, fromIdx, total, candidateCount);
    return { mode: "sync" };
  }
}

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
    // FAILED 状态下，新上传的图片视为**替换**之前的图（不是追加）。
    // 否则用户卡在"已上传 N 张，本次最多再传 0 张"却无法换图，永远无法恢复。
    const isRetryAfterFailure = order.status === "FAILED";
    if (isRetryAfterFailure) {
      // 只校验新增数量是否超过本订单上限；不与 existing 累加。
      if (accepted.length > order.uploadCount) {
        return NextResponse.json(
          {
            success: false,
            error: `本订单最多 ${order.uploadCount} 张，本次最多上传 ${order.uploadCount} 张`,
          },
          { status: 400 }
        );
      }
    } else if (existing.length + accepted.length > order.uploadCount) {
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

    // FAILED 替换（按位置覆盖）：accepted 按顺序填入槽位，多余的 existing 保留到 uploadCount 上限。
    // 单图模式（UI 一次只发 1 张）下，用户多次点击会逐槽位替换，不会丢掉没碰过的旧图。
    const merged = isRetryAfterFailure
      ? Array.from(
          { length: order.uploadCount },
          (_, i) => accepted[i] ?? existing[i]
        )
      : [...existing, ...accepted];

    // 已有选择补齐到新长度（新增原图的选择位为 null），已选的保持不变。
    // FAILED 替换场景：旧的选择对应的旧图片已丢弃，所以选择也要清空，
    // 否则会出现"选了第 3 张"但只有 1 张图的索引越界问题。
    const prevSelections = parseSelections(order.selections as string | null);
    const nextSelections =
      isRetryAfterFailure || prevSelections === null
        ? null
        : JSON.stringify(
            Array.from(
              { length: merged.length },
              (_, i) => prevSelections[i] ?? null
            )
          );

    // FAILED 重传前归档：必须发生在 update 之前（update 会把 candidates 置 null）。
    // archive 内部会跳过 unusable 状态（如首单 PENDING 上传时无候选）。
    if (isRetryAfterFailure) {
      const snap = await archiveOrderSnapshot(
        order.id,
        "failed_reupload",
        null
      );
      if (snap) {
        logger.info(
          { orderId: order.id, round: snap.round },
          "FAILED 重传前已归档历史快照"
        );
      }
    }

    // Partial lock 后再上传新图：归档当前「已锁定 + N 张原图」状态。
    // trigger 用 regenerate_single——复用现有 trigger 语义（"destructive
    // 写入前的快照"），不引入新 trigger 类型以免污染 history 路由读侧。
    // nextSelections 在 line 184-192 已天然保留锁定位 + 补 null（仅在追加
    // 槽位时才补，不踩坏已有锁定值）。
    const hasLocked =
      order.status === "CANDIDATES_READY" &&
      (parseSelections(order.selections as string | null) ?? []).some(
        (v) => v !== null
      );
    if (!isRetryAfterFailure && hasLocked) {
      const snap = await archiveOrderSnapshot(
        order.id,
        "regenerate_single",
        null
      );
      if (snap) {
        logger.info(
          { orderId: order.id, round: snap.round },
          "partial lock 后上传新图，已归档历史快照"
        );
      }
    }

    await db
      .update(promptOrder)
      .set({
        uploadedImages: JSON.stringify(merged),
        status: "GENERATING",
        // FAILED 重传时刷新上传时间——便于时间线显示最近一次重新上传。
        uploadedAt: isRetryAfterFailure
          ? new Date()
          : (order.uploadedAt ?? new Date()),
        // FAILED 重传：清掉残留的 candidates + generationTask，
        // 避免 /poll 查到旧任务态。
        candidates: isRetryAfterFailure ? null : undefined,
        generationTask: isRetryAfterFailure ? null : undefined,
        selections: nextSelections,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(promptOrder.id, order.id));

    const candidateCount = order.template.candidateCount;

    const fromIdx = isRetryAfterFailure ? 0 : existing.length;
    const total = merged.length;

    logger.info(
      {
        orderId: order.id,
        fromIdx,
        total,
        candidateCount,
        isRetryAfterFailure,
      },
      "提交效果图生成任务"
    );

    // 主流方案：优先 Inngest 异步 send，让 submitGeneration 在后台跑；
    // Inngest 不可用（未配 / dev server 未启）时降级到同步调用——让
    // 路由永远不 502。同步路径需要 ~245s 墙钟，所以 maxDuration 仍
    // 留 300s 预算。
    //
    // FAILED 替换场景：merged 是全新图片，从 0 开始重跑；否则只跑新增的。
    const { mode } = await triggerSubmit(
      order.id,
      fromIdx,
      total,
      candidateCount
    );

    return NextResponse.json(
      {
        success: true,
        message: isRetryAfterFailure
          ? `已替换为 ${accepted.length} 张图片，正在重新生成效果图`
          : `${accepted.length} 张图片已上传，正在生成效果图`,
        data: {
          status: "GENERATING",
          uploadedImageCount: merged.length,
          newImageCount: accepted.length,
          errorMessage: null,
          // 前端可据此决定是否提示"用 Inngest 后台模式 / 降级同步"。
          // 同步模式下用户刷新页面就丢失 in-flight 提交，必须等
          // submitGeneration 走完才能切页。
          triggerMode: mode,
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
