"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { OrderStatus, OrderView } from "@/features/gpt-image/lib/types";

/** 需要继续轮询的状态 */
const LIVE_STATUSES = new Set<string>(["PENDING", "GENERATING"]);

const BASE_INTERVAL = 3000;
const MAX_INTERVAL = 15_000;

/**
 * 后台标签降频间隔：15s。
 *
 * 切到后台标签时不再「跳过」/poll，而是降频打——只有 /poll 才是上游轮询
 * 的唯一驱动，跳过等于生成停摆。15s 是「意图」而非「保证」：Chrome 5min
 * 后会节流 timer 至约 1 次/分钟。回前台时既有 `visibilitychange` 处理
 * 立即降频回落 BASE_INTERVAL。
 */
const HIDDEN_INTERVAL = 15_000;

interface StatusSnapshot {
  status: OrderStatus;
  updatedAt: string;
  candidateGroups: number;
  uploadedImageCount: number;
}

export interface UseOrderResult {
  order: OrderView | null;
  loading: boolean;
  notFound: boolean;
  /** 强制重新拉取完整订单 */
  refresh: () => Promise<void>;
}

export function useOrder(token: string): UseOrderResult {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const snapshotRef = useRef<StatusSnapshot | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  const delayRef = useRef(BASE_INTERVAL);
  const ensurePollingRef = useRef<() => void>(() => {});

  const fetchOrder = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/orders/${token}`);
      const json = await res.json();
      if (!aliveRef.current) return;

      if (json.success) {
        const data = json.data as OrderView;
        setOrder(data);
        setNotFound(false);
        snapshotRef.current = {
          status: data.status,
          updatedAt: data.updatedAt,
          candidateGroups: data.candidateGroups ?? 0,
          uploadedImageCount: data.uploadedImageCount ?? 0,
        };
      } else {
        setOrder(null);
        setNotFound(true);
        snapshotRef.current = null;
      }
    } catch (e) {
      console.error("加载订单失败:", e);
      if (aliveRef.current && !snapshotRef.current) setNotFound(true);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    aliveRef.current = true;
    delayRef.current = BASE_INTERVAL;

    const clear = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const isLive = () => {
      const snap = snapshotRef.current;
      return !!snap && LIVE_STATUSES.has(snap.status);
    };

    const ensurePolling = () => {
      if (!aliveRef.current || timerRef.current || !isLive()) return;
      timerRef.current = setTimeout(tick, delayRef.current);
    };

    const tick = async () => {
      timerRef.current = null;
      if (!aliveRef.current || !isLive()) return;

      const snap = snapshotRef.current;
      if (!snap) return;

      // 后台标签降频：非 GENERATING 状态保持跳过（PENDING 没有要驱动的上游），
      // GENERATING 状态必须照常打 /poll——否则上游轮询停摆，订单永远卡死。
      const isHidden = typeof document !== "undefined" && document.hidden;
      if (isHidden && snap.status !== "GENERATING") {
        ensurePolling();
        return;
      }

      try {
        // GENERATING 时打 /poll：服务端只在上传时提交任务拿 task_id，
        // 真正的上游轮询由这里驱动（Serverless 跑不了长任务）。
        // 其余状态下用只读的 /status。两者返回体同构。
        const res =
          snap.status === "GENERATING"
            ? await fetch(`/api/orders/${token}/poll`, { method: "POST" })
            : await fetch(`/api/orders/${token}/status`);
        const json = await res.json();
        if (!aliveRef.current) return;

        if (json.success) {
          // 后台标签下若刚刚轮询过一圈，把节奏切到 HIDDEN_INTERVAL；
          // 回前台时 onVisible 已把 delayRef 回落到 BASE_INTERVAL。
          if (isHidden) {
            delayRef.current = HIDDEN_INTERVAL;
          } else {
            delayRef.current = BASE_INTERVAL;
          }
          const d = json.data;
          const changed =
            d.status !== snap.status ||
            d.updatedAt !== snap.updatedAt ||
            (d.candidateGroups ?? 0) !== snap.candidateGroups ||
            (d.uploadedImageCount ?? 0) !== snap.uploadedImageCount;
          if (changed) await fetchOrder();
        } else {
          delayRef.current = Math.min(delayRef.current * 2, MAX_INTERVAL);
        }
      } catch (e) {
        console.error("轮询失败:", e);
        delayRef.current = Math.min(delayRef.current * 2, MAX_INTERVAL);
      }

      ensurePolling();
    };

    ensurePollingRef.current = ensurePolling;

    const onVisible = () => {
      if (document.hidden || !isLive()) return;
      delayRef.current = BASE_INTERVAL;
      clear();
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    void fetchOrder().then(ensurePolling);

    return () => {
      aliveRef.current = false;
      ensurePollingRef.current = () => {};
      document.removeEventListener("visibilitychange", onVisible);
      clear();
    };
  }, [token, fetchOrder]);

  const refresh = useCallback(async () => {
    await fetchOrder();
    delayRef.current = BASE_INTERVAL;
    ensurePollingRef.current();
  }, [fetchOrder]);

  return { order, loading, notFound, refresh };
}
