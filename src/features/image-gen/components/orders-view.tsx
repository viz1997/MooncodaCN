"use client";

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
 * │ ... (无限滚动，IntersectionObserver 触发 loadMore)    │
 * │ [底部加载占位 / 已到底]            │                    │
 * └────────────────────────────────┴──────────────────┘
 * ```
 *
 * 数据流（无限滚动 + keyset cursor）：
 * - listUserOrdersAction 接收 status / search / cursor / limit
 * - 首次加载 / filter 变化 → cursor=undefined → 重置 accumulated
 * - 滑到底 → cursor=last 的 (createdAt, id) → 追加下一页
 * - 返回 nextCursor=null → 列表到底，hide observer
 * - 用 useTransition 自己拼装 accumulate / nextCursor，绕开 useAction 的「每次 execute 替换 result.data」
 *
 * 复用：
 *   - listUserOrdersAction（@/features/image-gen/actions/order.ts）
 *   - OrderDetailView + OrderStatusBadge（@/features/image-gen/components/order-detail-view）
 *   - cn + Link（@/i18n/routing）
 */

import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Search,
  ShoppingCart,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
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

/**
 * 每页拉多少条 —— 30 条够翻 4-5 屏再触发一次，避免每次都打 DB。
 */
const PAGE_SIZE = 30;

/**
 * cursor 由 action 返回 / 客户端透传给 action
 */
interface PageCursor {
  createdAt: string;
  id: string;
}

export function OrdersView({ user }: { user?: OrdersViewUser }) {
  // ========== 过滤状态 ==========
  const [statusFilter, setStatusFilter] = useState<
    OrderDetail["status"] | undefined
  >(undefined);
  const [searchInput, setSearchInput] = useState("");
  // 实际触发 server action 的 search 值（防抖 350ms）
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // ========== 数据状态 ==========
  const [orders, setOrders] = useState<OrderDetail[]>([]);
  const [nextCursor, setNextCursor] = useState<PageCursor | null>(null);
  // isFirstLoad 用于空态 / skeleton 渲染区分；后续 loadMore 用 loadingMore
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [loadingMore, startLoadMoreTransition] = useTransition();
  // 重置后第一次拉取也走 transition，但要单独区分「首次拉完首屏」
  const [isFetching, startFetchTransition] = useTransition();

  // ========== 选中状态 ==========
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // ========== 滚动观察（底部哨兵） ==========
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ========== 拉第一页 / 过滤变化时重置 ==========
  const fetchFirstPage = useCallback(
    (filter: { status: OrderDetail["status"] | undefined; search: string }) => {
      startFetchTransition(async () => {
        try {
          const res = await listUserOrdersAction({
            status: filter.status,
            search: filter.search || undefined,
            limit: PAGE_SIZE,
          });
          if (!res?.data) {
            setOrders([]);
            setNextCursor(null);
            return;
          }
          setOrders(res.data.orders);
          setNextCursor(res.data.nextCursor);
          setSelectedOrderId(null);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "加载订单失败";
          toast.error(msg);
          setOrders([]);
          setNextCursor(null);
        } finally {
          setIsFirstLoad(false);
        }
      });
    },
    []
  );

  // filter / debouncedSearch 变化 → 重置 + 拉首屏
  useEffect(() => {
    setIsFirstLoad(true);
    fetchFirstPage({ status: statusFilter, search: debouncedSearch });
  }, [fetchFirstPage, statusFilter, debouncedSearch]);

  // 搜索框输入防抖
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ========== 加载下一页 ==========
  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    startLoadMoreTransition(async () => {
      try {
        const res = await listUserOrdersAction({
          status: statusFilter,
          search: debouncedSearch || undefined,
          limit: PAGE_SIZE,
          cursor: nextCursor,
        });
        if (!res?.data) return;
        const data = res.data;
        // 追加而非替换
        setOrders((prev) => [...prev, ...data.orders]);
        setNextCursor(data.nextCursor);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "加载更多失败";
        toast.error(msg);
      }
    });
  }, [nextCursor, loadingMore, statusFilter, debouncedSearch]);

  // ========== IntersectionObserver：底部哨兵进入视口 → loadMore ==========
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    if (!nextCursor) return; // 已到底不挂 observer

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { root: container, rootMargin: "120px", threshold: 0 }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [loadMore, nextCursor]);

  // 默认选中第一条（用户未选过 + 首屏加载成功时）
  useEffect(() => {
    if (!selectedOrderId && orders.length > 0 && !isFirstLoad) {
      setSelectedOrderId(orders[0]?.orderId ?? null);
    }
  }, [selectedOrderId, orders, isFirstLoad]);

  const selectedOrder = useMemo<OrderDetail | null>(
    () => orders.find((o) => o.orderId === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  // ========== 渲染 ==========
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
              {!nextCursor && orders.length > 0 && " · 已到底"}
            </span>
            <button
              type="button"
              onClick={() => {
                setIsFirstLoad(true);
                fetchFirstPage({
                  status: statusFilter,
                  search: debouncedSearch,
                });
              }}
              className="hover:text-violet-600 flex items-center gap-0.5"
              title="刷新"
              disabled={isFetching || loadingMore}
            >
              <RefreshCw
                className={cn("h-3 w-3", isFetching && "animate-spin")}
              />
              刷新
            </button>
          </div>

          {/* 订单列表 + 滚动容器 */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto p-2 space-y-1.5"
          >
            {isFirstLoad ? (
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
              <>
                {orders.map((o) => {
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
                            {/* 2026-09-12：本单扣 X 积分（rose 小角标，对账可见） */}
                            {o.creditsCharged !== null &&
                              o.creditsCharged > 0 && (
                                <span
                                  className="inline-flex items-center px-1.5 h-4 rounded text-[9px] font-medium border bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20"
                                  title="本单实际扣减积分"
                                >
                                  -{o.creditsCharged} 积分
                                </span>
                              )}
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
                })}

                {/* 底部哨兵 + 加载占位 / 已到底提示 */}
                <div ref={sentinelRef} className="pt-1">
                  {nextCursor ? (
                    <div className="flex items-center justify-center py-3 text-[10px] text-muted-foreground">
                      <Loader2
                        className={cn(
                          "h-3 w-3 mr-1.5",
                          loadingMore ? "animate-spin" : "opacity-0"
                        )}
                      />
                      {loadingMore ? "加载中..." : "上滑加载更多"}
                    </div>
                  ) : (
                    <div className="text-center py-3 text-[10px] text-muted-foreground/70">
                      —— 已到底 ——
                    </div>
                  )}
                </div>
              </>
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
                  {isFirstLoad
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
