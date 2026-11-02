"use client";

/**
 * 打印工单轮询 —— 让用户不用刷新页面就能看到工作室改了状态
 *
 * ## 为什么轮询而不是推送
 *
 * 仓库里没有 SSE / WebSocket,生图那边也是手写轮询(`use-order.ts`)。打印
 * 工单的状态变化频率极低(一天变不了几次),上一条 SSE 长连接不值得。
 *
 * ## 节奏:30s → 20s → 15s → 10s
 *
 * 比生图那边慢得多 —— 生图要盯着上游抢第一时间,打印工单没人盯着秒级变化。
 * 10s 一次已经足够「用户盯着页面看,状态一变就跳出来」。
 *
 * ## 页面藏起来 → 60s,而且**不跳过**
 *
 * 状态是**外部**写入的(工作室在另一个浏览器里改的)。切走就停轮询的话,
 * 用户切回来看到的是陈旧状态 —— 比慢一点糟糕得多。所以后台只是降频。
 *
 * ## 401 → 停
 *
 * session 没了就别打了,继续打只是浪费限流额度。
 *
 * ## 合并而不是整体替换
 *
 * 轮询响应可能在「服务端已建单、客户端还没插乐观行」之前就发出来了 ——
 * 这时候整体替换会把刚插进去的新单冲掉(闪一下又出现)。
 * 所以:服务端的单为准,**本地刚插的新单保留 2 分钟**(`LOCAL_GRACE_MS`)。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type {
  PrintOrderEventView,
  UserPrintOrder,
  UserPrintOrderDetail,
} from "@/features/print-quote/lib/quote-types";
import { isLiveStatus } from "@/features/print-quote/lib/status-machine";

/** 递减调度表(毫秒) */
const POLL_SCHEDULE_MS: readonly number[] = [30_000, 20_000, 15_000, 10_000];

/** 页面藏起来时的间隔 */
const HIDDEN_INTERVAL = 60_000;

/** 一张单都没有时的间隔(等用户在别处下了单) */
const EMPTY_INTERVAL = 60_000;

/**
 * 手上全是终态工单时的间隔
 *
 * 降频,**不停** —— 工作室随时可以回退状态,停了就会漏掉变更。
 */
const TERMINAL_INTERVAL = 60_000;

/** 本地乐观插入的行保留多久 */
const LOCAL_GRACE_MS = 2 * 60_000;

export type UsePrintOrderPollingResult = {
  /** 合并后的工单列表(按下单时间倒序) */
  orders: UserPrintOrder[];
  /** 首屏加载中 */
  loading: boolean;
  /**
   * 插入/更新一张本地新单(下单成功后乐观插入)
   *
   * 服务端下一轮拉到这张单之后,以服务端为准。
   */
  upsertOrder: (order: UserPrintOrder) => void;
  /** 立刻拉一次(手动刷新) */
  refresh: () => Promise<void>;
};

export function usePrintOrderPolling(
  initialOrders: UserPrintOrder[] = []
): UsePrintOrderPollingResult {
  const [orders, setOrders] = useState<UserPrintOrder[]>(initialOrders);
  const [loading, setLoading] = useState(initialOrders.length === 0);

  /** 服务端已知的单(权威) */
  const serverRef = useRef<Map<string, UserPrintOrder>>(
    new Map(initialOrders.map((o) => [o.orderNo, o]))
  );
  /** 本地乐观插入的单(还没被服务端确认) */
  const localRef = useRef<Map<string, { order: UserPrintOrder; at: number }>>(
    new Map()
  );
  /** 指纹 —— 没变就不 setState,免得白渲染一遍 */
  const fingerprintRef = useRef<string>("");
  const aliveRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  /** 401 之后不再轮询 */
  const stoppedRef = useRef(false);

  /** 合并服务端 + 本地乐观行 */
  const buildMerged = useCallback((): UserPrintOrder[] => {
    const now = Date.now();
    const byNo = new Map<string, UserPrintOrder>();
    for (const [orderNo, order] of serverRef.current) {
      byNo.set(orderNo, order);
    }
    for (const [orderNo, local] of localRef.current) {
      // 服务端已经有这张单 → 服务端说了算
      if (byNo.has(orderNo)) continue;
      // 超过宽限期还看不到 → 本地这行是脏的,丢掉
      if (now - local.at > LOCAL_GRACE_MS) {
        localRef.current.delete(orderNo);
        continue;
      }
      byNo.set(orderNo, local.order);
    }
    return [...byNo.values()].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
  }, []);

  /** 写入 state(指纹没变就不动) */
  const applyOrders = useCallback((next: UserPrintOrder[]) => {
    const fingerprint = next
      .map((o) => `${o.orderNo}:${o.status}:${o.updatedAt}`)
      .join("|");
    if (fingerprint === fingerprintRef.current) return;
    fingerprintRef.current = fingerprint;
    setOrders(next);
  }, []);

  /** 拉一次列表 */
  const fetchOrders = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/print-orders", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!aliveRef.current) return;

      if (res.status === 401) {
        // session 没了 —— 别再打了
        stoppedRef.current = true;
        setLoading(false);
        return;
      }
      if (!res.ok) {
        // 网络/服务端错误:保留旧数据,下一轮再试
        setLoading(false);
        return;
      }

      const body = (await res.json()) as { orders?: UserPrintOrder[] };
      const list = body.orders ?? [];

      serverRef.current = new Map(list.map((o) => [o.orderNo, o]));
      // 服务端已经有的单,本地那份不用留了
      for (const orderNo of serverRef.current.keys()) {
        localRef.current.delete(orderNo);
      }

      applyOrders(buildMerged());
      setLoading(false);
    } catch (error) {
      console.error("[PrintOrder] 轮询失败:", error);
      setLoading(false);
    }
  }, [applyOrders, buildMerged]);

  const upsertOrder = useCallback(
    (order: UserPrintOrder) => {
      localRef.current.set(order.orderNo, { order, at: Date.now() });
      applyOrders(buildMerged());
    },
    [applyOrders, buildMerged]
  );

  const refresh = useCallback(async () => {
    stoppedRef.current = false;
    attemptRef.current = 0;
    await fetchOrders();
  }, [fetchOrders]);

  // ---- 轮询主循环 ----
  useEffect(() => {
    aliveRef.current = true;
    stoppedRef.current = false;
    attemptRef.current = 0;

    const clear = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    /**
     * 下一轮隔多久
     *
     * ## 为什么「没有活着的单」是降频而不是**停轮询**
     *
     * 早先的写法是:所有单都到了终态就 `return`,不再排下一轮 —— 结果是
     * 轮询**永久停掉**。用户随后在报价台新下一单(乐观插进本地),状态就
     * 再也不会更新了:本地那行永远等不到服务端的下一轮。
     *
     * 终态单据也可能被工作室改回来(回退是允许的),所以「都终态了」只
     * 意味着**大概率**不会变,不能当成「一定不会变」。
     *
     * 降频到 60s,代价是每分钟一个请求;换来的是永远不会漏掉一次变更。
     */
    const computeDelayMs = (): number => {
      if (typeof document !== "undefined" && document.hidden) {
        return HIDDEN_INTERVAL;
      }
      const merged = buildMerged();
      // 一张单都没有 —— 可能用户在别的页面下了单,慢速盯着
      if (merged.length === 0) {
        return EMPTY_INTERVAL;
      }
      // 全是终态 —— 降频,但不停
      if (!merged.some((order) => isLiveStatus(order.status))) {
        return TERMINAL_INTERVAL;
      }
      const idx = Math.min(attemptRef.current, POLL_SCHEDULE_MS.length - 1);
      return (
        POLL_SCHEDULE_MS[idx] ??
        POLL_SCHEDULE_MS[POLL_SCHEDULE_MS.length - 1] ??
        10_000
      );
    };

    const schedule = () => {
      if (!aliveRef.current || stoppedRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(tick, computeDelayMs());
    };

    const tick = async () => {
      timerRef.current = null;
      if (!aliveRef.current || stoppedRef.current) return;

      await fetchOrders();
      if (!aliveRef.current || stoppedRef.current) return;

      // 调度推进:成功一次 +1,下次走下一档(递减)
      attemptRef.current++;
      schedule();
    };

    const onVisible = () => {
      if (document.hidden) return;
      // 回前台:立刻刷一次 —— 用户切回来就是想看最新的
      clear();
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    // 首屏:如果服务端给了初始数据,拉一次确认;否则直接拉
    void fetchOrders().then(() => {
      if (aliveRef.current) schedule();
    });

    return () => {
      aliveRef.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      clear();
    };
  }, [fetchOrders, buildMerged]);

  // ---- RSC 刷新带来的新初始数据 ----
  //
  // `router.refresh()` 会把新的 initialOrders 传下来。合并进去(只增不减)——
  // 轮询拿到的数据更权威,不能被 RSC 的旧快照盖掉。
  useEffect(() => {
    if (initialOrders.length === 0) return;
    let changed = false;
    for (const order of initialOrders) {
      const known = serverRef.current.get(order.orderNo);
      if (!known || known.updatedAt !== order.updatedAt) {
        serverRef.current.set(order.orderNo, order);
        changed = true;
      }
    }
    if (changed) applyOrders(buildMerged());
  }, [initialOrders, applyOrders, buildMerged]);

  return { orders, loading, upsertOrder, refresh };
}

// ============================================
// 详情页的轮询
// ============================================

/** 详情页的轮询间隔 —— 固定 30s */
const DETAIL_INTERVAL_MS = 30_000;

export type UsePrintOrderDetailPollingResult = {
  order: UserPrintOrderDetail;
  events: PrintOrderEventView[];
  /** 立刻拉一次(取消工单成功后用) */
  refresh: () => Promise<void>;
};

/**
 * 工单详情页的轮询
 *
 * 和列表页不同:这里要的不只是状态,还有**时间线**。所以轮询打的是
 * `GET /api/print-orders/[orderNo]`,一次把订单和时间线都拿回来 ——
 * 不用两个接口、也不用担心两者不同步。
 *
 * 节奏固定 30s:详情页是用户主动盯着看的页面,状态变化频率极低,
 * 30s 足够;再快就是白烧限流额度。
 *
 * 401 → 停(session 没了就别打了)。
 */
export function usePrintOrderDetailPolling(
  orderNo: string,
  initial: { order: UserPrintOrderDetail; events: PrintOrderEventView[] }
): UsePrintOrderDetailPollingResult {
  const [order, setOrder] = useState<UserPrintOrderDetail>(initial.order);
  const [events, setEvents] = useState<PrintOrderEventView[]>(initial.events);

  const aliveRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  /** 指纹 —— 订单 + 时间线都没变就不 setState */
  const fingerprintRef = useRef<string>("");

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        `/api/print-orders/${encodeURIComponent(orderNo)}`,
        {
          headers: { Accept: "application/json" },
          cache: "no-store",
        }
      );
      if (!aliveRef.current) return;

      if (res.status === 401) {
        stoppedRef.current = true;
        return;
      }
      if (!res.ok) return;

      const body = (await res.json()) as {
        order?: UserPrintOrderDetail;
        events?: PrintOrderEventView[];
      };
      const nextOrder = body.order;
      const nextEvents = body.events ?? [];
      if (!nextOrder) return;

      const fingerprint = `${nextOrder.orderNo}:${nextOrder.status}:${nextOrder.updatedAt}:${nextEvents.length}:${nextEvents.map((e) => e.id).join(",")}`;
      if (fingerprint === fingerprintRef.current) return;
      fingerprintRef.current = fingerprint;

      setOrder(nextOrder);
      setEvents(nextEvents);
    } catch (error) {
      console.error("[PrintOrder] 详情轮询失败:", error);
    }
  }, [orderNo]);

  useEffect(() => {
    aliveRef.current = true;
    stoppedRef.current = false;

    const clear = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const tick = async () => {
      timerRef.current = null;
      if (!aliveRef.current || stoppedRef.current) return;
      await refresh();
      if (!aliveRef.current || stoppedRef.current) return;
      timerRef.current = setTimeout(tick, DETAIL_INTERVAL_MS);
    };

    const onVisible = () => {
      if (document.hidden) return;
      clear();
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    const timer = setTimeout(tick, DETAIL_INTERVAL_MS);
    timerRef.current = timer;

    return () => {
      aliveRef.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      clear();
    };
  }, [refresh]);

  // RSC 重新渲染带来的新数据(比如 router.refresh())
  //
  // 用指纹判断「initial 是不是真的变了」:props 对象在客户端重渲染时身份
  // 通常不变,但父组件要是每次都新建一个字面量,`[initial]` 依赖就会每次
  // 都触发 —— 那会把轮询拉回来的新数据又覆盖回旧快照。
  const appliedInitialRef = useRef<string>("");
  useEffect(() => {
    const fingerprint = `${initial.order.orderNo}:${initial.order.status}:${initial.order.updatedAt}:${initial.events.length}:${initial.events.map((e) => e.id).join(",")}`;
    if (fingerprint === appliedInitialRef.current) return;
    appliedInitialRef.current = fingerprint;
    setOrder(initial.order);
    setEvents(initial.events);
  }, [initial]);

  return { order, events, refresh };
}
