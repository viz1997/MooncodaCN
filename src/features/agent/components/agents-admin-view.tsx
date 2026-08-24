"use client";

/**
 * 代理商管理 - Admin 视图
 *
 * 仿 src/features/image-gen/admin/components/product-lines-admin-view.tsx 结构：
 * - 顶部标题 + 新建按钮
 * - 3 张统计卡片（总数 / 启用 / 停用）
 * - 搜索框
 * - 表格（ID 短 / 名称 / 联系人 / 电话 / 邮箱 / 状态 / 操作）
 * - 操作：编辑 / 启停 toggle（不暴露硬删除，详见 schema 注释）
 * - 单一 AgentFormDialog 组件承担创建 + 编辑两种 mode
 *
 * 2026-08-23：shadcn → antd 风格（Modal + Input + App.useApp().message），
 * 与 mooncada Phase 3.1 迁移保持一致。
 */

import { App, Badge, Button, Empty, Input, Switch, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ExternalLink, Plus, Search, ShoppingBag, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Agent } from "@/db/schema";
import {
  listAgentsAdminAction,
  setAgentActiveAdminAction,
} from "@/features/agent/actions/agents";
import {
  EmptyState,
  ModuleHeader,
} from "@/features/mooncada/components/shared";

import { AgentFormDialog } from "./agent-form-dialog";

/** 列表行类型：Agent + 订单数聚合 */
type AgentRow = Agent & { orderCount: number };

export function AgentsAdminView() {
  const { message } = App.useApp();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"create" | "edit">("create");
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const loadAgents = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await listAgentsAdminAction();
      if (result?.data?.agents) {
        setAgents(result.data.agents);
      }
    } catch (error) {
      console.error("[AgentsAdminView] 加载代理商列表失败：", error);
      message.error("加载代理商列表失败");
    } finally {
      setIsLoading(false);
    }
  }, [message]);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  const stats = useMemo(
    () => ({
      total: agents.length,
      active: agents.filter((a) => a.isActive).length,
      inactive: agents.filter((a) => !a.isActive).length,
    }),
    [agents]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        (a.contact ?? "").toLowerCase().includes(q) ||
        (a.phone ?? "").toLowerCase().includes(q) ||
        (a.email ?? "").toLowerCase().includes(q)
    );
  }, [agents, search]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  const handleCreate = () => {
    setDialogMode("create");
    setEditingAgent(null);
    setDialogOpen(true);
  };

  const handleEdit = (a: Agent) => {
    setDialogMode("edit");
    setEditingAgent(a);
    setDialogOpen(true);
  };

  /**
   * 跳到订单管理列表，过滤到当前代理商。
   * agentId / agentName 都用 query string 传，前端订单列表直接读取渲染提示。
   */
  const handleViewOrders = (a: Agent) => {
    const params = new URLSearchParams({
      agentId: a.id,
      agentName: a.name,
    });
    window.location.href = `/dashboard/prompt-orders?${params.toString()}`;
  };

  const handleToggleActive = async (a: Agent, next: boolean) => {
    try {
      const result = await setAgentActiveAdminAction({
        id: a.id,
        isActive: next,
      });
      if (result?.data) {
        message.success(next ? "已启用" : "已停用");
        loadAgents();
      } else if (result?.serverError) {
        message.error(result.serverError);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "操作失败";
      message.error(msg);
    }
  };

  const columns: ColumnsType<AgentRow> = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 180,
      render: (id: string) => (
        <span className="font-mono text-[11px] text-muted-foreground">
          {id}
        </span>
      ),
    },
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      render: (name: string, record: AgentRow) => (
        <div className="space-y-0.5">
          <span className="font-medium">{name}</span>
          {record.remark && (
            <p className="text-[11px] text-muted-foreground line-clamp-1">
              {record.remark}
            </p>
          )}
        </div>
      ),
    },
    {
      title: "联系人",
      dataIndex: "contact",
      key: "contact",
      width: 120,
      render: (v: string | null) =>
        v ? (
          <span className="text-xs">{v}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      title: "电话",
      dataIndex: "phone",
      key: "phone",
      width: 140,
      render: (v: string | null) =>
        v ? (
          <span className="font-mono text-xs">{v}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      title: "邮箱",
      dataIndex: "email",
      key: "email",
      render: (v: string | null) =>
        v ? (
          <span className="text-xs text-muted-foreground">{v}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      title: "订单数",
      dataIndex: "orderCount",
      key: "orderCount",
      width: 90,
      render: (n: number, record: AgentRow) =>
        n > 0 ? (
          <Button
            type="link"
            size="small"
            className="!px-0 !h-auto text-violet-700"
            onClick={() => handleViewOrders(record)}
            icon={<ShoppingBag className="h-3 w-3" />}
            title={`查看该代理商的 ${n} 个订单`}
          >
            {n}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">0</span>
        ),
    },
    {
      title: "状态",
      dataIndex: "isActive",
      key: "isActive",
      width: 100,
      render: (isActive: boolean) =>
        isActive ? (
          <Badge color="green" className="!text-[10px]">
            启用
          </Badge>
        ) : (
          <Badge color="default" className="!text-[10px]">
            已停用
          </Badge>
        ),
    },
    {
      title: "操作",
      key: "actions",
      width: 200,
      render: (_: unknown, record: AgentRow) => (
        <div className="flex items-center gap-2">
          <Button
            size="small"
            type="default"
            onClick={() => handleEdit(record)}
          >
            编辑
          </Button>
          <Button
            size="small"
            type="text"
            onClick={() => handleViewOrders(record)}
            title="跳到订单列表查看该代理商的全部订单"
            icon={<ExternalLink className="h-3.5 w-3.5" />}
          >
            订单
          </Button>
          <Switch
            size="small"
            checked={record.isActive}
            onChange={(checked) => handleToggleActive(record, checked)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="代理商管理"
        description="管理 ToB 代理商档案 · 代理商订单绑定 + 启停状态控制 · 停用后历史订单仍保留（FK set null）"
        actions={
          <Button
            type="primary"
            onClick={handleCreate}
            icon={<Plus className="h-4 w-4" />}
          >
            新建代理商
          </Button>
        }
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard label="代理商总数" value={stats.total} tone="violet" />
        <StatCard label="启用中" value={stats.active} tone="emerald" />
        <StatCard label="已停用" value={stats.inactive} tone="slate" />
      </div>

      {/* 搜索栏 */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="p-4">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col sm:flex-row gap-3"
          >
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索名称 / ID / 联系人 / 电话 / 邮箱..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="!pl-9"
                allowClear
                onClear={() => {
                  setSearchInput("");
                  setSearch("");
                }}
              />
            </div>
            <Button type="primary" htmlType="submit">
              搜索
            </Button>
            {search && (
              <Button
                type="default"
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                }}
              >
                清除
              </Button>
            )}
          </form>
        </div>
      </div>

      {/* 代理商列表 */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm overflow-hidden">
        <Table<AgentRow>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={isLoading}
          size="middle"
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => `共 ${total} 个代理商`,
          }}
          locale={{
            emptyText: search ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="没有找到匹配的代理商"
              />
            ) : (
              <EmptyState
                icon={Users}
                title="还没有代理商"
                description="点击右上角「新建代理商」开始添加"
              />
            ),
          }}
        />
      </div>

      {/* 创建 / 编辑对话框 */}
      <AgentFormDialog
        open={dialogOpen}
        mode={dialogMode}
        agent={editingAgent}
        onOpenChange={setDialogOpen}
        onSaved={loadAgents}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "violet" | "emerald" | "slate";
}) {
  const toneClass: Record<typeof tone, string> = {
    violet: "text-violet-600 bg-violet-500/10",
    emerald: "text-emerald-600 bg-emerald-500/10",
    slate: "text-slate-500 bg-slate-500/10",
  };
  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] text-muted-foreground">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
        <div className={`rounded-lg p-2 ${toneClass[tone]}`}>
          <Users className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}
