"use client";

/**
 * /admin/orders 全局订单管理 —— 主视图（2026-09-18）
 *
 * 布局（沿用 antd）：
 * ```
 * ┌─ 页面标题 + subtitle ──────────────────────────┐
 * ├─ 过滤条 [Status] [Platform] [CreatedBy] [dateRange] [Search box] [Reset]
 * ├─ 表格 ─────────────────────────────────────────┤
 * │   orderNo | template | createdBy | platform | platformOrderNo
 * │   | status | credits | remarks | createdAt | cancelledAt | actions |
 * │   ...
 * │   (底部 IntersectionObserver 哨兵 → loadMore)
 * └─ 「加载更多」/「—— 已到底 ——」/空态 ──────────┘
 * 模态：
 *   <AdminOrderDetailModal />：点击「查看详情」→ OrderDetailView + footer 3 按钮
 *   <OrderRemarksDialog />：点击「编辑备注」→ 输入框 → adminUpdateRemarksAction
 *   <CancelConfirmDialog />：点击「取消订单」→ 危险确认 → adminCancelOrderAction
 * ```
 *
 * 数据流（keyset cursor 无限滚动 + admin 全局视角）：
 * - adminListAllOrdersAction({ status?, platform?, createdBy?, search?, dateFrom?, dateTo?, cursor?, limit })
 * - filter / search 变化 → cursor=undefined → 重置 accumulated
 * - 滑到底 → cursor=last (createdAt, id) → 追加下一页
 * - 返回 nextCursor=null → 列表到底，hide observer
 * - 用 useTransition 自己拼装 accumulate / nextCursor，绕开 useAction 的 result.data 替换
 *
 * 复用：
 *   - adminListAllOrdersAction（@/features/admin/orders/actions.ts）
 *   - adminCancelOrderAction / adminUpdateRemarksAction（同上）
 *   - getAllUsersAction（@/features/support/actions/admin-users.ts，CreatedBy select 数据源）
 *   - OrderDetailView（@/features/image-gen/components/order-detail-view）
 *   - PLATFORMS / PlatformCode（@/features/gpt-image/lib/product-catalog）
 *
 * 鉴权：
 *   - 页面 mount 时 layout 已 checkAdmin() 拦截
 *   - server actions 走 adminAction 包装，role !== 'admin' 抛错
 */

import {
  App,
  Badge,
  Button,
  DatePicker,
  Empty,
  Input,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs, { type Dayjs } from "dayjs";
import {
  Ban,
  Eye,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  adminCancelOrderAction,
  adminListAllOrdersAction,
  adminUpdateRemarksAction,
} from "@/features/admin/orders/actions";
import type { AdminOrderRow } from "@/features/admin/orders/types";
import { getAllUsersAction } from "@/features/support/actions";

import { AdminOrderDetailModal } from "./AdminOrderDetailModal";
import { CancelConfirmDialog } from "./CancelConfirmDialog";
import { OrderRemarksDialog } from "./OrderRemarksDialog";

const { RangePicker } = DatePicker;

const PAGE_SIZE = 30;

/** 后端 ORDER_STATUS 6 项 */
const ORDER_STATUS_VALUES = [
  "PENDING",
  "GENERATING",
  "CANDIDATES_READY",
  "SELECTED",
  "CANCELLED",
  "FAILED",
] as const;
type OrderStatusKey = (typeof ORDER_STATUS_VALUES)[number];

/** PLATFORMS 字典的 code（与服务端 zod enum 对齐） */
const PLATFORM_CODES = [
  "taobao",
  "xiaohongshu",
  "douyin",
  "independent_site",
  "domestic_influencer",
  "foreign_influencer",
  "partner",
  "marketing",
] as const;
type PlatformKey = (typeof PLATFORM_CODES)[number];

/** Keyset cursor（与服务端 AdminOrderCursor 对齐） */
interface PageCursor {
  createdAt: string;
  id: string;
}

/** getAllUsersAction 返回的最小字段（admin CreatedBy Select 数据源） */
interface AdminUserOption {
  id: string;
  name: string;
  email: string;
}

export function AdminOrdersView() {
  const t = useTranslations("AdminOrders");
  const { message } = App.useApp();

  // ========== 过滤状态 ==========
  const [statusFilter, setStatusFilter] = useState<OrderStatusKey | null>(null);
  const [platformFilter, setPlatformFilter] = useState<PlatformKey | null>(
    null
  );
  const [createdByFilter, setCreatedByFilter] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<
    [Dayjs | null, Dayjs | null] | null
  >(null);
  const [searchInput, setSearchInput] = useState("");
  // 防抖搜索值（350ms 后才触发 reload），参考 OrdersView
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // ========== 数据状态 ==========
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [nextCursor, setNextCursor] = useState<PageCursor | null>(null);
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [loadingMore, startLoadMoreTransition] = useTransition();
  const [isFetching, startFetchTransition] = useTransition();

  // ========== CreatedBy Select 数据源 ==========
  const [userOptions, setUserOptions] = useState<AdminUserOption[]>([]);

  // ========== 详情 / 操作 Modal 状态 ==========
  const [detailOrder, setDetailOrder] = useState<AdminOrderRow | null>(null);
  const [remarksOrder, setRemarksOrder] = useState<AdminOrderRow | null>(null);
  const [cancelOrder, setCancelOrder] = useState<AdminOrderRow | null>(null);

  // ========== 滚动容器 + 哨兵 ==========
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ========== 加载 CreatedBy 下拉数据 ==========
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getAllUsersAction(undefined);
        if (cancelled) return;
        const users = res?.data?.users ?? [];
        setUserOptions(
          users.map((u) => ({
            id: u.id,
            name: u.name ?? "",
            email: u.email ?? "",
          }))
        );
      } catch (err) {
        // 用户列表加载失败 → CreatedBy select 留空（不影响其他筛选）
        console.error("load users for createdBy filter failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ========== 搜索防抖 ==========
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ========== 拉首屏 ==========
  const fetchFirstPage = useCallback(
    (params: {
      status: OrderStatusKey | null;
      platform: PlatformKey | null;
      createdBy: string | null;
      search: string;
      dateFrom: string | undefined;
      dateTo: string | undefined;
    }) => {
      startFetchTransition(async () => {
        try {
          const res = await adminListAllOrdersAction({
            ...(params.status ? { status: params.status } : {}),
            ...(params.platform ? { platform: params.platform } : {}),
            ...(params.createdBy ? { createdBy: params.createdBy } : {}),
            ...(params.search ? { search: params.search } : {}),
            ...(params.dateFrom ? { dateFrom: params.dateFrom } : {}),
            ...(params.dateTo ? { dateTo: params.dateTo } : {}),
            limit: PAGE_SIZE,
            cursor: null,
          });
          if (!res?.data) {
            setOrders([]);
            setNextCursor(null);
            return;
          }
          setOrders(res.data.rows);
          setNextCursor(res.data.nextCursor);
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : t("messages.loadFailed");
          message.error(msg);
          setOrders([]);
          setNextCursor(null);
        } finally {
          setIsFirstLoad(false);
        }
      });
    },
    [message, t]
  );

  // ========== filter / search 变化 → 重置 ==========
  useEffect(() => {
    setIsFirstLoad(true);
    const [from, to] = dateRange ?? [null, null];
    fetchFirstPage({
      status: statusFilter,
      platform: platformFilter,
      createdBy: createdByFilter,
      search: debouncedSearch,
      dateFrom: from ? from.startOf("day").toISOString() : undefined,
      dateTo: to ? to.endOf("day").toISOString() : undefined,
    });
  }, [
    fetchFirstPage,
    statusFilter,
    platformFilter,
    createdByFilter,
    debouncedSearch,
    dateRange,
  ]);

  // ========== loadMore ==========
  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    startLoadMoreTransition(async () => {
      try {
        const [from, to] = dateRange ?? [null, null];
        const res = await adminListAllOrdersAction({
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(platformFilter ? { platform: platformFilter } : {}),
          ...(createdByFilter ? { createdBy: createdByFilter } : {}),
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(from ? { dateFrom: from.startOf("day").toISOString() } : {}),
          ...(to ? { dateTo: to.endOf("day").toISOString() } : {}),
          limit: PAGE_SIZE,
          cursor: nextCursor,
        });
        if (!res?.data) return;
        const data = res.data;
        setOrders((prev) => [...prev, ...data.rows]);
        setNextCursor(data.nextCursor);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : t("messages.loadFailed");
        message.error(msg);
      }
    });
  }, [
    nextCursor,
    loadingMore,
    statusFilter,
    platformFilter,
    createdByFilter,
    debouncedSearch,
    dateRange,
    message,
    t,
  ]);

  // ========== IntersectionObserver ==========
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = tableContainerRef.current;
    if (!sentinel || !container || !nextCursor) return;

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

  // ========== 重置筛选 ==========
  const handleResetFilters = useCallback(() => {
    setStatusFilter(null);
    setPlatformFilter(null);
    setCreatedByFilter(null);
    setDateRange(null);
    setSearchInput("");
    setDebouncedSearch("");
  }, []);

  // ========== 详情 modal 操作 ==========
  const handleCancelFromDetail = useCallback(
    (orderId: string) => {
      const o = orders.find((x) => x.orderId === orderId) ?? null;
      setDetailOrder(null);
      setCancelOrder(o);
    },
    [orders]
  );

  const handleEditRemarksFromDetail = useCallback(
    (orderId: string) => {
      const o = orders.find((x) => x.orderId === orderId) ?? null;
      setDetailOrder(null);
      setRemarksOrder(o);
    },
    [orders]
  );

  // ========== 取消确认 → adminCancelOrderAction ==========
  const handleConfirmCancel = useCallback(
    async (reason: string | null) => {
      if (!cancelOrder) return;
      try {
        const res = await adminCancelOrderAction({
          orderId: cancelOrder.orderId,
          reason: reason ?? undefined,
        });
        if (res?.data) {
          const refunded = res.data.refundedCredits;
          message.success(
            refunded > 0
              ? t("messages.cancelSuccess", { credits: refunded })
              : t("messages.cancelSuccessNoRefund")
          );
          // 局部刷新该订单状态（避免整页重拉）
          setOrders((prev) =>
            prev.map((o) =>
              o.orderId === cancelOrder.orderId
                ? {
                    ...o,
                    status: "CANCELLED" as const,
                    cancelledAt: new Date().toISOString(),
                  }
                : o
            )
          );
          setCancelOrder(null);
        } else if (res?.serverError) {
          message.error(t("messages.cancelFailed", { error: res.serverError }));
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : t("messages.cancelFailed", {
                error: "Unknown",
              });
        message.error(msg);
      }
    },
    [cancelOrder, message, t]
  );

  // ========== 改备注 → adminUpdateRemarksAction ==========
  const handleSaveRemarks = useCallback(
    async (remarks: string | null) => {
      if (!remarksOrder) return;
      try {
        const res = await adminUpdateRemarksAction({
          orderId: remarksOrder.orderId,
          remarks,
        });
        if (res?.data) {
          const data = res.data;
          message.success(
            data.remarks
              ? t("messages.remarksUpdated")
              : t("messages.remarksCleared")
          );
          setOrders((prev) =>
            prev.map((o) =>
              o.orderId === remarksOrder.orderId
                ? { ...o, remarks: data.remarks }
                : o
            )
          );
          setRemarksOrder(null);
        } else if (res?.serverError) {
          message.error(
            t("messages.remarksFailed", { error: res.serverError })
          );
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : t("messages.remarksFailed", {
                error: "Unknown",
              });
        message.error(msg);
      }
    },
    [remarksOrder, message, t]
  );

  // ========== 表格列 ==========
  const columns: ColumnsType<AdminOrderRow> = useMemo(
    () => [
      {
        title: t("table.orderNo"),
        dataIndex: "orderNo",
        key: "orderNo",
        width: 140,
        fixed: "left",
        render: (no: string) => <span className="font-mono text-xs">{no}</span>,
      },
      {
        title: t("table.templateName"),
        dataIndex: "templateName",
        key: "templateName",
        width: 160,
        render: (name: string, record) => (
          <div className="space-y-0.5">
            <div className="text-sm font-medium truncate">{name}</div>
            {record.productSize && (
              <div className="text-[10px] text-muted-foreground">
                {record.productSize}cm
              </div>
            )}
          </div>
        ),
      },
      {
        title: t("table.createdBy"),
        key: "createdBy",
        width: 160,
        render: (_: unknown, record) => (
          <div className="space-y-0.5">
            <div className="text-xs font-medium truncate">
              {record.createdByName}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {record.createdByEmail}
            </div>
          </div>
        ),
      },
      {
        title: t("table.platform"),
        key: "platform",
        width: 100,
        render: (_: unknown, record) =>
          record.platform ? (
            <Tag color="blue" className="!text-[10px]">
              {t(`platforms.${record.platform}` as `platforms.${PlatformKey}`)}
            </Tag>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          ),
      },
      {
        title: t("table.platformOrderNo"),
        dataIndex: "platformOrderNo",
        key: "platformOrderNo",
        width: 140,
        render: (v: string | null) =>
          v ? (
            <span className="font-mono text-[11px]">{v}</span>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          ),
      },
      {
        title: t("table.status"),
        key: "status",
        width: 90,
        render: (_: unknown, record) => (
          <Tag
            color={
              record.status === "SELECTED"
                ? "green"
                : record.status === "CANCELLED"
                  ? "default"
                  : record.status === "FAILED"
                    ? "red"
                    : record.status === "CANDIDATES_READY"
                      ? "gold"
                      : record.status === "GENERATING"
                        ? "blue"
                        : "default"
            }
            className="!text-[10px]"
          >
            {t(`statuses.${record.status}` as `statuses.${OrderStatusKey}`)}
          </Tag>
        ),
      },
      {
        title: t("table.credits"),
        key: "credits",
        width: 70,
        align: "right",
        render: (_: unknown, record) =>
          record.creditsCharged !== null && record.creditsCharged > 0 ? (
            <span className="font-mono text-xs text-rose-700">
              -{record.creditsCharged}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          ),
      },
      {
        title: t("table.remarks"),
        dataIndex: "remarks",
        key: "remarks",
        width: 160,
        render: (v: string | null) =>
          v && v.trim().length > 0 ? (
            <span
              className="text-xs text-muted-foreground line-clamp-2 max-w-[160px]"
              title={v}
            >
              {v}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          ),
      },
      {
        title: t("table.createdAt"),
        dataIndex: "createdAt",
        key: "createdAt",
        width: 140,
        render: (v: string) => (
          <span className="text-[11px] text-muted-foreground">
            {dayjs(v).format("YYYY-MM-DD HH:mm")}
          </span>
        ),
      },
      {
        title: t("table.cancelledAt"),
        dataIndex: "cancelledAt",
        key: "cancelledAt",
        width: 140,
        render: (v: string | null) =>
          v ? (
            <span className="text-[11px] text-muted-foreground">
              {dayjs(v).format("YYYY-MM-DD HH:mm")}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">—</span>
          ),
      },
      {
        title: t("table.actions"),
        key: "actions",
        width: 200,
        fixed: "right",
        render: (_: unknown, record) => (
          <Space size={4}>
            <Button
              size="small"
              type="default"
              icon={<Eye className="h-3.5 w-3.5" />}
              onClick={() => setDetailOrder(record)}
            >
              {t("actions.viewDetail")}
            </Button>
            <Button
              size="small"
              type="default"
              icon={<MessageSquareText className="h-3.5 w-3.5" />}
              onClick={() => setRemarksOrder(record)}
            >
              {t("actions.editRemarks")}
            </Button>
            <Button
              size="small"
              danger
              type="default"
              icon={<Ban className="h-3.5 w-3.5" />}
              disabled={record.status === "CANCELLED"}
              onClick={() => setCancelOrder(record)}
            >
              {t("actions.cancelOrder")}
            </Button>
          </Space>
        ),
      },
    ],
    [t]
  );

  // ========== 渲染 ==========
  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t("title")}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <Button
          icon={
            <RefreshCw
              className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"}
            />
          }
          onClick={() => {
            setIsFirstLoad(true);
            const [from, to] = dateRange ?? [null, null];
            fetchFirstPage({
              status: statusFilter,
              platform: platformFilter,
              createdBy: createdByFilter,
              search: debouncedSearch,
              dateFrom: from ? from.startOf("day").toISOString() : undefined,
              dateTo: to ? to.endOf("day").toISOString() : undefined,
            });
          }}
        >
          {t("actions.refresh")}
        </Button>
      </div>

      {/* 过滤条 */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">
              {t("filters.status")}
            </span>
            <Select
              allowClear
              placeholder={t("filters.statusAll")}
              value={statusFilter}
              onChange={(v) => setStatusFilter(v ?? null)}
              style={{ minWidth: 130 }}
              options={ORDER_STATUS_VALUES.map((s) => ({
                value: s,
                label: t(`statuses.${s}` as `statuses.${OrderStatusKey}`),
              }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">
              {t("filters.platform")}
            </span>
            <Select
              allowClear
              placeholder={t("filters.platformAll")}
              value={platformFilter}
              onChange={(v) => setPlatformFilter(v ?? null)}
              style={{ minWidth: 140 }}
              options={PLATFORM_CODES.map((p) => ({
                value: p,
                label: t(`platforms.${p}` as `platforms.${PlatformKey}`),
              }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">
              {t("filters.createdBy")}
            </span>
            <Select
              allowClear
              showSearch
              placeholder={t("filters.createdByAll")}
              value={createdByFilter}
              onChange={(v) => setCreatedByFilter(v ?? null)}
              optionFilterProp="label"
              style={{ minWidth: 200 }}
              options={userOptions.map((u) => ({
                value: u.id,
                label: `${u.name} · ${u.email}`,
              }))}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">
              {t("filters.dateFrom")} ~ {t("filters.dateTo")}
            </span>
            <RangePicker
              value={dateRange as [Dayjs | null, Dayjs | null] | null}
              onChange={(v) =>
                setDateRange(v as [Dayjs | null, Dayjs | null] | null)
              }
              allowClear
            />
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Input
              allowClear
              prefix={<Search className="h-3.5 w-3.5 text-muted-foreground" />}
              placeholder={t("filters.searchPlaceholder")}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <Button type="default" onClick={handleResetFilters}>
            {t("filters.reset")}
          </Button>
        </div>
      </div>

      {/* 表格 */}
      <div
        ref={tableContainerRef}
        className="rounded-lg border bg-card overflow-auto"
        style={{ maxHeight: "calc(100vh - 320px)" }}
      >
        {isFirstLoad ? (
          <div className="p-4 space-y-3">
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        ) : orders.length === 0 ? (
          <Empty description={t("messages.empty")} className="py-12" />
        ) : (
          <>
            <Table<AdminOrderRow>
              dataSource={orders}
              columns={columns}
              rowKey="orderId"
              size="small"
              pagination={false}
              scroll={{ x: 1200 }}
            />
            {/* 底部哨兵 + 加载占位 / 已到底 */}
            <div
              ref={sentinelRef}
              className="flex items-center justify-center py-3 text-[11px] text-muted-foreground"
            >
              {nextCursor ? (
                <>
                  <Loader2
                    className={`h-3 w-3 mr-1.5 ${
                      loadingMore ? "animate-spin" : "opacity-0"
                    }`}
                  />
                  {loadingMore ? t("messages.loading") : t("messages.loadMore")}
                </>
              ) : (
                <Badge color="default" className="!text-[10px]">
                  {t("messages.endReached")}
                </Badge>
              )}
            </div>
          </>
        )}
      </div>

      {/* 详情 modal（包装 OrderDetailView） */}
      <AdminOrderDetailModal
        order={detailOrder}
        onClose={() => setDetailOrder(null)}
        onCancel={handleCancelFromDetail}
        onEditRemarks={handleEditRemarksFromDetail}
      />

      {/* 改备注 dialog */}
      <OrderRemarksDialog
        order={remarksOrder}
        onClose={() => setRemarksOrder(null)}
        onConfirm={handleSaveRemarks}
      />

      {/* 取消确认 dialog */}
      <CancelConfirmDialog
        order={cancelOrder}
        onClose={() => setCancelOrder(null)}
        onConfirm={handleConfirmCancel}
      />
    </div>
  );
}
