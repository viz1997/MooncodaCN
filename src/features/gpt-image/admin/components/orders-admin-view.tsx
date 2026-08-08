"use client";

import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Image as ImageIcon,
  Maximize2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteOrderAction } from "@/features/gpt-image/actions/orders";
import {
  ORDER_PLATFORM_LABELS,
  ORDER_PLATFORMS,
  ORDER_STATUS_COLORS,
  ORDER_STATUS_LABELS,
  type OrderPlatform,
  type OrderStatus,
  type OrderView,
  type PromptTemplateView,
} from "@/features/gpt-image/lib/types";
import { useSessionContext } from "@/lib/auth/session-context";
import { OrderEditDialog } from "./order-edit-dialog";
import { OrderFormDialog } from "./order-form-dialog";

export function OrdersAdminView() {
  const { user: currentUser } = useSessionContext();
  const isAdmin = currentUser?.role === "admin";
  const [orders, setOrders] = useState<OrderView[]>([]);
  const [templates, setTemplates] = useState<PromptTemplateView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<OrderView | null>(null);
  const [detailDialog, setDetailDialog] = useState<OrderView | null>(null);
  /** 管理端预览预览图：点原图/候选宫格图触发 */
  const [lightbox, setLightbox] = useState<{
    url: string;
    title: string;
    /** 触发下载时使用的默认文件名 */
    filename: string;
  } | null>(null);
  const [editingOrder, setEditingOrder] = useState<OrderView | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState<OrderView | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterPlatform, setFilterPlatform] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);

  const fetchOrders = async (opts: { silent?: boolean } = {}) => {
    // 仅在"还没有任何数据"时才显示 loading 骨架，避免后台 refetch 时把已显示的
    // 表格又变回 loading 态
    if (!opts.silent) setLoading(true);
    try {
      const res = await fetch("/api/orders");
      const json = await res.json();
      if (json.success) setOrders(json.data as OrderView[]);
    } catch (e) {
      console.error(e);
    } finally {
      if (!opts.silent) setLoading(false);
    }
  };

  const fetchTemplates = async () => {
    // 走 /api/templates 而不是 /api/admin/templates —— 后者 requireAdmin，
    // 普通用户会拿到 403，导致 templates 永远空、"创建订单"按钮永远 disabled。
    // /api/templates 任何登录用户都能用，且不返回 prompt（用户端不能看）。
    try {
      const res = await fetch("/api/templates");
      const json = await res.json();
      if (json.success) setTemplates(json.data as PromptTemplateView[]);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    void fetchOrders();
    void fetchTemplates();
  }, []);

  /**
   * 手动刷新：使用 silent 模式避免把已显示的表格切回 loading 骨架，
   * 仅在按钮上展示 spinner。
   */
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([fetchOrders({ silent: true }), fetchTemplates()]);
    } finally {
      setRefreshing(false);
    }
  };

  /**
   * 打开编辑对话框
   */
  const openEditDialog = (o: OrderView) => {
    setEditingOrder(o);
    setEditOpen(true);
  };

  /**
   * 编辑后乐观替换列表中的旧条目（保持 id 不变即可）
   */
  const handleOrderUpdated = (updated: OrderView) => {
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
  };

  /**
   * 打开删除确认对话框
   */
  const openDeleteDialog = (o: OrderView) => {
    setDeletingOrder(o);
  };

  /**
   * 执行删除 —— 乐观移除 + 服务端落地
   */
  const handleDelete = async () => {
    if (!deletingOrder) return;
    const targetId = deletingOrder.id;
    setOrders((prev) => prev.filter((o) => o.id !== targetId));
    const removed = deletingOrder;
    setDeletingOrder(null);
    try {
      const res = await deleteOrderAction({ id: targetId });
      if (!res?.data?.success) {
        throw new Error("删除失败");
      }
      toast.success(`订单 ${removed.orderNo} 已删除`);
    } catch (e) {
      // 失败回滚
      setOrders((prev) =>
        prev.some((o) => o.id === targetId) ? prev : [removed, ...prev]
      );
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  const filtered = orders.filter((o) => {
    if (filterStatus !== "ALL" && o.status !== filterStatus) return false;
    if (filterPlatform === "UNSPECIFIED") {
      if (o.platform !== null) return false;
    } else if (filterPlatform !== "ALL" && o.platform !== filterPlatform) {
      return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return (
        o.orderNo.toLowerCase().includes(q) ||
        o.recipientName.toLowerCase().includes(q) ||
        o.template.name.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const buildLink = (order: OrderView) => {
    if (typeof window === "undefined") return "";
    const origin = window.location.origin;
    return `${origin}/p/${order.token}`;
  };

  const handleCopyLink = async (order: OrderView) => {
    const link = buildLink(order);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("链接已复制到剪贴板");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const handleOpenLink = (order: OrderView) => {
    const link = buildLink(order);
    window.open(link, "_blank");
  };

  /** 下载：通过 fetch 取二进制再触发 a[download]，避免被 R2 CORS / 浏览器导航行为干扰 */
  const handleDownload = async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 异步释放，给浏览器一帧时间消化下载
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      toast.error(
        `下载失败：${err instanceof Error ? err.message : "未知错误"}`
      );
    }
  };

  const canViewDetail = (order: OrderView) =>
    order.hasUploadedImage || order.candidateCount > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">
            {isAdmin ? "订单管理" : "我的订单"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "查看全部用户创建的订单（管理员视图）。"
              : "查看你创建的订单，把链接发给指定用户即可收集原图与选择。"}
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          disabled={templates.filter((t) => t.isActive).length === 0}
        >
          <Plus className="mr-1 h-4 w-4" /> 创建订单
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="搜索订单号 / 用户 / 模板..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部状态</SelectItem>
                {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterPlatform} onValueChange={setFilterPlatform}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部平台</SelectItem>
                <SelectItem value="UNSPECIFIED">未指定</SelectItem>
                {ORDER_PLATFORMS.map((p: OrderPlatform) => (
                  <SelectItem key={p} value={p}>
                    {ORDER_PLATFORM_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={handleRefresh}
              disabled={refreshing}
              title="刷新列表"
              aria-label="刷新列表"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
              />
            </Button>
          </div>

          <div className="overflow-hidden rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">订单号</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>模板</TableHead>
                  <TableHead className="w-[100px]">状态</TableHead>
                  <TableHead className="w-[100px]">平台</TableHead>
                  <TableHead className="w-[120px]">原图/选择</TableHead>
                  <TableHead className="w-[140px]">创建时间</TableHead>
                  <TableHead className="w-[220px] text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && orders.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-muted-foreground"
                    >
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-muted-foreground"
                    >
                      {orders.length === 0 ? "暂无订单" : "没有匹配的订单"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-xs">
                        {order.orderNo}
                      </TableCell>
                      <TableCell>
                        {order.recipientName || (
                          <span className="text-zinc-400 italic">未指定</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {order.template.name}
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={`${ORDER_STATUS_COLORS[order.status as OrderStatus]} border-0`}
                        >
                          {ORDER_STATUS_LABELS[order.status as OrderStatus]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {order.platform ? (
                          <Badge
                            variant="outline"
                            className="border-zinc-300 px-1.5 py-0 text-[10px] font-normal text-zinc-600"
                          >
                            {ORDER_PLATFORM_LABELS[order.platform]}
                          </Badge>
                        ) : (
                          <span className="text-zinc-400 italic text-xs">
                            未指定
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-xs">
                          {order.hasUploadedImage ? (
                            <span
                              className="inline-flex items-center gap-0.5 text-emerald-700"
                              title={`用户已上传 ${order.uploadedImageCount ?? 0} / ${order.uploadCount} 张原图`}
                            >
                              <Upload className="h-3 w-3" /> 原图×
                              {order.uploadedImageCount ?? 0}/
                              {order.uploadCount}
                            </span>
                          ) : (
                            <span
                              className="text-muted-foreground"
                              title={`待上传 ${order.uploadCount} 张`}
                            >
                              待传{order.uploadCount}
                            </span>
                          )}
                          {order.selectionCount && order.selectionCount > 0 ? (
                            <span
                              className="inline-flex items-center gap-0.5 text-emerald-700"
                              title={`已为 ${order.selectionCount} 张原图各选定一个效果`}
                            >
                              <CheckCircle2 className="h-3 w-3" /> 已选
                              {order.selectionCount}/
                              {order.uploadedImageCount ?? 0}
                            </span>
                          ) : order.candidateCount > 0 ? (
                            <span
                              className="inline-flex items-center gap-0.5 text-amber-600"
                              title={`已生成 ${order.candidateCount} 组候选，等待用户选择`}
                            >
                              <Clock className="h-3 w-3" /> 待选
                              {order.candidateCount}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(order.createdAt).toLocaleString("zh-CN", {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          {canViewDetail(order) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDetailDialog(order)}
                              title="查看原图与选择"
                            >
                              <Eye className="mr-1 h-3.5 w-3.5" /> 详情
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(order)}
                            title="编辑订单"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openDeleteDialog(order)}
                            title="删除订单"
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLinkDialog(order)}
                          >
                            <Copy className="mr-1 h-3.5 w-3.5" /> 链接
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleOpenLink(order)}
                            title="在新标签打开"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <OrderFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        templates={templates}
        onCreated={(order) => {
          // 乐观插入：立即把新订单放在列表顶部，同时后台静默 refetch 兜底
          setOrders((prev) => {
            if (prev.some((o) => o.id === order.id)) return prev;
            return [order, ...prev];
          });
          void fetchOrders({ silent: true });
        }}
      />

      <OrderEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        order={editingOrder}
        onUpdated={(order) => {
          handleOrderUpdated(order);
          // 后台静默 refetch 兜底（比如 uploadedImages 等派生字段）
          void fetchOrders({ silent: true });
        }}
      />

      {/* 删除确认 */}
      <Dialog
        open={!!deletingOrder}
        onOpenChange={(o) => !o && setDeletingOrder(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除订单？</DialogTitle>
            <DialogDescription>
              将永久删除订单 {deletingOrder?.orderNo}。
              已通过链接上传的图片与选择结果将一并清空，且无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingOrder(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 链接对话框 */}
      <Dialog
        open={!!linkDialog}
        onOpenChange={(o) => !o && setLinkDialog(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>用户访问链接</DialogTitle>
            <DialogDescription>
              {linkDialog?.recipientName
                ? `将此链接发送给用户「${linkDialog.recipientName}」。`
                : "将此链接发送给用户。"}
              链接包含订单号与访问令牌，用户端不会看到提示词内容。
            </DialogDescription>
          </DialogHeader>
          {linkDialog && (
            <div className="space-y-3 py-2">
              <div className="space-y-1 rounded-md border bg-slate-50 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">订单号</span>
                  <span className="font-mono">{linkDialog.orderNo}</span>
                </div>
                {linkDialog.recipientName && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">用户昵称</span>
                    <span>{linkDialog.recipientName}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">模板</span>
                  <span>{linkDialog.template.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">状态</span>
                  <Badge
                    className={`${ORDER_STATUS_COLORS[linkDialog.status as OrderStatus]} border-0`}
                  >
                    {ORDER_STATUS_LABELS[linkDialog.status as OrderStatus]}
                  </Badge>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  访问链接
                </label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={buildLink(linkDialog)}
                    className="font-mono text-xs"
                  />
                  <Button
                    onClick={() => handleCopyLink(linkDialog)}
                    className="shrink-0"
                  >
                    {copied ? (
                      <>
                        <Check className="mr-1 h-4 w-4" /> 已复制
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1 h-4 w-4" /> 复制
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <p className="mb-1 font-medium">提示</p>
                <ul className="list-inside list-disc space-y-0.5">
                  <li>用户通过此链接上传图片，每张原图独立生成一组效果图</li>
                  <li>用户端不会看到提示词内容，只能看到模板描述</li>
                  <li>用户需为每张原图各选一张候选后提交，提交后只允许取消</li>
                  <li>链接中包含 token，请勿泄露给非指定用户</li>
                </ul>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 详情对话框 */}
      <Dialog
        open={!!detailDialog}
        onOpenChange={(o) => !o && setDetailDialog(null)}
      >
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>订单详情</DialogTitle>
            <DialogDescription>
              订单 {detailDialog?.orderNo}
              {detailDialog?.recipientName &&
                ` · 用户「${detailDialog.recipientName}」`}
              · 每张原图独立生成一组效果图。
            </DialogDescription>
          </DialogHeader>
          {detailDialog && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-y-1.5 rounded-md border bg-slate-50 p-3 text-xs">
                <div>
                  <span className="text-muted-foreground">订单号：</span>
                  <span className="font-mono">{detailDialog.orderNo}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">状态：</span>
                  <Badge
                    className={`${ORDER_STATUS_COLORS[detailDialog.status as OrderStatus]} ml-1 border-0`}
                  >
                    {ORDER_STATUS_LABELS[detailDialog.status as OrderStatus]}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">模板：</span>
                  {detailDialog.template.name}
                </div>
                <div>
                  <span className="text-muted-foreground">上传图片数量：</span>
                  {detailDialog.uploadedImageCount ?? 0} /{" "}
                  {detailDialog.uploadCount} 张
                  {(detailDialog.uploadedImageCount ?? 0) > 0 &&
                  (detailDialog.uploadedImageCount ?? 0) <
                    detailDialog.uploadCount ? (
                    <span className="ml-1 text-xs text-amber-600">
                      （渐进式上传，未满额）
                    </span>
                  ) : null}
                </div>
                <div>
                  <span className="text-muted-foreground">每组候选数：</span>
                  {detailDialog.template.candidateCount} 张（拼接成 1 张宫格图）
                </div>
                <div>
                  <span className="text-muted-foreground">已选择：</span>
                  {detailDialog.selectionCount ?? 0} /{" "}
                  {detailDialog.uploadedImageCount ?? 0} 张
                </div>
                {detailDialog.uploadedAt && (
                  <div className="flex items-center gap-1">
                    <Upload className="h-3 w-3 text-emerald-600" />
                    <span className="text-muted-foreground">上传时间：</span>
                    {new Date(detailDialog.uploadedAt).toLocaleString("zh-CN")}
                  </div>
                )}
                {detailDialog.generatedAt && (
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3 text-amber-600" />
                    <span className="text-muted-foreground">生成完成：</span>
                    {new Date(detailDialog.generatedAt).toLocaleString("zh-CN")}
                  </div>
                )}
                {detailDialog.selectedAt && (
                  <div className="flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    <span className="text-muted-foreground">用户提交：</span>
                    {new Date(detailDialog.selectedAt).toLocaleString("zh-CN")}
                  </div>
                )}
                {detailDialog.cancelledAt && (
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">取消时间：</span>
                    {new Date(detailDialog.cancelledAt).toLocaleString("zh-CN")}
                  </div>
                )}
                {detailDialog.errorMessage && (
                  <div className="col-span-2 text-red-600">
                    <span className="text-muted-foreground">错误：</span>
                    {detailDialog.errorMessage}
                  </div>
                )}
              </div>

              {detailDialog.hasUploadedImage &&
                (detailDialog.uploadedImageCount ?? 0) > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <ImageIcon className="h-4 w-4 text-emerald-600" />
                      <h4 className="text-sm font-medium">
                        每张原图的效果图（{detailDialog.uploadedImageCount}{" "}
                        张原图，每张 {detailDialog.template.candidateCount}{" "}
                        个候选，存为 1 张宫格图）
                      </h4>
                    </div>
                    <div className="space-y-3">
                      {Array.from({
                        length: detailDialog.uploadedImageCount ?? 0,
                      }).map((_, imgIdx) => {
                        const selIdx =
                          detailDialog.selections?.[imgIdx] ?? null;
                        const candCount = detailDialog.template.candidateCount;
                        return (
                          <div
                            key={imgIdx}
                            className={`rounded-lg border p-3 ${
                              selIdx !== null
                                ? "border-emerald-300 bg-emerald-50/30"
                                : "border-slate-200"
                            }`}
                          >
                            <div className="mb-2 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium">
                                  第 {imgIdx + 1} 张原图
                                </span>
                                {selIdx !== null ? (
                                  <Badge className="border-0 bg-emerald-100 text-[10px] text-emerald-700 hover:bg-emerald-100">
                                    <CheckCircle2 className="mr-0.5 h-3 w-3" />{" "}
                                    用户已选 #{selIdx + 1}
                                  </Badge>
                                ) : (
                                  <Badge className="border-0 bg-slate-100 text-[10px] text-slate-500 hover:bg-slate-100">
                                    未选择
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <div className="group/preview relative aspect-square cursor-pointer overflow-hidden rounded-md border border-emerald-200 bg-slate-100">
                                <img
                                  src={`/api/orders/${detailDialog.token}/image?index=${imgIdx}`}
                                  alt={`原图 ${imgIdx + 1}`}
                                  className="h-full w-full object-cover transition-transform group-hover/preview:scale-105"
                                  loading="lazy"
                                  onClick={() =>
                                    setLightbox({
                                      url: `/api/orders/${detailDialog.token}/image?index=${imgIdx}`,
                                      title: `第 ${imgIdx + 1} 张原图`,
                                      filename: `${detailDialog.orderNo ?? detailDialog.token}-original-${imgIdx + 1}.png`,
                                    })
                                  }
                                />
                                <div className="absolute top-1 left-1 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] text-white">
                                  原图
                                </div>
                                {/* hover 时显示放大 + 下载按钮 */}
                                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-all group-hover/preview:bg-black/40 group-hover/preview:opacity-100">
                                  <button
                                    type="button"
                                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/90 text-zinc-700 transition-colors hover:bg-white"
                                    aria-label="放大查看原图"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setLightbox({
                                        url: `/api/orders/${detailDialog.token}/image?index=${imgIdx}`,
                                        title: `第 ${imgIdx + 1} 张原图`,
                                        filename: `${detailDialog.orderNo ?? detailDialog.token}-original-${imgIdx + 1}.png`,
                                      });
                                    }}
                                  >
                                    <Maximize2 className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/90 text-zinc-700 transition-colors hover:bg-white"
                                    aria-label="下载原图"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void handleDownload(
                                        `/api/orders/${detailDialog.token}/image?index=${imgIdx}`,
                                        `${detailDialog.orderNo ?? detailDialog.token}-original-${imgIdx + 1}.png`
                                      );
                                    }}
                                  >
                                    <Download className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                              {/* 宫格模式：实际只存 1 张拼接图，candidates[imgIdx][0]，
                                  用 CSS 网格叠层画格子分割 + 选中高亮，避免误以为是多张独立候选 */}
                              {(() => {
                                const cols =
                                  candCount === 1
                                    ? 1
                                    : candCount === 2
                                      ? 2
                                      : candCount === 4
                                        ? 2
                                        : 3;
                                const rows =
                                  candCount === 1
                                    ? 1
                                    : candCount === 2
                                      ? 1
                                      : candCount === 4
                                        ? 2
                                        : 3;
                                return (
                                  <div className="group/preview relative aspect-square cursor-pointer overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                                    {selIdx !== null ? (
                                      // 用户已选：显示该格子对应的高清裁剪图
                                      (() => {
                                        const col = selIdx % cols;
                                        const row = Math.floor(selIdx / cols);
                                        return (
                                          <div
                                            className="absolute inset-0 transition-transform group-hover/preview:scale-105"
                                            style={{
                                              backgroundImage: `url(/api/orders/${detailDialog.token}/candidates/${imgIdx}/0)`,
                                              backgroundSize: `${cols * 100}% ${rows * 100}%`,
                                              backgroundRepeat: "no-repeat",
                                              backgroundPosition:
                                                cols > 1
                                                  ? `${(col / (cols - 1)) * 100}% ${row > 0 ? (row / (rows - 1)) * 100 : 0}%`
                                                  : "0 0",
                                            }}
                                            onClick={() =>
                                              setLightbox({
                                                url: `/api/orders/${detailDialog.token}/candidates/${imgIdx}/0`,
                                                title: `第 ${imgIdx + 1} 张原图 - 已选分镜 #${selIdx + 1}`,
                                                filename: `${detailDialog.orderNo ?? detailDialog.token}-composite-${imgIdx + 1}-q${selIdx + 1}.png`,
                                              })
                                            }
                                          >
                                            <span className="pointer-events-none absolute top-1 left-1 rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
                                              分镜 #{selIdx + 1}
                                            </span>
                                            <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                                              已选
                                            </span>
                                          </div>
                                        );
                                      })()
                                    ) : (
                                      // 用户未选：占位提示
                                      <div className="flex h-full w-full flex-col items-center justify-center text-slate-400">
                                        <Eye className="mb-1 h-6 w-6" />
                                        <span className="text-xs">用户尚未选择</span>
                                      </div>
                                    )}
                                    {/* hover 浮层：放大 / 下载按钮（仅已选时可用） */}
                                    {selIdx !== null && (
                                      <div className="absolute inset-0 z-20 flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-all group-hover/preview:bg-black/40 group-hover/preview:opacity-100">
                                        <button
                                          type="button"
                                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/90 text-zinc-700 transition-colors hover:bg-white"
                                          aria-label="放大查看选中分镜"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setLightbox({
                                              url: `/api/orders/${detailDialog.token}/candidates/${imgIdx}/0`,
                                              title: `第 ${imgIdx + 1} 张原图 - 已选分镜 #${selIdx + 1}`,
                                              filename: `${detailDialog.orderNo ?? detailDialog.token}-composite-${imgIdx + 1}-q${selIdx + 1}.png`,
                                            });
                                          }}
                                        >
                                          <Maximize2 className="h-4 w-4" />
                                        </button>
                                        <button
                                          type="button"
                                          className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/90 text-zinc-700 transition-colors hover:bg-white"
                                          aria-label="下载选中分镜"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleDownload(
                                              `/api/orders/${detailDialog.token}/candidates/${imgIdx}/0`,
                                              `${detailDialog.orderNo ?? detailDialog.token}-composite-${imgIdx + 1}-q${selIdx + 1}.png`
                                            );
                                          }}
                                        >
                                          <Download className="h-4 w-4" />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              {!detailDialog.hasUploadedImage && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  用户尚未上传图片，无详情可查看。
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 图片放大预览（点击原图/候选宫格图触发） */}
      <Dialog open={!!lightbox} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-h-[95vh] max-w-[95vw] border-0 p-0 sm:max-w-[95vw]">
          <div className="relative flex max-h-[95vh] flex-col bg-zinc-950">
            <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
              <span className="truncate font-medium text-sm text-white">
                {lightbox?.title}
              </span>
              <div className="flex items-center gap-2">
                {lightbox && (
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-white text-xs transition-colors hover:bg-white/20"
                    onClick={() =>
                      void handleDownload(lightbox.url, lightbox.filename)
                    }
                  >
                    <Download className="h-3.5 w-3.5" />
                    下载
                  </button>
                )}
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10 text-white transition-colors hover:bg-white/20"
                  aria-label="关闭"
                  onClick={() => setLightbox(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {lightbox && (
              <div className="flex flex-1 items-center justify-center overflow-auto p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {/* biome-ignore lint/performance/noImgElement: 外部 R2 公开域 */}
                <img
                  src={lightbox.url}
                  alt={lightbox.title}
                  className="max-h-[85vh] max-w-full object-contain"
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
