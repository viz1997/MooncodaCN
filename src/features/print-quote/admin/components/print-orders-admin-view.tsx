"use client";

/**
 * 打印订单后台 —— /admin/print-orders
 *
 * 打印服务改成登录下单之后,每张工单都挂在 `user_id` 下,但后台仍然是
 * **全局视角** —— 这里看得到所有人的单,只有「按状态筛」,没有「按用户筛」。
 * 工作室的日常动作就两个:看这单要多少钱 / 把状态往前推一格。
 *
 * ## 为什么金额直接显示,不显示「等报价」
 *
 * 落库的 `total_price_cents` 是**服务端重算过的**报价(下单时重算,不信任
 * 客户端)。所以这一列就是用户当时看到的那个数,可以直接拿来对账。
 *
 * ## 改状态走状态机
 *
 * `<Select>` 的选项不是「所有状态随便挑」,而是 `allowedNextStatuses(当前)`
 * 算出来的:推进 / 回退 / 取消分三组,终态的工单一组都没有(锁死)。
 *
 * 回退**必须写备注** —— 「把已发货的工单退回生产中」是个需要解释的动作,
 * 用户得知道为什么。前端拦一道(必填框),数据层再强校验一道(真正的
 * 授权边界)。
 *
 * ## 状态词走 i18n
 *
 * 后台其余文案还是硬编码中文(全量 i18n 化后台是另一个 PR),但**状态词**
 * 必须跟用户侧一致 —— 同一个状态在两边叫两个名字,用户来问的时候没法
 * 对上话。统一读 `PrintQuote.status.*`。
 */

import { App, Button, Input, Modal, Select } from "antd";
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  Eye,
  RefreshCw,
  Scale,
  Wallet,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  formatCurrency,
  formatFileSize,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import {
  adminGetPrintOrderDetailAction,
  adminListPrintOrdersAction,
  adminMarkPrintOrderPaidOfflineAction,
  adminRevokePrintOrderOfflinePaymentAction,
  adminUpdatePrintOrderStatusAction,
} from "@/features/print-quote/admin/actions";
import type { AdminPrintOrder } from "@/features/print-quote/admin/types";
import { OrderTimeline } from "@/features/print-quote/components/order-timeline";
import type { DeliveryTierId } from "@/features/print-quote/lib/delivery-tier";
import type { PrintOrderStats } from "@/features/print-quote/lib/order-store";
import {
  PRINT_ORDER_STATUSES,
  type PrintOrderEventView,
  type PrintOrderStatus,
} from "@/features/print-quote/lib/quote-types";
import {
  allowedNextStatuses,
  classifyTransition,
  transitionRequiresNote,
} from "@/features/print-quote/lib/status-machine";
import {
  PRINT_ORDER_PAYMENT_ADMIN_CHIP,
  PRINT_ORDER_STATUS_ADMIN_CHIP,
  PRINT_ORDER_STATUS_DOT,
} from "@/features/print-quote/lib/status-ui";
import { cn } from "@/lib/utils";

/** 后台错误码 → i18n key(认不出来的码一律当「非法跳转」) */
const ADMIN_ERROR_CODES = new Set([
  "ORDER_NOT_FOUND",
  "INVALID_TRANSITION",
  "NOTE_REQUIRED",
  "SAME_STATUS",
  /** 没收款不许开工(2026-11-04) */
  "PAYMENT_REQUIRED",
]);

/** 交期档位 → 中文名(后台文案硬编码中文,跟这一屏其余部分一致) */
const DELIVERY_TIER_LABEL: Record<DeliveryTierId, string> = {
  standard: "标准",
  express: "加急",
  urgent: "特急",
};

export function PrintOrdersAdminView() {
  const { message } = App.useApp();
  const t = useTranslations("PrintQuote");
  const [orders, setOrders] = useState<AdminPrintOrder[]>([]);
  /**
   * 统计 —— 服务端单独查的,**不跟筛选走**
   *
   * 「一共多少单 / 总共多少钱」是经营数字,不该因为点了个筛选按钮就变。
   * 在客户端拿列表算的话,列表既分页又跟着筛选走,算出来的合计是假的。
   */
  const [stats, setStats] = useState<PrintOrderStats>({
    total: 0,
    pending: 0,
    producing: 0,
    amountCents: 0,
  });
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<PrintOrderStatus | "all">(
    "all"
  );
  const [detail, setDetail] = useState<AdminPrintOrder | null>(null);
  /** 详情里的时间线 */
  const [detailEvents, setDetailEvents] = useState<PrintOrderEventView[]>([]);
  /** 选中的目标状态 —— 还没提交 */
  const [pendingStatus, setPendingStatus] = useState<PrintOrderStatus | null>(
    null
  );
  /** 备注(回退时必填) */
  const [note, setNote] = useState("");
  /** 改状态的错误文案 */
  const [statusError, setStatusError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListPrintOrdersAction({
        status: filterStatus === "all" ? null : filterStatus,
        limit: 100,
      });
      setOrders(res?.data?.orders ?? []);
      if (res?.data?.stats) setStats(res.data.stats);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载打印订单失败");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, message]);

  // 筛选状态一变就重新拉 —— `reload` 已经把 filterStatus 收进闭包,
  // 所以依赖写 reload 就够了(等价于依赖 filterStatus)。
  useEffect(() => {
    void reload();
  }, [reload]);

  /** 拉一张工单的详情 + 时间线 */
  const loadDetail = useCallback(async (orderNo: string) => {
    const res = await adminGetPrintOrderDetailAction({ orderNo });
    const data = res?.data;
    if (!data?.ok) return;
    setDetail(data.order);
    setDetailEvents(data.events);
  }, []);

  /** 打开详情 */
  const openDetail = useCallback(
    (order: AdminPrintOrder) => {
      setDetail(order);
      setDetailEvents([]);
      setPendingStatus(null);
      setNote("");
      setStatusError(null);
      void loadDetail(order.orderNo);
    },
    [loadDetail]
  );

  const { execute: updateStatus, isPending } = useAction(
    adminUpdatePrintOrderStatusAction,
    {
      onSuccess: async ({ data }) => {
        if (!data) return;
        if (!data.ok) {
          const code = ADMIN_ERROR_CODES.has(data.code)
            ? data.code
            : "INVALID_TRANSITION";
          setStatusError(t(`admin.errors.${code}`));
          return;
        }
        message.success("状态已更新");
        setPendingStatus(null);
        setNote("");
        setStatusError(null);
        void loadDetail(data.orderNo);
        void reload();
      },
      onError: ({ error }) => {
        setStatusError(error.serverError ?? "改状态失败");
      },
    }
  );

  /**
   * 线下收款 —— 「标记已收款」
   *
   * 线上(Stripe)收的钱由 webhook 回写,工作室不用管。只有转账过来的
   * 钱要手工标一下。
   */
  const { execute: markPaid, isPending: markingPaid } = useAction(
    adminMarkPrintOrderPaidOfflineAction,
    {
      onSuccess: async ({ data }) => {
        if (!data) return;
        if (!data.ok) {
          message.error(t("admin.payment.errors.ORDER_NOT_FOUND"));
          return;
        }
        message.success(
          data.alreadyPaid
            ? t("admin.payment.alreadyPaid")
            : t("admin.payment.marked")
        );
        void loadDetail(data.orderNo);
        void reload();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("admin.payment.errors.FAILED"));
      },
    }
  );

  /** 撤销线下收款 —— 防误点 */
  const { execute: revokePayment, isPending: revokingPayment } = useAction(
    adminRevokePrintOrderOfflinePaymentAction,
    {
      onSuccess: async ({ data }) => {
        if (!data) return;
        if (!data.ok) {
          message.error(
            data.code === "ONLINE_PAYMENT"
              ? t("admin.payment.errors.ONLINE_PAYMENT")
              : t("admin.payment.errors.ORDER_NOT_FOUND")
          );
          return;
        }
        message.success(t("admin.payment.revoked"));
        void loadDetail(data.orderNo);
        void reload();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("admin.payment.errors.FAILED"));
      },
    }
  );

  /** Select 的选项:推进 / 回退 / 取消 三组 */
  const statusOptions = useMemo(() => {
    if (!detail) return [];
    const forward: { value: PrintOrderStatus; label: string }[] = [];
    const backward: { value: PrintOrderStatus; label: string }[] = [];
    const cancel: { value: PrintOrderStatus; label: string }[] = [];

    for (const next of allowedNextStatuses(detail.status)) {
      const kind = classifyTransition(detail.status, next);
      const item = { value: next, label: t(`status.${next}`) };
      if (kind === "forward") forward.push(item);
      else if (kind === "backward") backward.push(item);
      else cancel.push(item);
    }

    const groups: {
      label: string;
      options: { value: PrintOrderStatus; label: string }[];
    }[] = [];
    if (forward.length > 0) {
      groups.push({ label: t("admin.groups.forward"), options: forward });
    }
    if (backward.length > 0) {
      groups.push({ label: t("admin.groups.backward"), options: backward });
    }
    if (cancel.length > 0) {
      groups.push({ label: t("admin.groups.cancel"), options: cancel });
    }
    return groups;
  }, [detail, t]);

  /** 这次改动要不要写备注 */
  const noteRequired =
    detail !== null &&
    pendingStatus !== null &&
    transitionRequiresNote(detail.status, pendingStatus);

  const submitStatusChange = useCallback(() => {
    if (!detail || !pendingStatus) return;
    if (noteRequired && note.trim().length === 0) {
      setStatusError(t("admin.errors.NOTE_REQUIRED"));
      return;
    }
    void updateStatus({
      orderNo: detail.orderNo,
      status: pendingStatus,
      note: note.trim() || null,
    });
  }, [detail, pendingStatus, noteRequired, note, t, updateStatus]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="打印订单"
        description="按克重计价的 3D 打印工单 —— 官网工具页(/tools/workbench)量好后提交打印订单,金额为服务端重算后的报价"
        actions={
          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={reload}>
            刷新
          </Button>
        }
      />

      {/* 表不存在时的引导 —— print_order 表是 db:push 上去的,新环境可能还没建 */}
      {stats.total === 0 && !loading ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800 dark:text-amber-300">
              还没有打印订单
            </p>
            <p className="text-amber-700 dark:text-amber-400 mt-1">
              打印订单存在 <code className="font-mono">print_order</code> 表里。
              新环境还没建表的话,先跑一次
              <code className="mx-1 px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 font-mono text-xs">
                pnpm tsx scripts/apply-print-order-schema.ts
              </code>
              —— 这张表不在 drizzle 迁移历史里(和 product / product_variant
              一样, 走 db:push 或一次性脚本)。
            </p>
          </div>
        </div>
      ) : null}

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="订单"
          value={String(stats.total)}
          icon={<ClipboardList className="h-4 w-4 text-violet-600" />}
          iconBg="bg-violet-500/10"
        />
        <StatCard
          label="待确认"
          value={String(stats.pending)}
          icon={<Boxes className="h-4 w-4 text-amber-600" />}
          iconBg="bg-amber-500/10"
        />
        <StatCard
          label="生产中"
          value={String(stats.producing)}
          icon={<Scale className="h-4 w-4 text-sky-600" />}
          iconBg="bg-sky-500/10"
        />
        <StatCard
          label="合计金额"
          value={formatCurrency(stats.amountCents / 100)}
          icon={<Wallet className="h-4 w-4 text-emerald-600" />}
          iconBg="bg-emerald-500/10"
        />
      </div>

      {/* 状态筛选 */}
      <div className="flex items-center gap-1 flex-wrap">
        <button
          type="button"
          onClick={() => setFilterStatus("all")}
          className={cn(
            "text-xs px-2.5 py-1 rounded-full border transition-colors",
            filterStatus === "all"
              ? "bg-foreground text-background border-foreground"
              : "hover:bg-muted"
          )}
        >
          全部
        </button>
        {PRINT_ORDER_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilterStatus(s)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1.5",
              filterStatus === s
                ? "bg-foreground text-background border-foreground"
                : "hover:bg-muted"
            )}
          >
            <span
              className={cn("size-1.5 rounded-full", PRINT_ORDER_STATUS_DOT[s])}
            />
            {t(`status.${s}`)}
          </button>
        ))}
      </div>

      {/* 订单表 */}
      {orders.length === 0 ? (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-6">
            <EmptyState
              icon={ClipboardList}
              title={loading ? "加载中..." : "暂无打印订单"}
              description="官网打印单用户下单后会出现在这里"
            />
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2">订单号</th>
                  <th className="text-left font-medium px-3 py-2">提交时间</th>
                  <th className="text-left font-medium px-3 py-2">模型</th>
                  <th className="text-right font-medium px-3 py-2">克重</th>
                  <th className="text-left font-medium px-3 py-2">尺寸 (mm)</th>
                  <th className="text-right font-medium px-3 py-2">金额</th>
                  <th className="text-left font-medium px-3 py-2">收款</th>
                  <th className="text-left font-medium px-3 py-2">状态</th>
                  <th className="text-right font-medium px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {o.orderNo}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(o.createdAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-2 max-w-40">
                      <span className="block truncate text-xs">
                        {o.modelFileName}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">
                      {o.materialWeightG.toFixed(1)} g
                      {o.supportWeightG ? (
                        <span className="text-muted-foreground">
                          {" "}
                          +{o.supportWeightG.toFixed(0)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      {o.dims.map((d) => d.toFixed(1)).join(" × ")}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-medium whitespace-nowrap">
                      {formatCurrency(o.totalPriceCents / 100)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
                          PRINT_ORDER_PAYMENT_ADMIN_CHIP[o.paymentStatus]
                        )}
                      >
                        {t(`payment.status.${o.paymentStatus}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
                          PRINT_ORDER_STATUS_ADMIN_CHIP[o.status]
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            PRINT_ORDER_STATUS_DOT[o.status]
                          )}
                        />
                        {t(`status.${o.status}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        size="small"
                        type="text"
                        onClick={() => openDetail(o)}
                        aria-label="详情"
                        icon={<Eye className="h-3.5 w-3.5" />}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 详情 + 改状态 */}
      <Modal
        open={!!detail}
        onCancel={() => setDetail(null)}
        title={detail ? `打印订单 ${detail.orderNo}` : ""}
        footer={[
          <Button key="close" onClick={() => setDetail(null)}>
            关闭
          </Button>,
        ]}
        width={720}
      >
        {detail ? (
          <div className="space-y-4 text-sm">
            {/* 状态推进 */}
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground mb-2">
                {t("admin.statusTitle")}
              </p>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
                    PRINT_ORDER_STATUS_ADMIN_CHIP[detail.status]
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      PRINT_ORDER_STATUS_DOT[detail.status]
                    )}
                  />
                  {t(`status.${detail.status}`)}
                </span>
                {/* 这单的邮件通知语言 —— 提醒工作室这单是英文单 */}
                <span className="text-[11px] text-muted-foreground">
                  {t("admin.localeLabel")}:{" "}
                  {detail.locale === "en" ? "English" : "中文"}
                </span>
              </div>

              <Select<PrintOrderStatus>
                value={pendingStatus}
                placeholder={t("admin.selectPlaceholder")}
                disabled={isPending || statusOptions.length === 0}
                onChange={(next) => {
                  setPendingStatus(next);
                  setStatusError(null);
                }}
                options={statusOptions}
                className="w-full"
              />

              {pendingStatus ? (
                <div className="mt-3">
                  <span className="block text-xs font-medium text-foreground">
                    {noteRequired
                      ? t("admin.noteRequired")
                      : t("admin.noteOptional")}
                  </span>
                  <Input.TextArea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    maxLength={1000}
                    aria-label={
                      noteRequired
                        ? t("admin.noteRequired")
                        : t("admin.noteOptional")
                    }
                    placeholder={t("admin.notePlaceholder")}
                    className="mt-1"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      type="primary"
                      loading={isPending}
                      onClick={submitStatusChange}
                    >
                      {t("admin.submit")}
                    </Button>
                    <Button
                      disabled={isPending}
                      onClick={() => {
                        setPendingStatus(null);
                        setNote("");
                        setStatusError(null);
                      }}
                    >
                      {t("admin.discard")}
                    </Button>
                  </div>
                </div>
              ) : null}

              {statusError ? (
                <p className="mt-2 text-xs text-destructive">{statusError}</p>
              ) : null}
            </div>

            {/* 收款 —— 线上钱由 webhook 回写,这里只管线下转账 */}
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground mb-2">
                {t("admin.payment.title")}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]",
                    PRINT_ORDER_PAYMENT_ADMIN_CHIP[detail.paymentStatus]
                  )}
                >
                  {t(`payment.status.${detail.paymentStatus}`)}
                </span>
                {detail.paymentChannel ? (
                  <span className="text-[11px] text-muted-foreground">
                    {detail.paymentChannel === "stripe"
                      ? t("admin.payment.channel.stripe")
                      : t("admin.payment.channel.offline")}
                  </span>
                ) : null}
                {detail.paidAt ? (
                  <span className="text-[11px] text-muted-foreground">
                    {t("admin.payment.paidAt")}:{" "}
                    {new Date(detail.paidAt).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {detail.paymentStatus === "paid" ? (
                  <>
                    <span className="text-xs text-muted-foreground">
                      {t("admin.payment.paidHint")}
                    </span>
                    {/* 只有线下收的钱能撤销 —— 线上钱已经进账了 */}
                    {detail.paymentChannel === "offline" ? (
                      <Button
                        size="small"
                        danger
                        loading={revokingPayment}
                        onClick={() => {
                          void revokePayment({ orderNo: detail.orderNo });
                        }}
                      >
                        {t("admin.payment.revoke")}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <Button
                    size="small"
                    type="primary"
                    loading={markingPaid}
                    onClick={() => {
                      void markPaid({ orderNo: detail.orderNo });
                    }}
                  >
                    {t("admin.payment.markPaid")}
                  </Button>
                )}
              </div>
            </div>

            {/* 时间线 */}
            <div className="rounded-lg border p-3">
              <p className="mb-3 text-xs text-muted-foreground">
                {t("admin.timelineTitle")}
              </p>
              <OrderTimeline events={detailEvents} viewer="admin" />
            </div>

            {/* 报价明细 */}
            <div className="grid grid-cols-2 gap-3">
              <InfoRow
                label="体积"
                value={`${detail.volumeCM3.toFixed(2)} cm³`}
              />
              <InfoRow
                label="表面积"
                value={`${detail.surfaceAreaCM2.toFixed(2)} cm²`}
              />
              <InfoRow
                label="耗材克重"
                value={`${detail.materialWeightG.toFixed(2)} g`}
              />
              <InfoRow
                label="支撑克重"
                value={
                  detail.supportWeightG === null
                    ? "—"
                    : `${detail.supportWeightG.toFixed(2)} g`
                }
              />
              <InfoRow
                label="克重费"
                value={formatCurrency(detail.weightFeeCents / 100)}
              />
              <InfoRow
                label="后处理"
                value={formatCurrency(detail.varnishFeeCents / 100)}
              />
              <InfoRow
                label="支撑加价"
                value={formatCurrency(detail.supportFeeCents / 100)}
              />
              {/* 交期 —— 工作室按这个排产,加急单要插队 */}
              <InfoRow
                label="交期"
                value={`${detail.deliveryHours} 小时 · ${
                  DELIVERY_TIER_LABEL[detail.deliveryTier] ?? "标准"
                }`}
              />
              <InfoRow
                label="交期加价"
                value={formatCurrency(detail.deliveryFeeCents / 100)}
              />
              <InfoRow
                label="合计"
                value={formatCurrency(detail.totalPriceCents / 100)}
              />
            </div>

            {/* 模型文件 */}
            <div className="rounded-lg border p-3 space-y-1.5">
              <p className="text-xs text-muted-foreground">模型文件</p>
              <p className="font-mono text-xs break-all">
                {detail.modelFileName}
              </p>
              {detail.modelSizeBytes ? (
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(detail.modelSizeBytes)}
                </p>
              ) : null}
              <a
                href={detail.modelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs text-primary underline break-all"
              >
                {detail.modelUrl}
              </a>
            </div>

            {/* 联系方式 */}
            <div className="rounded-lg border p-3 space-y-1.5">
              <p className="text-xs text-muted-foreground">联系方式</p>
              <p className="text-xs">
                {detail.contactName} · {detail.contactEmail}
                {detail.contactPhone ? ` · ${detail.contactPhone}` : ""}
              </p>
              <p className="text-[11px] text-muted-foreground font-mono">
                用户:{detail.userId}
              </p>
              {detail.note ? (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                  备注:{detail.note}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  iconBg,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  iconBg: string;
}) {
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] text-muted-foreground">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
        <div className={cn("rounded-lg p-2", iconBg)}>{icon}</div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
