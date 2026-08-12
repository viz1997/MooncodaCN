"use client";

import { useCallback, useState } from "react";

import type { OrderView } from "@/features/gpt-image/lib/types";

/**
 * 单张原图的提交项（partial select 的最小提交单元）。
 *
 * 与 `/api/orders/[token]/select` 路由新式入参对齐：每次提交只携带
 * "新锁定的位"，服务端按 imageIdx 增量合并（plan §变更 1）。
 */
export interface PartialSelectItem {
  imageIdx: number;
  candIdx: number;
}

export interface UseSelectionsResult {
  /** 长度始终对齐 uploadedImageCount */
  selections: (number | null)[];
  /** 非空位数量（含已锁定 + 本地草稿已选） */
  selectedCount: number;
  /** 是否所有位都已选（含锁定）—— 仅供 ResultStep 全选徽章使用 */
  allSelected: boolean;
  /** 第一张未选原图的下标；全选完为 -1 */
  firstUnselectedIdx: number;
  /**
   * partial select 语义：已被服务端锁定的位（selections[i] !== null 且
   * 订单处于 CANDIDATES_READY）。SELECTED 终态下整张订单都是锁定态，但
   * 此时不会进入 SelectStep，所以该字段在 SELECTED 下无视觉意义。
   */
  isLocked: (imageIdx: number) => boolean;
  /** 已锁定位数量（服务端 selections 非空） */
  lockedCount: number;
  /** 未锁定位数量 = uploadedCount - lockedCount */
  pendingCount: number;
  /** 切换某张原图的本地候选选择；已锁定位忽略 */
  toggle: (imageIdx: number, candIdx: number) => void;
  /**
   * 提交用：返回**增量**的锁定项（只含本地草稿非空、且与服务端锁定值
   * 不一致的位）。无任何待锁定项时返回 null（按钮应禁用）。
   */
  toPayload: () => PartialSelectItem[] | null;
  /**
   * 用服务端权威值替换本地草稿（如 restore 历史快照后调用）。
   * 与轮询调和不同：调用一次就强制覆盖，而不是只在长度变化时增量补齐。
   */
  replaceFromServer: (values: (number | null)[] | null, length: number) => void;
}

interface DraftState {
  orderId: string;
  length: number;
  final: boolean;
  values: (number | null)[];
}

const EMPTY: DraftState = {
  orderId: "",
  length: 0,
  final: false,
  values: [],
};

function normalize(
  source: (number | null)[] | null | undefined,
  length: number
): (number | null)[] {
  return Array.from({ length }, (_, i) => {
    const v = source?.[i];
    return typeof v === "number" ? v : null;
  });
}

/**
 * 本地选择草稿（partial select 感知，批次模型锁定 = 不可重做）。
 *
 * 服务端 selections 有两类写入方：
 * - `/select` 路由（partial submit，按 imageIdx 增量合并）
 * - `/history/[id]/restore` 路由（快照恢复，可能不同步本地草稿）
 *
 * 服务端权威值 `order.selections` 的语义：
 * - 非 null = 已锁定（批次模型下"提交即锁定"，要重做只能服务端解锁）
 * - null = 待用户选择
 *
 * 调和规则：
 * - 换了订单 → 用服务端值初始化
 * - 进入 SELECTED 终态 → 以服务端为准（终态权威）
 * - 原图数量变化 → 按新长度补齐草稿，新增位为 null，保留已有选择
 * - 其余轮询一律不覆盖草稿（保护本地未提交选择）
 */
export function useSelections(order: OrderView | null): UseSelectionsResult {
  const uploadedCount = order?.uploadedImageCount ?? 0;
  const isFinal = order?.status === "SELECTED";

  const [draft, setDraft] = useState<DraftState>(EMPTY);

  let current = draft;
  if (order) {
    const switchedOrder = draft.orderId !== order.id;
    const justFinalized = isFinal && !draft.final;

    if (switchedOrder || justFinalized) {
      current = {
        orderId: order.id,
        length: uploadedCount,
        final: isFinal,
        values: normalize(order.selections, uploadedCount),
      };
    } else if (draft.length !== uploadedCount) {
      current = {
        ...draft,
        length: uploadedCount,
        values: normalize(draft.values, uploadedCount),
      };
    }
    if (current !== draft) setDraft(current);
  }

  /**
   * 已锁定位判定：CANDIDATES_READY 状态下服务端 selections[i] !== null
   * 即锁定。SELECTED 终态下整张订单都已锁，但此时不会进入 SelectStep。
   */
  const isLocked = useCallback(
    (imageIdx: number): boolean => {
      if (!order) return false;
      if (order.status !== "CANDIDATES_READY") return false;
      const v = order.selections?.[imageIdx];
      return typeof v === "number";
    },
    [order]
  );

  const toggle = useCallback(
    (imageIdx: number, candIdx: number) => {
      // 已锁定位：本地点不动（与服务端锁定值保持一致；批次模型下"提交即
      // 锁定"，要重做只能服务端解锁后用户重新触发）。
      if (isLocked(imageIdx)) return;
      setDraft((prev) => {
        const values = [...prev.values];
        while (values.length <= imageIdx) values.push(null);
        values[imageIdx] = values[imageIdx] === candIdx ? null : candIdx;
        return { ...prev, values };
      });
    },
    [isLocked]
  );

  /**
   * 用服务端权威值强制覆盖本地草稿。
   *
   * 仅在 restore 时显式调用 —— 平时轮询不应触发，否则用户的未提交选择
   * 会被服务端旧值覆盖丢失。/restore 路由已用 buildRestoredState 保留
   * 已锁定位，此处直接覆盖即可。
   */
  const replaceFromServer = useCallback(
    (values: (number | null)[] | null, length: number) => {
      setDraft({
        orderId: order?.id ?? "",
        length,
        final: order?.status === "SELECTED",
        values: normalize(values, length),
      });
    },
    [order?.id, order?.status]
  );

  const effective = current.values.slice(0, uploadedCount);
  const selectedCount = effective.filter((v) => v !== null).length;
  const allSelected = uploadedCount > 0 && selectedCount === uploadedCount;
  const firstUnselectedIdx = effective.findIndex((v) => v === null);

  // lockedCount / pendingCount 来自服务端权威值（不是本地草稿）
  const serverSelections = order?.selections ?? null;
  const lockedCount = serverSelections?.filter((v) => v !== null).length ?? 0;
  const pendingCount = Math.max(0, uploadedCount - lockedCount);

  /**
   * 增量 toPayload：只返回"本地草稿非空、且与服务端锁定值不一致"的位。
   *
   * 跳过规则：
   * - 服务端已锁定且本地值等于服务端值 → 已提交过，无需重提
   * - 服务端已锁定且本地值不同 → 已被 isLocked 视觉禁用，正常不会发生
   *   （防御性：本地被覆盖后值变了，仍按服务端为准跳过）
   * - 服务端未锁定但本地为 null → 用户没选，不提
   * - 服务端未锁定且本地非空 → 就是要提交的新锁定项
   */
  const toPayload = useCallback((): PartialSelectItem[] | null => {
    if (!order) return null;
    const items: PartialSelectItem[] = [];
    for (let i = 0; i < uploadedCount; i++) {
      const local = effective[i] ?? null;
      const server = serverSelections?.[i] ?? null;
      if (local === null) continue;
      if (server !== null && server === local) continue;
      items.push({ imageIdx: i, candIdx: local });
    }
    return items.length > 0 ? items : null;
  }, [order, uploadedCount, effective, serverSelections]);

  return {
    selections: effective,
    selectedCount,
    allSelected,
    firstUnselectedIdx,
    isLocked,
    lockedCount,
    pendingCount,
    toggle,
    toPayload,
    replaceFromServer,
  };
}
