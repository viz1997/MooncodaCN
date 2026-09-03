"use client";

/**
 * 2026-09-03：代理商 portal 订单列表视图（ToB 自下单）。
 *
 * 与 admin 的 OrdersAdminView 区别：
 * - 不显示"代理商"列（反正都是自己）
 * - 不显示"平台"列（代理商 portal 不接外部 ToC 平台）
 * - 没有删除 / 编辑按钮（订单一旦创建，模板/token 不能改；需要改业务字段由
 *     admin 后台处理；代理商有"复制链接"自己访问入口）
 * - 没有模板下拉选择器：直接把 AgentOrderFormDialog 暴露为"+ 新建"按钮
 * - 没有"代理商店过滤"（固定只看自己）
 * - 状态/搜索过滤保留
 *
 * fetch 走 /api/orders 公共接口 + agentId=ctx.agentId（与 admin 共用，
 *   但 agentId 在 query 里）。
 */

import { App, Badge, Button, Input, Select } from "antd";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  PackagePlus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { agentListTemplatesAction } from "@/features/agent/actions/agent-portal";
import { formatProductSpec } from "@/features/gpt-image/lib/product-catalog";
import {
  ORDER_STATUS_LABELS,
  type OrderStatus,
  type OrderView,
  type PromptTemplateView,
} from "@/features/gpt-image/lib/types";
import { useRouter } from "@/i18n/routing";
import { useSessionContext } from "@/lib/auth/session-context";

import { AgentOrderFormDialog } from "./agent-order-form-dialog";

export function AgentOrdersView() {
  const { message } = App.useApp();
  const router = useRouter();
  const { user } = useSessionContext();
  const agentId = user?.agentId ?? null;

  const [orders, setOrders] = useState<OrderView[]>([]);
  const [templates, setTemplates] = useState<PromptTemplateView[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const fetchOrders = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoading(true);
      try {
        // 不传 agentId：服务端从 session.user.agentId 读（agentCreateOrderAction
        // 走 agentAction，路由层同理）；admin-style ?agentId 也行但 portal
        // 用户没必要
        const res = await fetch("/api/orders", { credentials: "include" });
        const json = await res.json();
        if (json.success) setOrders(json.data as OrderView[]);
      } catch (e) {
        console.error(e);
        message.error("订单列表加载失败");
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [message]
  );

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const res = await agentListTemplatesAction();
      if (res?.data?.templates) setTemplates(res.data.templates);
      else throw new Error("返回数据格式异常");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "未知错误";
      setTemplatesError(msg);
      message.error(`模板加载失败：${msg}`);
    } finally {
      setTemplatesLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void fetchOrders();
    void fetchTemplates();
  }, [fetchOrders, fetchTemplates]);

  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([fetchOrders({ silent: true }), fetchTemplates()]);
    } finally {
      setRefreshing(false);
    }
  }, [fetchOrders, fetchTemplates, refreshing]);

  const handleCreated = (order: OrderView) => {
    setOrders((prev) => [order, ...prev]);
    // 创建成功后跳转到订单公开链接页（代理商自己上传参考图）
    router.push(`/p/${order.token}`);
  };

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/p/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 1500);
      message.success("链接已复制");
    } catch {
      message.error("复制失败，请手动选择复制");
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (filterStatus !== "ALL" && o.status !== filterStatus) return false;
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      if (
        !o.orderNo.toLowerCase().includes(s) &&
        !(o.recipientName?.toLowerCase().includes(s) ?? false)
      )
        return false;
    }
    return true;
  });

  // agentId 不存在就什么都不显示（layout 已经在路由层挡住，这种兜底
  // 只在组件错被复用时给出可读提示）
  if (!agentId) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
        当前账号未绑定代理商，无法查看。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部：标题 + 新建 + 刷新 */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-violet-900">
            我的订单
          </h2>
          <p className="text-sm text-muted-foreground">
            共 {orders.length} 个订单（只看归属于你的代理商）
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="default"
            onClick={handleRefresh}
            disabled={refreshing}
            icon={<RefreshCw className="h-4 w-4" />}
          >
            {refreshing ? "刷新中…" : "刷新"}
          </Button>
          <Button
            type="primary"
            onClick={() => setDialogOpen(true)}
            icon={<PackagePlus className="h-4 w-4" />}
            className="!bg-violet-600 hover:!bg-violet-700"
          >
            新建订单
          </Button>
        </div>
      </div>

      {/* 过滤行 */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索订单号 / 收件人"
            className="!pl-9"
            allowClear
          />
        </div>
        <Select
          value={filterStatus}
          onChange={(v) => setFilterStatus(v)}
          className="w-36"
          options={[
            { value: "ALL", label: "全部状态" },
            ...Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => ({
              value: k,
              label: v,
            })),
          ]}
        />
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
          加载中…
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">
          {orders.length === 0
            ? "还没有订单。点击右上「新建订单」开始。"
            : "没有符合过滤条件的订单"}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-violet-50/60 text-violet-900">
              <tr className="text-left text-xs font-medium uppercase tracking-wider">
                <th className="px-4 py-3">订单号</th>
                <th className="px-4 py-3">模板</th>
                <th className="px-4 py-3">产品规格</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">已传/总</th>
                <th className="px-4 py-3">创建时间</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((o) => (
                <tr
                  key={o.id}
                  className="border-t hover:bg-violet-50/30 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs font-medium">
                    {o.orderNo}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{o.template.name}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                      {o.template.description}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {formatProductSpec({
                      productTypeCode: o.productTypeCode,
                      productSize: o.productSize,
                      accessoryCode: o.accessoryCode,
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      // 复用 admin 的 ORDER_STATUS_COLORS 通过 lookup
                      // （admin view 用 shadcn className，本组件用 antd color 名）
                      color={
                        (
                          {
                            PENDING: "gold",
                            GENERATING: "cyan",
                            CANDIDATES_READY: "cyan",
                            SELECTED: "purple",
                            CANCELLED: "red",
                            FAILED: "red",
                          } as Record<OrderStatus, string>
                        )[o.status] ?? "default"
                      }
                    >
                      {ORDER_STATUS_LABELS[o.status]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {o.uploadedImageCount} / {o.uploadCount * o.imagesPerUpload}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(o.createdAt).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="text"
                        size="small"
                        onClick={() => copyLink(o.token)}
                        icon={
                          copiedToken === o.token ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )
                        }
                      >
                        {copiedToken === o.token ? "已复制" : "复制链接"}
                      </Button>
                      <Button
                        type="text"
                        size="small"
                        onClick={() => window.open(`/p/${o.token}`, "_blank")}
                        icon={<ExternalLink className="h-4 w-4" />}
                      >
                        打开
                      </Button>
                      <Button
                        type="text"
                        size="small"
                        onClick={() => router.push(`/p/${o.token}`)}
                        icon={<Eye className="h-4 w-4" />}
                      >
                        进入
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AgentOrderFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        templates={templates}
        templatesLoading={templatesLoading}
        templatesError={templatesError}
        onRetryTemplates={fetchTemplates}
        onCreated={handleCreated}
      />
    </div>
  );
}
