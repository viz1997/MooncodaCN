/**
 * 用户端 - 提交选择
 * POST /api/orders/[token]/select
 *
 * body: `Array<{ batchIdx: number; candIdx: number }>` ——「按批锁定」的增量提交。
 *
 * ## 语义（partial select，2026-09-02 改 batch 索引）
 *
 * 每批参考图独立"锁定"：用户每选好一个候选并提交，就把该批写入
 * `selections[batchIdx] = candIdx`（锁定 = 不可逆）。其他未提交的批位置
 * 保持 null，可在后续继续选 / 提交。
 *
 * 2026-09-02：索引语义从 imageIdx 改成 batchIdx。
 * - 旧语义：selections 长度 = uploadedImageCount（每张原图一个 candIdx）
 * - 新语义：selections 长度 = batchCount = ceil(uploadedImageCount / imagesPerUpload)
 *   （每批 N 张原图合一次生图 = 1 个 candIdx）
 *
 * 兼容老数据：
 * - 入参接受旧式 imageIdx（按 uploadedImageCount 校验），内部按
 *   `Math.floor(imageIdx / imagesPerUpload)` 转 batchIdx
 * - 入参接受新式 batchIdx（按 batchCount 校验）
 * - 写入按 batchIdx 维度覆盖，触发隐式数据迁移（老订单旧索引被新 batch 索引覆盖）
 *
 * 终态后（SELECTED / CANCELLED / GENERATING）→ 400 拒绝。
 *
 * 入参兼容两种形式（迁移期保留）：
 * - 新式：`Array<{ batchIdx, candIdx }>` —— 精确指明要锁定的批
 * - 旧式：`number[]`（长度对齐 uploadedImageCount）—— 全部一次性提交，
 *   内部按 imageIdx 转 batchIdx 后增量合并
 * - 过渡式：`Array<{ imageIdx, candIdx }>` —— 旧版 imageIdx 字段，内部转 batchIdx
 */

import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { promptOrder } from "@/db/schema";
import {
  parseSelections,
  parseUploadedImages,
} from "@/features/gpt-image/lib/order-helpers";
import { withApiLogging } from "@/lib/api-logger";

export const runtime = "nodejs";

/**
 * 2026-09-02：单次提交的最小单元。
 * - 内部用 batchIdx 存
 * - 外部入参兼容 batchIdx / imageIdx（前者优先）
 */
interface PartialSelectItem {
  batchIdx: number;
  candIdx: number;
}

/**
 * 把入参规范化为 PartialSelectItem[]（统一以 batchIdx 索引）。
 *
 * - 新式 `Array<{ batchIdx, candIdx }>` → 透传（imageIdx / batchIdx 字段识别）
 * - 旧式 `number[]`（长度对齐 uploadedImageCount）→ 按 imageIdx 转 batchIdx
 * - 过渡式 `Array<{ imageIdx, candIdx }>` → imageIdx 转 batchIdx
 * - 其他 → throw
 */
function normalizeSelections(
  raw: unknown,
  imagesPerUpload: number
): PartialSelectItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("EMPTY");
  }

  // 旧式 number[]：每项都是 number
  const allNumbers = raw.every((v) => typeof v === "number");
  if (allNumbers) {
    const perBatch = Math.max(1, imagesPerUpload);
    return raw.map((v, imageIdx) => ({
      batchIdx: Math.floor(imageIdx / perBatch),
      candIdx: v as number,
    }));
  }

  // 数组项形式：支持 { batchIdx, candIdx } 或 { imageIdx, candIdx }
  return raw.map((v) => {
    if (typeof v !== "object" || v === null) {
      throw new Error("BAD_ITEM");
    }
    const obj = v as Record<string, unknown>;
    const candRaw = obj.candIdx;
    if (typeof candRaw !== "number") throw new Error("BAD_ITEM");
    // 优先 batchIdx（新）；回退 imageIdx（兼容老客户端）
    if (typeof obj.batchIdx === "number") {
      return { batchIdx: obj.batchIdx, candIdx: candRaw };
    }
    if (typeof obj.imageIdx === "number") {
      const perBatch = Math.max(1, imagesPerUpload);
      return {
        batchIdx: Math.floor(obj.imageIdx / perBatch),
        candIdx: candRaw,
      };
    }
    throw new Error("BAD_ITEM");
  });
}

async function postHandler(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      selections?: unknown;
    };

    const order = await db.query.promptOrder.findFirst({
      where: eq(promptOrder.token, token),
      with: { template: true },
    });
    if (!order) {
      return NextResponse.json(
        { success: false, error: "订单不存在或链接无效" },
        { status: 404 }
      );
    }
    if (order.status !== "CANDIDATES_READY") {
      return NextResponse.json(
        {
          success: false,
          error: `当前状态为 ${order.status}，无法选择。${
            order.status === "SELECTED"
              ? "已提交不可修改，只能取消。"
              : order.status === "GENERATING"
                ? "正在生成中，请等待本轮完成。"
                : ""
          }`,
        },
        { status: 400 }
      );
    }

    const uploadedImageCount = parseUploadedImages(
      order.uploadedImages as string | null
    ).length;
    const imagesPerUpload = Math.max(1, order.imagesPerUpload);
    // 2026-09-02：batchCount = ceil(uploadedImageCount / imagesPerUpload)
    const batchCount = Math.ceil(uploadedImageCount / imagesPerUpload);
    const candidateCount = order.template.candidateCount;

    let items: PartialSelectItem[];
    try {
      items = normalizeSelections(body.selections, imagesPerUpload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const errorText =
        msg === "EMPTY"
          ? "请提交至少一项选择"
          : msg === "BAD_ITEM"
            ? "每项必须是 { batchIdx: number; candIdx: number }，或旧式 number[] / { imageIdx, candIdx }"
            : "选择数据格式无效";
      return NextResponse.json(
        { success: false, error: errorText },
        { status: 400 }
      );
    }

    // 校验每项的 batchIdx / candIdx 范围
    for (const item of items) {
      if (
        !Number.isInteger(item.batchIdx) ||
        item.batchIdx < 0 ||
        item.batchIdx >= batchCount
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `batchIdx ${item.batchIdx} 超出范围（应在 0-${batchCount - 1} 之间）`,
          },
          { status: 400 }
        );
      }
      if (
        !Number.isInteger(item.candIdx) ||
        item.candIdx < 0 ||
        item.candIdx >= candidateCount
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `第 ${item.batchIdx + 1} 批的 candIdx ${item.candIdx} 超出范围（应在 0-${candidateCount - 1} 之间）`,
          },
          { status: 400 }
        );
      }
    }

    // 合并：以服务端已有 selections 为基础，按 batchIdx 覆盖。
    // 同一 batchIdx 重复提交以最后一条为准（防御性）。
    //
    // 2026-09-02：DB selections 现在是按 batchIdx 维度存的 number[]，长度
    // 应等于 batchCount。如果老数据按 imageIdx 维度存（长度 = uploadedImageCount），
    // 这里按 batchIdx 读取会读到 batchIdx 位置上的旧 imageIdx 值，**意图覆盖
    // 后即迁移完成**。读时 readSelectionsForBatch 已做适配，但本路由读的是
    // DB 原始值（不调 use-selections 的 helper），所以这里直接按 batchCount
    // 长度初始化——老数据未覆盖的位视为 null。
    const baseSelections =
      parseSelections(order.selections) ??
      Array.from({ length: batchCount }, () => null);
    const merged: (number | null)[] = Array.from(
      { length: batchCount },
      (_, i) => baseSelections[i] ?? null
    );
    for (const item of items) {
      merged[item.batchIdx] = item.candIdx;
    }

    const lockedCount = merged.filter((v) => v !== null).length;
    // 2026-09-02：终态条件改成 batchCount（不是 uploadedImageCount）。
    // 上传槽位已满（uploadedImageCount === uploadCount × imagesPerUpload）
    // 且全部 batch 已锁 → SELECTED；否则保持 CANDIDATES_READY。
    const totalCapacity = order.uploadCount * order.imagesPerUpload;
    const slotsFull = uploadedImageCount === totalCapacity;
    const allLocked = slotsFull && lockedCount === batchCount;
    const nextStatus = allLocked ? "SELECTED" : "CANDIDATES_READY";
    // selectedIndex：保留 firstLocked 的 candIdx（订单级最终选择）。第一
    // 个锁定的 batch 的 candIdx 仍然有意义——它代表"主批次"的选择。
    const firstLockedIdx = merged.findIndex((v) => v !== null);
    const updateSet: {
      selections: string;
      status: typeof nextStatus;
      updatedAt: Date;
      selectedIndex?: number | null;
      selectedAt?: Date;
    } = {
      selections: JSON.stringify(merged),
      status: nextStatus,
      updatedAt: new Date(),
    };
    if (allLocked) {
      updateSet.selectedIndex =
        firstLockedIdx >= 0 ? (merged[firstLockedIdx] ?? null) : null;
      updateSet.selectedAt = new Date();
    }

    await db
      .update(promptOrder)
      .set(updateSet)
      .where(eq(promptOrder.id, order.id));

    const message = allLocked
      ? `全部 ${batchCount} 批已锁定，订单已确认。结果不可修改，如需更改请取消订单。`
      : slotsFull
        ? `已锁定 ${lockedCount}/${batchCount} 批，订单已确认。`
        : `已锁定 ${lockedCount}/${batchCount} 批。剩余 ${
            totalCapacity - uploadedImageCount
          } 张可继续上传。`;

    return NextResponse.json({
      success: true,
      message,
      data: {
        status: nextStatus,
        selections: merged,
        lockedCount,
        totalCount: batchCount,
        allLocked,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "提交失败",
      },
      { status: 500 }
    );
  }
}

export const POST = withApiLogging(postHandler);
