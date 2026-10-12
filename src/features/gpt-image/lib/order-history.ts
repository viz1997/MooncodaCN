/**
 * 效果图历史快照 —— 共享服务
 *
 * 把"归档当前可用状态"和"恢复历史版本"封装成两个事务安全函数，
 * 供 regenerate / upload / history 三个路由复用。
 *
 * ## 锁策略
 *
 * 同一订单并发归档（双击 + 异步轮询都算）会导致 round 计算冲突。
 * 解决：archive 函数入口先 `SELECT id ... FOR UPDATE` 锁住 prompt_order 行，
 * 再读 max(round)，再 INSERT。UNIQUE(order_id, round) 兜底。
 *
 * ## "usable" 判定
 *
 * 至少 1 张已上传原图，且每个槽位都有非空候选组（candidates[i] 数组非空）。
 * 不满足 → 直接返回 null，不创建空快照。
 *
 * ## 不归档的字段
 *
 * generationTask / errorMessage / selectedAt / cancelledAt 是过程态，
 * 不在快照里出现；恢复时也不复活它们。
 */

import { randomBytes } from "node:crypto";
import { and, desc, sql as drizzleSql, eq, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

import { db } from "@/db";
import {
  type PromptOrderHistory,
  type PromptOrderHistoryTrigger,
  type PromptTemplate,
  promptOrder,
  promptOrderHistory,
  promptTemplate,
} from "@/db/schema";
import { logger } from "@/lib/logger";

import {
  parseCandidates,
  parseSelections,
  parseUploadedImages,
} from "./order-helpers";

/** 归档需要的最小订单字段（带模板） */
export interface LockedOrderWithTemplate {
  id: string;
  token: string;
  templateId: string;
  status: string;
  uploadedImages: string | null;
  candidates: string | null;
  selections: string | null;
  uploadedAt: Date | null;
  generatedAt: Date | null;
  template: { candidateCount: number; size: string };
}

/** drizzle 事务 executor（运行时接收 db 或 tx） */
export type DbOrTx =
  | typeof db
  | PgTransaction<
      // biome-ignore lint/suspicious/noExplicitAny: drizzle 内部泛型
      any,
      // biome-ignore lint/suspicious/noExplicitAny: drizzle 内部泛型
      any,
      // biome-ignore lint/suspicious/noExplicitAny: drizzle 内部泛型
      any
    >;

/** 生成快照 id（与 promptOrder 同风格：随机 21 字符） */
function newHistoryId(): string {
  return randomBytes(12).toString("base64url").slice(0, 21);
}

/**
 * 在事务中锁住 prompt_order 行；调用方负责提供事务 executor。
 * 失败抛错（事务回滚）。
 */
async function lockOrderRow(
  tx: DbOrTx,
  orderId: string
): Promise<{ id: string } | null> {
  const rows = await tx.execute(drizzleSql<{ id: string }>`
    SELECT id FROM prompt_order WHERE id = ${orderId} FOR UPDATE
  `);
  // drizzle pg 返回的 rows 形状：{ rows: T[] } 或 T[]（取决于 driver）
  const list = Array.isArray(rows)
    ? (rows as Array<{ id: string }>)
    : (rows as { rows?: Array<{ id: string }> }).rows;
  const first = list?.[0];
  return first ? { id: first.id } : null;
}

/**
 * 在事务内重读订单 + 模板（已锁定行）。
 */
export async function readLockedOrder(
  tx: DbOrTx,
  orderId: string
): Promise<LockedOrderWithTemplate | null> {
  const rows = await tx
    .select({
      id: promptOrder.id,
      token: promptOrder.token,
      templateId: promptOrder.templateId,
      status: promptOrder.status,
      uploadedImages: promptOrder.uploadedImages,
      candidates: promptOrder.candidates,
      selections: promptOrder.selections,
      uploadedAt: promptOrder.uploadedAt,
      generatedAt: promptOrder.generatedAt,
      candidateCount: promptTemplate.candidateCount,
      size: promptTemplate.size,
    })
    .from(promptOrder)
    .innerJoin(promptTemplate, eq(promptOrder.templateId, promptTemplate.id))
    .where(eq(promptOrder.id, orderId))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    token: r.token,
    templateId: r.templateId,
    status: r.status,
    uploadedImages: r.uploadedImages,
    candidates: r.candidates,
    selections: r.selections,
    uploadedAt: r.uploadedAt,
    generatedAt: r.generatedAt,
    template: { candidateCount: r.candidateCount, size: r.size },
  };
}

/**
 * 归档订单当前可用状态。
 *
 * 在事务中：
 * 1. 锁住 prompt_order 行
 * 2. 读 locked order + template
 * 3. 计算 max(round) + 1
 * 4. 若当前不是 usable 状态（无可用候选），返回 null，不创建快照
 * 5. INSERT prompt_order_history
 *
 * @param trigger  归档原因
 * @param imageIdx 归档聚焦的原图索引（批量归档传 null，归档函数自动归一化）
 * @param options.tx 调用方已开启的事务；不传则在内部 db.transaction 中完成
 */
export async function archiveOrderSnapshot(
  orderId: string,
  trigger: PromptOrderHistoryTrigger,
  imageIdx: number | null | undefined,
  options: { tx?: DbOrTx } = {}
): Promise<PromptOrderHistory | null> {
  const exec = async (tx: DbOrTx) => {
    const locked = await lockOrderRow(tx, orderId);
    if (!locked) return null;
    const order = await readLockedOrder(tx, orderId);
    if (!order) return null;

    // 取 max(round) 用于递增
    const roundRows = await tx
      .select({
        maxRound: sql<number>`COALESCE(MAX(${promptOrderHistory.round}), 0)`,
      })
      .from(promptOrderHistory)
      .where(eq(promptOrderHistory.orderId, orderId));
    const nextRound = (roundRows[0]?.maxRound ?? 0) + 1;

    const uploaded = parseUploadedImages(order.uploadedImages);
    const candidates = parseCandidates(order.candidates);
    const selections = parseSelections(order.selections);

    // usable 判定：至少 1 张上传 + 每个槽位都有非空候选
    if (uploaded.length === 0) return null;
    let allReady = true;
    for (let i = 0; i < uploaded.length; i++) {
      const group = candidates[i];
      if (!Array.isArray(group) || group.length === 0) {
        allReady = false;
        break;
      }
    }
    if (!allReady) return null;

    // imageIdx 归一化
    let focusIdx: number;
    if (
      typeof imageIdx === "number" &&
      imageIdx >= 0 &&
      imageIdx < uploaded.length
    ) {
      focusIdx = imageIdx;
    } else {
      // 批量归档：选第一个非 null 的选择；否则 0
      const firstSelected = selections?.findIndex((v) => v !== null) ?? -1;
      focusIdx = firstSelected >= 0 ? firstSelected : 0;
    }

    const candidateCount = order.template.candidateCount;
    const curSel = selections?.[focusIdx];
    const focusCandIdx =
      typeof curSel === "number" && curSel >= 0 && curSel < candidateCount
        ? curSel
        : 0;

    const id = newHistoryId();
    const inserted = await tx
      .insert(promptOrderHistory)
      .values({
        id,
        orderId,
        round: nextRound,
        trigger,
        imageIdx: focusIdx,
        candidateIdx: focusCandIdx,
        candidates: JSON.stringify(candidates),
        selections: order.selections,
        uploadedImages: JSON.stringify(uploaded),
        templateId: order.templateId,
        candidateCount,
        imageCount: uploaded.length,
        size: order.template.size,
        generatedAt: order.generatedAt,
      })
      .returning();
    const row = inserted[0];
    if (!row) return null;
    logger.info(
      { orderId, historyId: id, round: nextRound, trigger, imageIdx: focusIdx },
      "已归档历史快照"
    );
    return row;
  };

  if (options.tx) {
    return exec(options.tx);
  }
  return db.transaction(exec);
}

/**
 * 校验快照与当前订单的模板兼容性。
 * 模板 / candidateCount / size 任一不一致 → false。
 */
export function isSnapshotTemplateCompatible(
  snapshot: Pick<PromptOrderHistory, "templateId" | "candidateCount" | "size">,
  current: Pick<PromptTemplate, "id" | "candidateCount" | "size">
): boolean {
  return (
    snapshot.templateId === current.id &&
    snapshot.candidateCount === current.candidateCount &&
    snapshot.size === current.size
  );
}

/**
 * 校验上传兼容性：当前 uploadedImages 的 [0, snapshot.imageCount) 必须
 * 逐位等于快照里的 uploadedImages；尾部多出来的上传允许。
 *
 * 例：快照时 1 张图，当前 3 张图 → 兼容（前 1 张相同，尾部 2 张新增）。
 *     快照时 3 张图，当前 1 张图 → 不兼容。
 *     快照第 1 张 = urlA，当前第 1 张 = urlB → 不兼容（旧图已被换）。
 */
export function isSnapshotUploadCompatible(
  snapshotUploaded: string[],
  currentUploaded: string[]
): boolean {
  const imageCount = snapshotUploaded.length;
  if (currentUploaded.length < imageCount) return false;
  for (let i = 0; i < imageCount; i++) {
    if (snapshotUploaded[i] !== currentUploaded[i]) return false;
  }
  return true;
}

/**
 * 在事务中合并 candidates / selections：0..imageCount-1 用快照值；
 * 超出部分保留当前。selections[snapshot.imageIdx] 强制设为 candidateIdx。
 */
export function buildRestoredState(
  snapshot: Pick<
    PromptOrderHistory,
    "imageCount" | "imageIdx" | "candidateIdx" | "candidates" | "selections"
  >,
  currentCandidates: string[][],
  currentSelections: (number | null)[] | null
): {
  candidates: string[][];
  selections: (number | null)[];
} {
  const snapCandidates = parseCandidates(snapshot.candidates);
  const snapSelections = parseSelections(snapshot.selections);

  const focusIdx = snapshot.imageIdx ?? 0;
  const candidateCount = snapCandidates[focusIdx]?.length ?? 0;
  const safeFocusCandIdx =
    typeof snapshot.candidateIdx === "number" &&
    snapshot.candidateIdx >= 0 &&
    snapshot.candidateIdx < Math.max(candidateCount, 1)
      ? snapshot.candidateIdx
      : 0;

  const mergedCandidates: string[][] = currentCandidates.map((g) =>
    Array.isArray(g) ? [...g] : []
  );
  for (let i = 0; i < snapshot.imageCount; i++) {
    mergedCandidates[i] = [...(snapCandidates[i] ?? [])];
  }

  const baseSelections: (number | null)[] = Array.from(
    { length: mergedCandidates.length },
    (_, i) => {
      const v = currentSelections?.[i];
      return typeof v === "number" ? v : null;
    }
  );
  // 0..imageCount-1 用快照选择；超出保留当前。
  // **已锁定位保持不动**（partial select 不可逆）：current[i] !== null 时
  // 跳过覆盖，避免 restore 把用户精心"按图锁定"的状态一锅端。改主意
  // 只能 cancel 整单重开（与 regenerate 锁定 409 一致）。
  for (let i = 0; i < snapshot.imageCount; i++) {
    if (baseSelections[i] !== null) continue; // 已锁定 → 保留
    const v = snapSelections?.[i];
    baseSelections[i] = typeof v === "number" ? v : null;
  }
  // 强制 focus 选中——但仅在 focus 位未锁定时（已锁定的话不能强行覆盖）
  if (
    focusIdx >= 0 &&
    focusIdx < baseSelections.length &&
    baseSelections[focusIdx] === null
  ) {
    baseSelections[focusIdx] = safeFocusCandIdx;
  }

  return {
    candidates: mergedCandidates,
    selections: baseSelections,
  };
}

/**
 * 读取某订单的所有快照（按 round DESC）。
 * 公开给 GET /history 路由使用。
 */
export async function listHistoryByOrder(
  orderId: string
): Promise<PromptOrderHistory[]> {
  return db
    .select()
    .from(promptOrderHistory)
    .where(eq(promptOrderHistory.orderId, orderId))
    .orderBy(desc(promptOrderHistory.round));
}

/**
 * 读取指定快照，并校验它属于该订单（防越权：historyId 不能跨 order 串用）。
 */
export async function findHistoryForOrder(
  historyId: string,
  orderId: string
): Promise<PromptOrderHistory | null> {
  const rows = await db
    .select()
    .from(promptOrderHistory)
    .where(
      and(
        eq(promptOrderHistory.id, historyId),
        eq(promptOrderHistory.orderId, orderId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
