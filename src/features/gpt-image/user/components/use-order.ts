"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { OrderStatus, OrderView } from "@/features/gpt-image/lib/types";

/** 需要继续轮询的状态 */
const LIVE_STATUSES = new Set<string>(["PENDING", "GENERATING"]);

/**
 * 递减轮询调度表（毫秒）。
 *
 * 与传统的「固定间隔 + 错误指数退避」相反——这里我们**主动递减**：
 * 首次长间隔（cold start 省负载），越往后越短（接近完成时高响应）。
 *
 * 为什么反向递减：Lingting P50 ≈ 60s、P99 ≈ 180s。早期待机期间（前 30s）
 * 调任务大概率 pending——花请求打 8 次都 pending 不如慢点等；
 * 接近完成时任务随时可能 done——必须高频轮询抢第一时间拿到结果。
 *
 * 旧的 BASE_INTERVAL=3s 固定间隔会前 30s 浪费 8-10 次 /poll；
 * 旧的 30s 安静期一刀切又太保守——快任务早 25s 拿不到结果。
 *
 * 选 [15, 12, 10, 8, 6, 5, 4, 3] 而非更激进的递减：
 * - 起步 15s 留足 Lingting cold start（wellapi.ai 边缘节点首次回源 ~1-3s）
 * - 8 档刚好覆盖 P50 60s 区间（15+12+10+8+6+5+4+3 = 63s ≈ P50）
 * - 末档 3s 与 BASE_INTERVAL 旧值对齐，P99 极端长任务仍高频
 * - 单订单 ~10 次 /poll（vs 旧 30+ 次），Lingting 负载 -70%
 */
const POLL_SCHEDULE_MS: readonly number[] = [
  15_000, 12_000, 10_000, 8_000, 6_000, 5_000, 4_000, 3_000,
];

/**
 * 后台标签降频间隔：30s。
 *
 * 切到后台标签时不再「跳过」/poll，而是降频打——只有 /poll 才是上游轮询
 * 的唯一驱动，跳过等于生成停摆。30s 是「意图」而非「保证」：Chrome 5min
 * 后会节流 timer 至约 1 次/分钟。回前台时既有 `visibilitychange` 处理
 * 立即重置 attempt 走完整调度表。
 */
const HIDDEN_INTERVAL = 30_000;

/**
 * GENERATING 起始「首轮延迟」：15 秒。
 *
 * 与 useOrder 的 POLL_SCHEDULE_MS[0] 同值——必须保持一致，
 * 否则假进度节奏会和 /poll 跳过窗口错位。镜像写一份避免引入跨模块
 * 常量依赖（generate-step 不应反向依赖 use-order 的内部常量）。
 *
 * 此处仅用于把假进度起点对齐到首轮查询起点（= quietEndsAt - 15s），
 * 保证用户中途切页 / 刷新后进度从一致位置继续。
 */
const QUIET_AFTER_GENERATING_MS = 15_000;

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
   * 当前 GENERATING 窗口的「首轮真实查询时刻」(ms epoch)。
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
  /** 当前已完成的轮询次数；下次延迟 = POLL_SCHEDULE_MS[attempt] */
  const attemptRef = useRef(0);
  const ensurePollingRef = useRef<() => void>(() => {});

  /** 下次 tick 的延迟 = POLL_SCHEDULE_MS[attempt]（末档后保持不变） */
  function getNextDelayMs(): number {
    const idx = Math.min(attemptRef.current, POLL_SCHEDULE_MS.length - 1);
    return (
      POLL_SCHEDULE_MS[idx] ?? POLL_SCHEDULE_MS[POLL_SCHEDULE_MS.length - 1]!
    );
  }

  const fetchOrder = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`/api/orders/${token}`);
      const json = await res.json();
      if (!aliveRef.current) return;

      if (json.success) {
        const data = json.data as OrderView;
        const nextStatus = data.status as OrderStatus;
        const prevStatus = snapshotRef.current?.status;
        setOrder(data);
        setNotFound(false);
        snapshotRef.current = {
          status: nextStatus,
          updatedAt: data.updatedAt,
          candidateGroups: data.candidateGroups ?? 0,
          uploadedImageCount: data.uploadedImageCount ?? 0,
        };
        // 进入 GENERATING（首次 / regenerate / upload）→ 重置 attempt 走
        // 完整调度表。已在 GENERATING 中（轮询拉到进度但状态未变）保持
        // attempt 继续推进。同状态重置会让调度倒回到 15s 起步，破坏节奏。
        if (nextStatus === "GENERATING" && prevStatus !== "GENERATING") {
          attemptRef.current = 0;
        }
        // 首轮真实查询时刻 = 服务端 updatedAt + 15s。
        // 用 updatedAt 作为权威时钟：retryAll / regenerate / upload 都在
        // 服务端同步 submit 后写 updatedAt，前端 refresh 拿到的值与服务端
        // 对齐，不受客户端网络往返延迟影响。
        // GENERATING → 返回首轮时刻；非 GENERATING → 清空。
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
    attemptRef.current = 0;

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

    /**
     * 「下次延迟」按场景选：
     * - 后台标签 → 30s 降频（vs schedule 末档 3s）
     * - 前台 → POLL_SCHEDULE_MS[attempt] 递减
     */
    const computeDelayMs = (): number => {
      if (typeof document !== "undefined" && document.hidden) {
        return HIDDEN_INTERVAL;
      }
      return getNextDelayMs();
    };

    const ensurePolling = () => {
      if (!aliveRef.current || timerRef.current || !isLive()) return;
      timerRef.current = setTimeout(tick, computeDelayMs());
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
          // 调度推进：成功一次 +1，下次延迟走下一档（递减）
          attemptRef.current++;
          const d = json.data;
          const changed =
            d.status !== snap.status ||
            d.updatedAt !== snap.updatedAt ||
            (d.candidateGroups ?? 0) !== snap.candidateGroups ||
            (d.uploadedImageCount ?? 0) !== snap.uploadedImageCount;
          if (changed) await fetchOrder();
        }
        // 失败（json.success=false）：保持 attempt 不变——错误不进位，
        // 下次按原档位重试。错误退避会让 attempt 倒回旧档、浪费调度意义，
        // 这里干脆不变：旧 attempt 已是最快档（末档 3s）也没法更快了。
      } catch (e) {
        console.error("轮询失败:", e);
        // 同上：网络异常保持 attempt 不变。
      }

      ensurePolling();
    };

    ensurePollingRef.current = ensurePolling;

    const onVisible = () => {
      if (document.hidden || !isLive()) return;
      // 回前台：重置 attempt 走完整调度表，让用户切回时看到节奏。
      // 不重置会让 attempt 卡在后台期间的位置，切回瞬间还是慢档。
      attemptRef.current = 0;
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
    attemptRef.current = 0;
    ensurePollingRef.current();
  }, [fetchOrder]);

  return { order, loading, notFound, refresh, quietEndsAt };
}
