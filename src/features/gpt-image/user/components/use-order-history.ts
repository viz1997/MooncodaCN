"use client";

/**
 * TODO (2026-08-13): 已从用户页面（user-order-view.tsx）隐藏，按用户反馈：
 * "为什么乱加效果图历史在用户页面"。后续 admin 端做"订单历史/恢复"功能
 * 时复用本 hook + history-drawer.tsx，不要重新写。
 *
 * 详见 [[user-page-no-complex-features]]。
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type {
  OrderHistorySnapshotView,
  RestoreHistoryResponseData,
} from "@/features/gpt-image/lib/types";

export interface UseOrderHistoryResult {
  history: OrderHistorySnapshotView[];
  loading: boolean;
  /** 当前正在恢复的快照 id（用于禁用按钮 + loading 覆盖） */
  restoringId: string | null;
  refreshHistory: () => Promise<void>;
  /** 恢复成功返回 data，失败（409/500 等）返回 null */
  restore: (id: string) => Promise<RestoreHistoryResponseData | null>;
}

interface UseOrderHistoryOptions {
  token: string;
  /** 服务端在 PENDING 时拉不到 order；不要发请求 */
  enabled: boolean;
}

/**
 * 效果图历史快照客户端 hook。
 *
 * 与 useOrder 解耦 —— useOrder 每 2s 轮询，这个不需要那么频繁。
 * 触发场景：组件 mount、order.status 变化（status 决定是否可见）、
 *           restore / regenerate / retryAll 成功后调用 refreshHistory()。
 */
export function useOrderHistory({
  token,
  enabled,
}: UseOrderHistoryOptions): UseOrderHistoryResult {
  const [history, setHistory] = useState<OrderHistorySnapshotView[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => {
    if (!enabled) {
      setHistory([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${token}/history`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(err?.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        success: boolean;
        data: OrderHistorySnapshotView[];
      };
      if (json.success) setHistory(json.data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "读取历史失败");
    } finally {
      setLoading(false);
    }
  }, [token, enabled]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const restore = useCallback(
    async (id: string): Promise<RestoreHistoryResponseData | null> => {
      if (restoringId) return null;
      setRestoringId(id);
      try {
        const res = await fetch(`/api/orders/${token}/history/${id}/restore`, {
          method: "POST",
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as {
            error?: string;
          } | null;
          const msg = err?.error ?? `HTTP ${res.status}`;
          // 409 通常是状态不允许（GENERATING/SELECTED/CANCELLED）或兼容性问题
          if (res.status === 409) {
            toast.error(msg);
          } else {
            toast.error(`恢复失败：${msg}`);
          }
          return null;
        }
        const json = (await res.json()) as {
          success: boolean;
          message?: string;
          data: RestoreHistoryResponseData;
        };
        toast.success(json.message ?? "已恢复历史版本");
        // 恢复会自动产生一条 trigger="restore" 的新快照，刷新列表
        await refreshHistory();
        return json.data;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "恢复失败");
        return null;
      } finally {
        setRestoringId(null);
      }
    },
    [token, restoringId, refreshHistory]
  );

  return { history, loading, restoringId, refreshHistory, restore };
}
