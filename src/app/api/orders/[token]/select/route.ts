/**
 * 用户端 - 提交选择
 * POST /api/orders/[token]/select
 *
 * body: `Array<{ imageIdx: number; candIdx: number }>` ——「按图锁定」的增量提交。
 *
 * ## 语义（partial select）
 *
 * 每张原图独立"锁定"：用户每选好一张候选并提交，就把那张图写入
 * `selections[imageIdx] = candIdx`（锁定 = 不可逆）。其他未提交的原图位置
 * 保持 null，可在后续继续上传 / 选图 / 提交。
 *
 * - 允许只提交部分图（任意非空子集）。已锁定的位不能再改（前端按钮禁用，
 *   服务端此处做"以最后一条为准"的合并——客户端按 `isLocked` 不会再触达）。
 * - 上传槽位已满（`uploadedImageCount === uploadCount × imagesPerUpload`）且全部图都锁定
 *   后，订单转入 SELECTED 终态；否则保留 CANDIDATES_READY（用户还可以
 *   继续上传下一张 / 选下一张候选）。仅"已上传的图全部锁定"不足以进
 *   终态——剩余 uploadCount 余量必须填满。
 * - `selectedAt` 只在**第一次**进 SELECTED 时写入；partial submit
 *   期间不刷新 selectedAt，避免时间线反复抖动。
 *
 * 终态后（SELECTED / CANCELLED / GENERATING）→ 400 拒绝。
 *
 * 入参兼容两种形式（迁移期保留）：
 * - 新式：`Array<{ imageIdx: number; candIdx: number }>` —— 精确指明要锁定的位
 * - 旧式：`number[]`（长度对齐 uploadedImageCount）—— 全部一次性提交，
 *   内部转成"按 index 覆盖"的增量 payload 处理
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

interface PartialSelectItem {
  imageIdx: number;
  candIdx: number;
}

/**
 * 把入参规范化为 PartialSelectItem[]。
 *
 * - `Array<{ imageIdx, candIdx }>` → 透传
 * - `number[]`（旧式）→ 按位置展开成 `{ imageIdx: i, candIdx: v }`
 * - 其他 → throw（被调用方 catch 后返回 400）
 */
function normalizeSelections(raw: unknown): PartialSelectItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("EMPTY");
  }

  // 旧式 number[]：每一项都是 number
  const allNumbers = raw.every((v) => typeof v === "number");
  if (allNumbers) {
    return raw.map((v, i) => ({
      imageIdx: i,
      candIdx: v as number,
    }));
  }

  // 新式 { imageIdx, candIdx }[]
  return raw.map((v) => {
    if (
      typeof v !== "object" ||
      v === null ||
      typeof (v as PartialSelectItem).imageIdx !== "number" ||
      typeof (v as PartialSelectItem).candIdx !== "number"
    ) {
      throw new Error("BAD_ITEM");
    }
    return v as PartialSelectItem;
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

    let items: PartialSelectItem[];
    try {
      items = normalizeSelections(body.selections);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const errorText =
        msg === "EMPTY"
          ? "请提交至少一项选择"
          : msg === "BAD_ITEM"
            ? "每项必须是 { imageIdx: number, candIdx: number }，或旧式 number[]"
            : "选择数据格式无效";
      return NextResponse.json(
        { success: false, error: errorText },
        { status: 400 }
      );
    }

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
    const candidateCount = order.template.candidateCount;

    // 校验每项的 imageIdx / candIdx 范围
    for (const item of items) {
      if (
        !Number.isInteger(item.imageIdx) ||
        item.imageIdx < 0 ||
        item.imageIdx >= uploadedImageCount
      ) {
        return NextResponse.json(
          {
            success: false,
            error: `imageIdx ${item.imageIdx} 超出范围（应在 0-${uploadedImageCount - 1} 之间）`,
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
            error: `第 ${item.imageIdx + 1} 张原图的 candIdx ${item.candIdx} 超出范围（应在 0-${candidateCount - 1} 之间）`,
          },
          { status: 400 }
        );
      }
    }

    // 合并：以服务端已有 selections 为基础，按 imageIdx 覆盖。
    // 同一 imageIdx 重复提交以最后一条为准（防御性：前端按 isLocked 不会
    // 重复提交，但恶意或老客户端可能触达）。
    const baseSelections =
      parseSelections(order.selections) ??
      Array.from({ length: uploadedImageCount }, () => null);
    // 对齐长度：避免极端情况（DB selections 长度小于 uploadedImageCount）
    const merged: (number | null)[] = Array.from(
      { length: uploadedImageCount },
      (_, i) => baseSelections[i] ?? null
    );
    for (const item of items) {
      merged[item.imageIdx] = item.candIdx;
    }

    const lockedCount = merged.filter((v) => v !== null).length;
    // 终态条件：上传槽位已满（uploadedImageCount === uploadCount × imagesPerUpload）
    // 且全部已锁。只锁完已上传的图但还剩上传余量时，保持 CANDIDATES_READY，
    // 让用户继续传下一张原图。否则会出现"2/3 张全部锁定就直接终态"的
    // 体验断裂，用户被迫取消订单重开。
    const totalCapacity = order.uploadCount * order.imagesPerUpload;
    const slotsFull = uploadedImageCount === totalCapacity;
    const allLocked = slotsFull && lockedCount === uploadedImageCount;
    const nextStatus = allLocked ? "SELECTED" : "CANDIDATES_READY";
    // selectedAt 只在第一次进 SELECTED 时写入（partial submit 期间不刷新）。
    // 上面状态校验已保证 order.status === "CANDIDATES_READY"，因此进入此
    // 分支意味着订单首次进 SELECTED——直接写 selectedAt = now()。
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
      updateSet.selectedIndex = merged[0] ?? null;
      updateSet.selectedAt = new Date();
    }

    await db
      .update(promptOrder)
      .set(updateSet)
      .where(eq(promptOrder.id, order.id));

    const message = allLocked
      ? `全部 ${uploadedImageCount} 张已锁定，订单已确认。结果不可修改，如需更改请取消订单。`
      : slotsFull
        ? `已锁定 ${lockedCount}/${uploadedImageCount} 张，订单已确认。`
        : `已锁定 ${lockedCount}/${uploadedImageCount} 张。剩余 ${
            totalCapacity - uploadedImageCount
          } 张可继续上传。`;

    return NextResponse.json({
      success: true,
      message,
      data: {
        status: nextStatus,
        selections: merged,
        lockedCount,
        totalCount: uploadedImageCount,
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
