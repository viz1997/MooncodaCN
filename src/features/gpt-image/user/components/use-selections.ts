"use client";

import { useCallback, useState } from "react";

import type { OrderView } from "@/features/gpt-image/lib/types";

export interface UseSelectionsResult {
  /** 长度始终对齐 uploadedImageCount */
  selections: (number | null)[];
  selectedCount: number;
  allSelected: boolean;
  /** 第一张未选原图的下标，全选完则为 -1 */
  firstUnselectedIdx: number;
  toggle: (imageIdx: number, candIdx: number) => void;
  /** 提交用：确认全选后的纯数字数组，未选满返回 null */
  toPayload: () => number[] | null;
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
 * 本地选择草稿。
 *
 * 服务端 selections 只有 /select 一个写入方，所以调和规则可以很简单：
 * - 换了订单 → 用服务端值初始化；
 * - 进入 SELECTED 终态 → 以服务端为准（终态权威）；
 * - 原图数量变化 → 按新长度补齐草稿（新增位为 null），保留已有选择；
 * - 其余轮询一律不覆盖草稿。
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

  const toggle = useCallback((imageIdx: number, candIdx: number) => {
    setDraft((prev) => {
      const values = [...prev.values];
      while (values.length <= imageIdx) values.push(null);
      values[imageIdx] = values[imageIdx] === candIdx ? null : candIdx;
      return { ...prev, values };
    });
  }, []);

  /**
   * 用服务端权威值强制覆盖本地草稿。
   *
   * 仅在 restore / 终态进入时显式调用 —— 平时轮询不应该触发它，
   * 否则用户的未提交选择会被服务端旧值覆盖丢失。
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

  const toPayload = useCallback((): number[] | null => {
    if (effective.length !== uploadedCount || effective.some((v) => v === null))
      return null;
    return effective as number[];
  }, [effective, uploadedCount]);

  return {
    selections: effective,
    selectedCount,
    allSelected,
    firstUnselectedIdx,
    toggle,
    toPayload,
    replaceFromServer,
  };
}
