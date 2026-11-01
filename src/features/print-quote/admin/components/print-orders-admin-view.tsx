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
 */

import { App, Button, Modal, Select } from "antd";
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  Eye,
  RefreshCw,
  Scale,
  Wallet,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import {
  EmptyState,
  formatCurrency,
  formatFileSize,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import {
  adminListPrintOrdersAction,
  adminUpdatePrintOrderStatusAction,
} from "@/features/print-quote/admin/actions";
import type { AdminPrintOrder } from "@/features/print-quote/admin/types";
import type { PrintOrderStats } from "@/features/print-quote/lib/order-store";
import type { PrintOrderStatus } from "@/features/print-quote/lib/quote-types";
import { cn } from "@/lib/utils";

const STATUS_META: Record<
  PrintOrderStatus,
  { label: string; dot: string; chip: string }
> = {
  PENDING: {
    label: "待确认",
    dot: "bg-amber-500",
    chip: "border-amber-500/30 text-amber-700 dark:text-amber-300",
  },
  CONFIRMED: {
    label: "已确认",
    dot: "bg-sky-500",
    chip: "border-sky-500/30 text-sky-700 dark:text-sky-300",
  },
  IN_PRODUCTION: {
    label: "生产中",
    dot: "bg-violet-500",
    chip: "border-violet-500/30 text-violet-700 dark:text-violet-300",
  },
  SHIPPED: {
    label: "已发货",
    dot: "bg-emerald-500",
    chip: "border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
  },
  COMPLETED: {
    label: "已完成",
    dot: "bg-emerald-600",
    chip: "border-emerald-600/30 text-emerald-700 dark:text-emerald-300",
  },
  CANCELLED: {
    label: "已取消",
    dot: "bg-zinc-500",
    chip: "border-zinc-500/30 text-zinc-600 dark:text-zinc-300",
  },
};

const STATUS_ORDER: PrintOrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PRODUCTION",
  "SHIPPED",
  "COMPLETED",
  "CANCELLED",
];

export function PrintOrdersAdminView() {
  const { message } = App.useApp();
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

  const { execute: updateStatus, isPending } = useAction(
    adminUpdatePrintOrderStatusAction,
    {
      onSuccess: ({ data }) => {
        message.success(data?.message ?? "状态已更新");
        setDetail((prev) =>
          prev && prev.orderNo === data?.orderNo
            ? { ...prev, status: data.status }
            : prev
        );
        void reload();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "改状态失败");
      },
    }
  );

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="打印订单"
        description="按克重计价的 3D 打印工单 —— 官网 /quote 页登录下单,金额为服务端重算后的报价"
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
        {STATUS_ORDER.map((s) => (
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
            <span className={cn("size-1.5 rounded-full", STATUS_META[s].dot)} />
            {STATUS_META[s].label}
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
              description="官网 /quote 页用户下单后会出现在这里"
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
                          STATUS_META[o.status].chip
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            STATUS_META[o.status].dot
                          )}
                        />
                        {STATUS_META[o.status].label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button
                        size="small"
                        type="text"
                        onClick={() => setDetail(o)}
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
        width={640}
      >
        {detail ? (
          <div className="space-y-4 text-sm">
            {/* 状态推进 */}
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground mb-2">工单状态</p>
              <Select
                value={detail.status}
                disabled={isPending}
                onChange={(next: PrintOrderStatus) =>
                  updateStatus({
                    orderNo: detail.orderNo,
                    status: next,
                  })
                }
                options={STATUS_ORDER.map((s) => ({
                  value: s,
                  label: STATUS_META[s].label,
                }))}
                className="w-full"
              />
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
