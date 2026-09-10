/**
 * /image-gen/orders 独立页面主体 —— 客户端双栏（列表 + 详情）
 *
 * 2026-09-10：从 /image-gen 顶栏 Link(/image-gen/orders) 跳进来。布局：
 *
 * ```
 * ┌─ 顶部 56px ─────────────────────────────────────────┐
 * │ AI 生图 · 我的订单                       [用户头像]   │
 * ├─ 380px 列表 ────────────────────┬─ flex-1 详情 ─────┤
 * │ [搜索框]                          │ OrderDetailView    │
 * │ [全部] [待处理] [生成中] ...       │ (空态：无选中订单) │
 * │ ┌─ 订单卡 1 ─┐                    │                    │
 * │ ┌─ 订单卡 2 ─┐ (选中高亮)         │                    │
 * │ ┌─ 订单卡 3 ─┐                    │                    │
 * │ ...                              │                    │
 * └────────────────────────────────┴──────────────────┘
 * ```
 *
 * 状态：
 * - status filter chips（点全部 / 待处理 / 生成中 / 候选就绪 / 已下单 / 已取消 / 失败）
 * - 搜索框：模糊匹配 orderNo + 模板名（listUserOrdersAction 服务端搜索）
 * - selectedOrderId：点列表项 → 右侧显示 OrderDetailView；点空白 / 顶栏「列表」按钮取消
 * - 数据：useAction 调 listUserOrdersAction，参数变化时 refetch
 *
 * 复用：
 *   - listUserOrdersAction（@/features/image-gen/actions/order.ts）
 *   - OrderDetailView + OrderStatusBadge（@/features/image-gen/components/order-detail-view）
 *   - cn + Link（@/i18n/routing）
 */

"use client";

import { ArrowLeft, RefreshCw, Search, ShoppingCart, X } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { listUserOrdersAction } from "@/features/image-gen/actions/order";
import {
  type OrderDetail,
  OrderDetailView,
  OrderStatusBadge,
} from "@/features/image-gen/components/order-detail-view";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * 2026-09-10：登录用户信息（从 page.tsx RSC 透传）。顶栏渲染头像首字母。
 * 不传则降级到登录入口（兼容单元测试）。
 */
export interface OrdersViewUser {
  id: string;
  name: string | null;
  email: string | null;
}

/**
 * 状态过滤 chip 的可选项
 */
const STATUS_FILTERS = [
  { value: undefined, label: "全部" },
  { value: "PENDING", label: "待处理" },
  { value: "GENERATING", label: "生成中" },
  { value: "CANDIDATES_READY", label: "候选就绪" },
  { value: "SELECTED", label: "已下单" },
  { value: "CANCELLED", label: "已取消" },
  { value: "FAILED", label: "失败" },
] as const;

export function OrdersView({ user }: { user?: OrdersViewUser }) {
  // ========== 过滤状态 ==========
  const [statusFilter, setStatusFilter] = useState<
    OrderDetail["status"] | undefined
  >(undefined);
  const [searchInput, setSearchInput] = useState("");
  // 实际触发 server action 的 search 值（防抖 350ms）
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // ========== 数据拉取 ==========
  const { execute, result, status, isExecuting } = useAction(
    listUserOrdersAction,
    {
      onError: (err) => {
        toast.error(err.error.serverError ?? "加载订单失败");
      },
    }
  );

  // 初次加载 + statusFilter / debouncedSearch 变化时 refetch
  useEffect(() => {
    void execute({
      status: statusFilter,
      search: debouncedSearch || undefined,
      limit: 50,
    });
  }, [execute, statusFilter, debouncedSearch]);

  // 搜索框输入防抖
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const orders = result.data?.orders ?? [];
  const loading = status === "executing" && orders.length === 0;
  const refreshing = isExecuting && orders.length > 0;

  // 默认选中第一条（仅在加载完成且用户没主动选过）
  useEffect(() => {
    if (!selectedOrderId && orders.length > 0 && status === "hasSucceeded") {
      setSelectedOrderId(orders[0]?.orderId ?? null);
    }
  }, [selectedOrderId, orders, status]);

  const selectedOrder = useMemo<OrderDetail | null>(
    () => orders.find((o) => o.orderId === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  // ============================================
  // 渲染
  // ============================================

  return (
    <div className="h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 overflow-hidden">
      {/* 顶栏 */}
      <header className="h-14 shrink-0 bg-white dark:bg-zinc-900 border-b flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Link
            href="/image-gen"
            className="text-muted-foreground hover:text-violet-600 p-1.5 rounded-md hover:bg-violet-500/5 transition-colors"
            title="返回 AI 生图"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white">
            <ShoppingCart className="h-3.5 w-3.5" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="font-bold text-sm">我的订单</span>
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              · AI 生图订单
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <div
              className="flex items-center gap-2"
              title={user.email ?? user.name ?? user.id}
            >
              <div className="h-7 w-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-semibold">
                {(user.name ?? user.email ?? user.id).slice(0, 1).toUpperCase()}
              </div>
              <span className="text-xs font-medium hidden md:inline max-w-[120px] truncate">
                {user.name ?? user.email ?? "用户"}
              </span>
            </div>
          ) : (
            <Link
              href="/sign-in?callbackUrl=/image-gen/orders"
              className="text-xs px-3 py-1 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 transition-colors"
            >
              登录
            </Link>
          )}
        </div>
      </header>

      {/* 主体：左 380px 列表 + 右 flex-1 详情 */}
      <div className="flex-1 flex overflow-hidden">
        {/* ============ 左：搜索 + 状态过滤 + 订单列表 ============ */}
        <aside className="w-[380px] shrink-0 bg-white dark:bg-zinc-900 border-r flex flex-col overflow-hidden">
          {/* 搜索框 */}
          <div className="shrink-0 p-3 border-b space-y-2.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="搜索订单号 / 模板名"
                className={cn(
                  "w-full h-9 pl-8 pr-8 text-sm rounded-md border bg-background",
                  "focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500",
                  "placeholder:text-muted-foreground"
                )}
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-full text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10"
                  title="清空"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* 状态过滤 chips */}
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((f) => {
                const active = statusFilter === f.value;
                return (
                  <button
                    type="button"
                    key={f.label}
                    onClick={() => setStatusFilter(f.value)}
                    className={cn(
                      "px-2.5 h-6 rounded-full text-[11px] font-medium border transition-colors",
                      active
                        ? "bg-violet-500 text-white border-violet-500"
                        : "bg-background text-muted-foreground hover:text-violet-600 hover:border-violet-500/40"
                    )}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 列表头 */}
          <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b text-[10px] text-muted-foreground">
            <span>
              {orders.length} 条
              {(statusFilter || debouncedSearch) && "（已过滤）"}
            </span>
            <button
              type="button"
              onClick={() =>
                void execute({
                  status: statusFilter,
                  search: debouncedSearch || undefined,
                  limit: 50,
                })
              }
              className="hover:text-violet-600 flex items-center gap-0.5"
              title="刷新"
              disabled={refreshing}
            >
              <RefreshCw
                className={cn("h-3 w-3", refreshing && "animate-spin")}
              />
              刷新
            </button>
          </div>

          {/* 订单列表 */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {loading ? (
              <>
                {[
                  "o-skel-0",
                  "o-skel-1",
                  "o-skel-2",
                  "o-skel-3",
                  "o-skel-4",
                ].map((k) => (
                  <div
                    key={k}
                    className="h-20 rounded-lg bg-muted animate-pulse"
                  />
                ))}
              </>
            ) : orders.length === 0 ? (
              <div className="text-center text-muted-foreground py-12 space-y-2">
                <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mx-auto">
                  <ShoppingCart className="h-5 w-5 opacity-30" />
                </div>
                <p className="text-xs">
                  {debouncedSearch || statusFilter
                    ? "没有符合条件的订单"
                    : "还没有订单"}
                </p>
                <p className="text-[10px]">
                  {debouncedSearch || statusFilter
                    ? "试试调整搜索词或清除筛选"
                    : "去 /image-gen 选效果 + 上传参考图 + 生成后下单"}
                </p>
                {!debouncedSearch && !statusFilter && (
                  <Button
                    asChild={false}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      window.location.href = "/image-gen";
                    }}
                    className="mt-2"
                  >
                    去生图
                  </Button>
                )}
              </div>
            ) : (
              orders.map((o) => {
                const active = selectedOrderId === o.orderId;
                return (
                  <button
                    type="button"
                    key={o.orderId}
                    onClick={() => setSelectedOrderId(o.orderId)}
                    className={cn(
                      "w-full text-left rounded-lg border bg-card transition-all overflow-hidden group",
                      active
                        ? "border-violet-500 ring-1 ring-violet-500/30 shadow-sm"
                        : "hover:border-violet-500/50 hover:shadow-md"
                    )}
                  >
                    <div className="flex gap-2.5 p-2">
                      {/* 缩略图 */}
                      <div className="shrink-0 h-16 w-16 rounded-md overflow-hidden bg-muted">
                        {o.thumbnailUrl ? (
                          // biome-ignore lint/performance/noImgElement: 订单缩略图为远程 URL
                          <img
                            src={o.thumbnailUrl}
                            alt={o.templateName}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                            <Search className="h-4 w-4 opacity-30" />
                          </div>
                        )}
                      </div>
                      {/* 信息 */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-mono text-muted-foreground truncate">
                            {o.orderNo}
                          </span>
                          <OrderStatusBadge status={o.status} />
                        </div>
                        <p
                          className={cn(
                            "text-xs font-medium truncate",
                            active
                              ? "text-violet-700 dark:text-violet-300"
                              : "group-hover:text-violet-600"
                          )}
                        >
                          {o.templateName}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(o.createdAt).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {o.productSize && ` · ${o.productSize}cm`}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ============ 右：详情（同页 inline） ============ */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {selectedOrder ? (
            <OrderDetailView order={selectedOrder} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center space-y-3">
                <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mx-auto">
                  <ShoppingCart className="h-7 w-7 opacity-30" />
                </div>
                <p className="text-sm">
                  {loading
                    ? "加载中..."
                    : orders.length === 0
                      ? "暂无订单"
                      : "选中左侧订单查看详情"}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
