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
// 90s：覆盖 submitGeneration 内"下载原图 30s + Lingting 提交 60s"的最坏
// 链路。Vercel 函数预算低于 90s 时会被砍，订单 status 被置 GENERATING 后
// 半途退出 → generationTask 没写库 → 订单永远卡住。90s 留 5-10s 给 DB
// 落库 + 响应序列化缓冲。
export const maxDuration = 90;

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

    logger.info(
      {
        orderId: order.id,
        fromIdx: isRetryAfterFailure ? 0 : existing.length,
        total: merged.length,
        candidateCount,
        isRetryAfterFailure,
      },
      "提交效果图生成任务"
    );
    // 只做 submit（拿 task_id 落库），在本请求周期内完成，不留后台任务。
    // 后续轮询由前端调 POST /api/orders/[token]/poll 驱动。
    // FAILED 替换场景：merged 是全新图片，从 0 开始重跑；否则只跑新增的。
    await submitGeneration(
      order.id,
      isRetryAfterFailure ? 0 : existing.length,
      merged.length,
      candidateCount
    );

    // 关键：submitGeneration 内部可能把状态覆写回 FAILED（全部 submit 失败），
    // 不能用硬编码的 "GENERATING" 回客户端——会出现"toast 说正在生成、徽章是失败"的错位。
    // 重新读一次 DB 拿真实终态。
    const finalOrder = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.id, order.id),
      columns: { status: true, errorMessage: true },
    });
    const finalStatus = finalOrder?.status ?? "GENERATING";
    const finalError = finalOrder?.errorMessage ?? null;
    const generationFailed = finalStatus === "FAILED";

    return NextResponse.json(
      {
        // 上传本身成功；只有生成这一步可能失败。FAILED 时 success=false 让客户端走错误提示。
        success: !generationFailed,
        message: generationFailed
          ? (finalError ?? "生图任务提交失败，请稍后重试")
          : isRetryAfterFailure
            ? `已替换为 ${accepted.length} 张图片，正在重新生成效果图`
            : `${accepted.length} 张图片已上传，正在生成效果图`,
        data: {
          status: finalStatus,
          uploadedImageCount: merged.length,
          newImageCount: accepted.length,
          errorMessage: finalError,
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
