"use client";

/**
 * 商城订单详情页的轮询 —— 让用户不用刷新页面就能看到工作室发货了
 *
 * ## 为什么轮询
 *
 * 工作室在后台「发货台」填了运单号,是**外部写入** —— 买家这边订单状态在
 * 填单号那一刻**一个字都没变**。不轮询的话,买家盯着「还没发货」看到
 * 手动刷新为止。
 *
 * ## 节奏固定 30s
 *
 * 跟打印工单详情页一样(见 `use-print-order-polling.ts`)。物流状态一天变
 * 不了几次,再快就是白烧限流额度。
 *
 * ## 401 → 停
 *
 * session 没了就别打了,继续打只是浪费限流额度。
 *
 * ## 指纹里**必须**带物流
 *
 * 工作室填了单号 ⇒ 订单状态没变 ⇒ 轮询回来的数据跟上一轮**完全一样**
 * ⇒ 不 setState ⇒ 页面停在「还没发货」。这就是 `shipmentFingerprint()`
 * 存在的理由。
 *
 * ## 轮询打的是现成的扁平接口
 *
 * `GET /api/store/orders/[orderNo]`(2026-11-13 加了 `shipments` 字段,
 * **只涨不破**)。**不新开接口** —— 那个接口已经有 4 处以上在用,再加一个
 * 平行接口就是两份口径。
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { shipmentFingerprint } from "@/features/shipment/lib/fingerprint";
import type { ShipmentView } from "@/features/shipment/lib/types";
import type {
  StoreOrderPaymentSnapshot,
  StoreOrderPaymentStatus,
  StoreOrderStatus,
} from "@/features/storefront/lib/order-detail-types";

/** 详情页的轮询间隔 —— 固定 30s */
const DETAIL_INTERVAL_MS = 30_000;

export type UseStoreOrderPollingResult = {
  /** 物流 —— 一个订单可能有多个包裹 */
  shipments: ShipmentView[];
  /** 轮询回来的状态快照(商品行和金额不会变,不在里面) */
  snapshot: StoreOrderPaymentSnapshot;
  /** 立刻拉一次 */
  refresh: () => Promise<void>;
};

/** 那个扁平接口的响应形状(只列我们用到的字段) */
type StoreOrderApiResponse = {
  status?: StoreOrderStatus;
  paymentStatus?: StoreOrderPaymentStatus;
  paymentUrl?: string | null;
  paymentQrCodeUrl?: string | null;
  shipments?: ShipmentView[];
};

/**
 * 状态快照的指纹 —— **两个指纹都必须带物流**
 *
 * 少了物流这一段,工作室填了单号之后买家页面就不会自己更新。
 */
function snapshotFingerprint(
  snapshot: StoreOrderPaymentSnapshot,
  shipments: ShipmentView[]
): string {
  return [
    snapshot.status,
    snapshot.paymentStatus,
    snapshot.paymentUrl ?? "",
    snapshot.paymentQrCodeUrl ?? "",
    shipmentFingerprint(shipments),
  ].join("|");
}

/**
 * 商城订单详情页的轮询
 *
 * 401 → 停(session 没了就别打了)。
 */
export function useStoreOrderPolling(
  orderNo: string,
  initial: {
    shipments: ShipmentView[];
    snapshot: StoreOrderPaymentSnapshot;
  }
): UseStoreOrderPollingResult {
  const [shipments, setShipments] = useState<ShipmentView[]>(initial.shipments);
  const [snapshot, setSnapshot] = useState<StoreOrderPaymentSnapshot>(
    initial.snapshot
  );

  const aliveRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  /** 指纹 —— 状态和物流都没变就不 setState */
  const fingerprintRef = useRef<string>("");
  /**
   * 当前状态快照的**引用**
   *
   * `refresh` 只依赖 `orderNo` —— 如果它依赖 `initial.snapshot`,父组件
   * 每次渲染都新建一个字面量 ⇒ `refresh` 身份每次都变 ⇒ 轮询那个 effect
   * 每次渲染都拆了重建 ⇒ 计时器永远从头开始,**30s 一轮变成永不触发**。
   */
  const snapshotRef = useRef<StoreOrderPaymentSnapshot>(initial.snapshot);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(
        `/api/store/orders/${encodeURIComponent(orderNo)}`,
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

      const body = (await res.json()) as StoreOrderApiResponse;
      const nextShipments = body.shipments ?? [];
      const nextSnapshot: StoreOrderPaymentSnapshot = {
        status: body.status ?? snapshotRef.current.status,
        paymentStatus: body.paymentStatus ?? snapshotRef.current.paymentStatus,
        paymentUrl: body.paymentUrl ?? null,
        paymentQrCodeUrl: body.paymentQrCodeUrl ?? null,
      };

      const fingerprint = snapshotFingerprint(nextSnapshot, nextShipments);
      if (fingerprint === fingerprintRef.current) return;
      fingerprintRef.current = fingerprint;

      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setShipments(nextShipments);
    } catch (error) {
      console.error("[StoreOrder] 详情轮询失败:", error);
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
      // 回前台:立刻刷一次 —— 用户切回来就是想看最新的
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

  /**
   * RSC 重新渲染带来的新数据(比如 `router.refresh()`)
   *
   * 用指纹判断「initial 是不是真的变了」:props 对象在客户端重渲染时身份
   * 通常不变,但父组件要是每次都新建一个字面量,`[initial]` 依赖就会每次
   * 都触发 —— 那会把轮询拉回来的新数据又覆盖回旧快照。
   */
  const appliedInitialRef = useRef<string>("");
  useEffect(() => {
    const fingerprint = snapshotFingerprint(
      initial.snapshot,
      initial.shipments
    );
    if (fingerprint === appliedInitialRef.current) return;
    appliedInitialRef.current = fingerprint;
    snapshotRef.current = initial.snapshot;
    setSnapshot(initial.snapshot);
    setShipments(initial.shipments);
  }, [initial]);

  return { shipments, snapshot, refresh };
}
