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

/**
 * GENERATING 起始「安静期」：30 秒。
 *
 * 任务刚 submit 到上游时不需要立即打 /poll——上游通常需要 30-60s
 * 才有第一波回报，过早打只会增加 Lingting 负载 + 在前端多刷几帧空响应。
 *
 * 在此窗口内：
 * - useOrder 跳过 /poll（只 schedule 后续 tick，不发请求）
 * - GenerateStep 跑假进度 RAF，从 0 平滑推到 ~95% 等真实结果
 *
 * 窗口结束后恢复 BASE_INTERVAL 节奏。
 *
 * 选择 30s 而非更激进：上游 P50 ≈ 60s，30s 内的首次轮询大概率是 pending
 * 白打。低于 30s 的窗口不划算，30s 已经是性价比拐点。
 *
 * **窗口起点的"权威时钟"是服务端 `promptOrder.updatedAt`**，不是客户端
 * `Date.now()`：retryAll / regenerate / upload 都在服务端同步 submit 后
 * 写 updatedAt，客户端 refresh 拉到的 updatedAt 与服务端对齐，不受网络
 * 往返延迟影响。updatedAt 也是 ORDER_DEADLINE_MS 扫描的判据字段——复用
 * 同一字段避免两端时钟错位。
 */
const QUIET_AFTER_GENERATING_MS = 30_000;

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
  /**
   * 当前 GENERATING 窗口的「安静期结束时刻」(ms epoch)。
   * 暴露给 GenerateStep 用于对齐假进度起点：保证假进度和 /poll
   * 用同一个时间源推算，避免视觉节奏与真实轮询错位。
   * 非 GENERATING 状态返回 null。
   */
  quietEndsAt: number | null;
}

export function useOrder(token: string): UseOrderResult {
  const [order, setOrder] = useState<OrderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [quietEndsAt, setQuietEndsAt] = useState<number | null>(null);

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
        const nextStatus = data.status as OrderStatus;
        setOrder(data);
        setNotFound(false);
        snapshotRef.current = {
          status: nextStatus,
          updatedAt: data.updatedAt,
          candidateGroups: data.candidateGroups ?? 0,
          uploadedImageCount: data.uploadedImageCount ?? 0,
        };
        // 安静期结束时刻 = 服务端 updatedAt + 30s。
        // 用 updatedAt 作为权威时钟：retryAll / regenerate / upload 都在
        // 服务端同步 submit 后写 updatedAt，前端 refresh 拿到的值与服务端
        // 对齐，不受客户端网络往返延迟影响。
        // GENERATING + 30s 内 → 返回结束时刻；非 GENERATING → 清空。
        if (nextStatus === "GENERATING") {
          const updatedMs = new Date(data.updatedAt).getTime();
          if (Number.isFinite(updatedMs)) {
            setQuietEndsAt(updatedMs + QUIET_AFTER_GENERATING_MS);
          } else {
            setQuietEndsAt(null);
          }
        } else {
          setQuietEndsAt(null);
        }
      } else {
        setOrder(null);
        setNotFound(true);
        snapshotRef.current = null;
        setQuietEndsAt(null);
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

      // GENERATING 刚启 30s「安静期」：不打 /poll，只 schedule 下一 tick。
      // 上游 P50 ≈ 60s，30s 内轮询大概率拿到 pending 白打，省一次负载 + 让
      // 前端假进度完整跑一段给用户看。窗口结束后自动恢复 BASE_INTERVAL。
      //
      // 「起点」用服务端 updatedAt（= snap.updatedAt 解析出来的 ms），
      // 不依赖客户端 Date.now()：保证 retryAll / regenerate 后无论客户端
      // 何时拉到订单，静默期窗口按服务端时钟精准推进。
      if (snap.status === "GENERATING") {
        const startedMs = new Date(snap.updatedAt).getTime();
        if (
          Number.isFinite(startedMs) &&
          Date.now() - startedMs < QUIET_AFTER_GENERATING_MS
        ) {
          delayRef.current = BASE_INTERVAL;
          ensurePolling();
          return;
        }
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

  return { order, loading, notFound, refresh, quietEndsAt };
}
