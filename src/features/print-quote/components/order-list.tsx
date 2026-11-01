"use client";

/**
 * 「我的订单」—— 匿名订单的本地索引
 *
 * 只在**这台浏览器上**见过订单号 + 查询令牌才能查。查状态要两个都对得上,
 * 所以订单号泄露了也查不到别人的订单。
 *
 * 数据每次现查服务端 —— 本地只存「订单号 + 令牌」,不缓存报价明细,
 * 免得改了尺寸之后本地还显示着旧价。
 */

import { PackageSearch, RefreshCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { formatCents } from "@/features/print-quote/lib/format";
import {
  type LocalOrder,
  listLocalOrders,
  removeLocalOrder,
} from "@/features/print-quote/lib/local-orders";
import type { PrintOrderView } from "@/features/print-quote/lib/quote-types";

type Row = {
  local: LocalOrder;
  view: PrintOrderView | null;
  error: boolean;
};

export function OrderList() {
  const t = useTranslations("PrintQuote");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const locals = listLocalOrders();
    setRows(locals.map((local) => ({ local, view: null, error: false })));
    if (locals.length === 0) {
      setLoading(false);
      setReady(true);
      return;
    }

    setLoading(true);
    const next: Row[] = await Promise.all(
      locals.map(async (local): Promise<Row> => {
        try {
          const res = await fetch(
            `/api/print-orders/${encodeURIComponent(local.orderNo)}?token=${encodeURIComponent(local.token)}`
          );
          if (!res.ok) return { local, view: null, error: true };
          // 接口返回 `{ order: {...} }` —— 包一层是为了以后加别的字段时
          // 不用改客户端的解析。这里必须解包,不然 status / totalPriceCents
          // 全是 undefined,列表会渲染出「状态 undefined / ¥NaN」。
          const body = (await res.json()) as { order: PrintOrderView };
          if (!body?.order) return { local, view: null, error: true };
          return { local, view: body.order, error: false };
        } catch {
          return { local, view: null, error: true };
        }
      })
    );
    setRows(next);
    setLoading(false);
    setReady(true);
  }, []);

  // 只在挂载时拉一次 —— 反复轮询没必要,用户想看就点刷新
  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) return null;

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-stone-900">
          <PackageSearch className="size-4 text-stone-400" />
          {t("list.title")}
        </h3>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 px-2.5 py-1 text-xs text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
            {t("list.refresh")}
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-stone-400">{t("list.empty")}</p>
      ) : (
        <ul className="divide-y divide-stone-100">
          {rows.map((row) => (
            <li
              key={row.local.orderNo}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
            >
              <span className="font-mono text-xs font-medium text-stone-800">
                {row.local.orderNo}
              </span>

              {row.view ? (
                <>
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600">
                    {t(`status.${row.view.status}`)}
                  </span>
                  <span className="font-mono text-xs text-stone-700">
                    {formatCents(row.view.totalPriceCents)}
                  </span>
                  <span className="text-[11px] text-stone-400">
                    {new Date(row.view.createdAt).toLocaleDateString("zh-CN")}
                  </span>
                </>
              ) : (
                <span className="text-[11px] text-stone-400">
                  {loading ? t("list.loading") : t("list.failed")}
                </span>
              )}

              <button
                type="button"
                onClick={() => {
                  removeLocalOrder(row.local.orderNo);
                  setRows((prev) =>
                    prev.filter((r) => r.local.orderNo !== row.local.orderNo)
                  );
                }}
                title={t("list.remove")}
                className="ml-auto inline-flex items-center gap-1 text-[11px] text-stone-400 transition-colors hover:text-red-600"
              >
                <Trash2 className="size-3" />
                {t("list.remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
