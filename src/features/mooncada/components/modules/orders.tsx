"use client";

import {
  CheckCircle2,
  Clock,
  Eye,
  MapPin,
  Package,
  Search,
  ShoppingCart,
  Truck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  formatCurrency,
  formatDate,
  ModuleHeader,
} from "@/features/mooncada/components/shared";
import { MOCK_ORDERS } from "@/features/mooncada/lib/mock-data";
import type { Order, OrderStatus } from "@/features/mooncada/lib/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<
  OrderStatus,
  { label: string; color: string; icon: typeof Clock }
> = {
  pending: {
    label: "待付款",
    color:
      "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
    icon: Clock,
  },
  paid: {
    label: "已付款",
    color:
      "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
    icon: CheckCircle2,
  },
  producing: {
    label: "生产中",
    color:
      "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900",
    icon: Package,
  },
  shipped: {
    label: "已发货",
    color:
      "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900",
    icon: Truck,
  },
  completed: {
    label: "已完成",
    color:
      "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
    icon: CheckCircle2,
  },
  cancelled: {
    label: "已取消",
    color:
      "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900",
    icon: XCircle,
  },
};

export function OrdersModule() {
  const { toast } = useToast();
  const [orders] = useState<Order[]>(MOCK_ORDERS);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);

  const filtered = orders.filter((o) => {
    const matchSearch =
      o.orderId.toLowerCase().includes(search.toLowerCase()) ||
      o.username.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || o.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const statusCounts = orders.reduce(
    (acc, o) => {
      acc[o.status] = (acc[o.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="订单管理"
        description="管理3D打印定制订单 · 兼容 Shopify 格式 · 支持订单状态跟踪与物流查询"
      />

      {/* 状态统计卡片 */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {(
          [
            "pending",
            "paid",
            "producing",
            "shipped",
            "completed",
            "cancelled",
          ] as OrderStatus[]
        ).map((s) => {
          const config = STATUS_CONFIG[s];
          const Icon = config.icon;
          return (
            <button
              key={s}
              onClick={() => setFilterStatus(filterStatus === s ? "all" : s)}
              className={cn(
                "rounded-lg border p-3 text-left transition-all hover:shadow-sm",
                filterStatus === s
                  ? "ring-2 ring-emerald-500/30 border-emerald-500/50"
                  : ""
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <Icon className={cn("h-4 w-4", config.color.split(" ")[1])} />
                <span className="text-lg font-bold">
                  {statusCounts[s] || 0}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {config.label}
              </p>
            </button>
          );
        })}
      </div>

      {/* 搜索 */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索订单号或用户名..."
          className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-muted/40 focus:bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
        />
      </div>

      {/* 订单表格 */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={ShoppingCart}
              title="暂无订单"
              description="订单创建后将在此处显示"
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[120px]">订单号</TableHead>
                    <TableHead>商品</TableHead>
                    <TableHead className="min-w-[100px]">用户</TableHead>
                    <TableHead className="text-right">金额</TableHead>
                    <TableHead className="min-w-[100px]">状态</TableHead>
                    <TableHead className="min-w-[140px]">创建时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => {
                    const config = STATUS_CONFIG[o.status];
                    return (
                      <TableRow key={o.orderId} className="hover:bg-muted/50">
                        <TableCell>
                          <p className="font-mono text-xs font-medium">
                            {o.orderId}
                          </p>
                          {o.proxyId && (
                            <p className="text-[10px] text-muted-foreground">
                              代理: {o.proxyId}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <img
                              src={o.items[0]?.previewUrl}
                              alt=""
                              className="h-9 w-9 rounded object-cover"
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-medium truncate max-w-[160px]">
                                {o.items[0]?.name}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                ×{o.items[0]?.quantity}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs">{o.username}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <p className="text-sm font-semibold">
                            {formatCurrency(o.totalAmount, o.currency)}
                          </p>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                              config.color
                            )}
                          >
                            {config.label}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(o.createdAt, true)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setPreviewOrder(o)}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" /> 详情
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 订单详情对话框 */}
      <Dialog
        open={!!previewOrder}
        onOpenChange={(open) => !open && setPreviewOrder(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              订单详情
            </DialogTitle>
            <DialogDescription>{previewOrder?.orderId}</DialogDescription>
          </DialogHeader>
          {previewOrder && (
            <div className="space-y-4 max-h-[60vh] overflow-y-auto">
              {/* 状态时间线 */}
              <div className="flex items-center justify-between bg-muted/40 rounded-lg p-3">
                {(
                  [
                    "pending",
                    "paid",
                    "producing",
                    "shipped",
                    "completed",
                  ] as OrderStatus[]
                ).map((s, i, arr) => {
                  const config = STATUS_CONFIG[s];
                  const Icon = config.icon;
                  const currentIdx = arr.indexOf(
                    previewOrder.status as OrderStatus
                  );
                  const isActive = i <= currentIdx;
                  return (
                    <div
                      key={s}
                      className="flex items-center flex-1 last:flex-none"
                    >
                      <div className="flex flex-col items-center gap-1">
                        <div
                          className={cn(
                            "h-7 w-7 rounded-full flex items-center justify-center border-2",
                            isActive
                              ? "bg-emerald-500 border-emerald-500 text-white"
                              : "bg-muted border-muted-foreground/30 text-muted-foreground"
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <span
                          className={cn(
                            "text-[10px]",
                            isActive
                              ? "text-foreground font-medium"
                              : "text-muted-foreground"
                          )}
                        >
                          {config.label}
                        </span>
                      </div>
                      {i < arr.length - 1 && (
                        <div
                          className={cn(
                            "flex-1 h-0.5 mx-1",
                            i < currentIdx ? "bg-emerald-500" : "bg-muted"
                          )}
                        />
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 商品列表 */}
              <div className="space-y-2">
                <p className="text-sm font-medium">商品信息</p>
                {previewOrder.items.map((item) => (
                  <div
                    key={item.itemId}
                    className="flex items-center gap-3 p-2 rounded-lg bg-muted/30"
                  >
                    <img
                      src={item.previewUrl}
                      alt={item.name}
                      className="h-12 w-12 rounded object-cover"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        模型ID: {item.modelId} × {item.quantity}
                      </p>
                    </div>
                    <p className="text-sm font-semibold">
                      {formatCurrency(item.price, previewOrder.currency)}
                    </p>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 border-t">
                  <span className="text-sm text-muted-foreground">
                    订单总额
                  </span>
                  <span className="text-lg font-bold">
                    {formatCurrency(
                      previewOrder.totalAmount,
                      previewOrder.currency
                    )}
                  </span>
                </div>
              </div>

              {/* 收货地址 */}
              <div className="bg-muted/30 rounded-lg p-3 space-y-1.5">
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" /> 收货地址
                </p>
                <p className="text-xs">
                  {previewOrder.shippingAddress.name} ·{" "}
                  {previewOrder.shippingAddress.phone}
                </p>
                <p className="text-xs text-muted-foreground">
                  {previewOrder.shippingAddress.country}{" "}
                  {previewOrder.shippingAddress.city}{" "}
                  {previewOrder.shippingAddress.address} (
                  {previewOrder.shippingAddress.zipCode})
                </p>
              </div>

              {/* 物流信息 */}
              {previewOrder.trackingNumber && (
                <div className="bg-sky-500/5 border border-sky-500/20 rounded-lg p-3 space-y-1">
                  <p className="text-sm font-medium flex items-center gap-1.5 text-sky-700 dark:text-sky-400">
                    <Truck className="h-3.5 w-3.5" /> 物流信息
                  </p>
                  <p className="text-xs font-mono">
                    运单号: {previewOrder.trackingNumber}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    发货时间:{" "}
                    {previewOrder.shippedAt &&
                      formatDate(previewOrder.shippedAt, true)}
                  </p>
                </div>
              )}

              {/* 时间信息 */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-muted/30 rounded-lg p-2">
                  <p className="text-muted-foreground">创建时间</p>
                  <p>{formatDate(previewOrder.createdAt, true)}</p>
                </div>
                {previewOrder.paidAt && (
                  <div className="bg-muted/30 rounded-lg p-2">
                    <p className="text-muted-foreground">付款时间</p>
                    <p>{formatDate(previewOrder.paidAt, true)}</p>
                  </div>
                )}
                {previewOrder.completedAt && (
                  <div className="bg-muted/30 rounded-lg p-2">
                    <p className="text-muted-foreground">完成时间</p>
                    <p>{formatDate(previewOrder.completedAt, true)}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => toast({ title: "已复制运单号" })}
              disabled={!previewOrder?.trackingNumber}
            >
              复制运单号
            </Button>
            <Button onClick={() => setPreviewOrder(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
