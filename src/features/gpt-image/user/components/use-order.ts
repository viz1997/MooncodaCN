"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { OrderStatus, OrderView } from "@/features/gpt-image/lib/types";

/** 需要继续轮询的状态 */
const LIVE_STATUSES = new Set<string>(["PENDING", "GENERATING"]);

const BASE_INTERVAL = 3000;
const MAX_INTERVAL = 15_000;

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

      if (typeof document !== "undefined" && document.hidden) {
        ensurePolling();
        return;
      }

      const snap = snapshotRef.current;
      if (!snap) return;
      try {
        const res = await fetch(`/api/orders/${token}/status`);
        const json = await res.json();
        if (!aliveRef.current) return;

        if (json.success) {
          delayRef.current = BASE_INTERVAL;
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
