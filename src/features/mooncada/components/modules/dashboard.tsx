"use client";

import {
  Box,
  CheckCircle2,
  Clock,
  DollarSign,
  Image as ImageIcon,
  ListChecks,
  Palette,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WorkflowAnalysisTrigger } from "@/features/mooncada/components/agent/workflow-analysis";
import {
  formatCurrency,
  formatDate,
  ModuleHeader,
  StatCard,
} from "@/features/mooncada/components/shared";
import {
  MOCK_DASHBOARD_STATS,
  MOCK_ORDERS,
  MOCK_TASKS,
} from "@/features/mooncada/lib/mock-data";
import type { TaskStatus } from "@/features/mooncada/lib/types";
import {
  TASK_STATUS_COLORS,
  TASK_STATUS_LABELS,
} from "@/features/mooncada/lib/types";

const PIE_COLORS = [
  "#10b981",
  "#0ea5e9",
  "#8b5cf6",
  "#f59e0b",
  "#ef4444",
  "#64748b",
];

export function DashboardModule() {
  const stats = MOCK_DASHBOARD_STATS;
  const recentTasks = MOCK_TASKS.slice(0, 5);
  const recentOrders = MOCK_ORDERS.slice(0, 5);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="工作台"
        description="Mooncada 3D 打印定制平台 · 数据概览与最新动态"
      />

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Users}
          label="注册用户"
          value={stats.totalUsers.toLocaleString("zh-CN")}
          trend="12.5%"
          trendUp
          accent="emerald"
        />
        <StatCard
          icon={ShoppingCart}
          label="累计订单"
          value={stats.totalOrders.toLocaleString("zh-CN")}
          trend="8.2%"
          trendUp
          accent="sky"
        />
        <StatCard
          icon={DollarSign}
          label="累计收入"
          value={formatCurrency(stats.totalRevenue)}
          trend="15.3%"
          trendUp
          accent="teal"
        />
        <StatCard
          icon={Box}
          label="3D模型"
          value={stats.totalModels.toLocaleString("zh-CN")}
          trend="6.7%"
          trendUp
          accent="violet"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Clock}
          label="待办任务"
          value={stats.pendingTasks}
          accent="amber"
        />
        <StatCard
          icon={CheckCircle2}
          label="已完成任务"
          value={stats.completedTasks.toLocaleString("zh-CN")}
          accent="emerald"
        />
        <StatCard
          icon={Palette}
          label="活跃设计师"
          value={stats.activeDesigners}
          accent="violet"
        />
        <StatCard
          icon={ImageIcon}
          label="用户图片"
          value={stats.totalPhotos.toLocaleString("zh-CN")}
          accent="sky"
        />
      </div>

      {/* 图表区 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 收入趋势 */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  收入趋势（近14天）
                </CardTitle>
                <CardDescription className="text-xs">
                  日均收入 ¥
                  {Math.round(
                    stats.revenueTrend.reduce((s, d) => s + d.value, 0) /
                      stats.revenueTrend.length
                  ).toLocaleString("zh-CN")}
                </CardDescription>
              </div>
              <Badge
                variant="outline"
                className="text-emerald-600 border-emerald-500/30"
              >
                +15.3%
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart
                data={stats.revenueTrend}
                margin={{ left: -20, right: 8, top: 8 }}
              >
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#e5e7eb"
                  className="dark:stroke-zinc-800"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  stroke="#9ca3af"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="#9ca3af"
                  tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [formatCurrency(v), "收入"]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#revGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* 任务状态分布 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">任务状态分布</CardTitle>
            <CardDescription className="text-xs">
              共 {stats.taskStatusDist.reduce((s, d) => s + d.count, 0)} 个任务
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={stats.taskStatusDist}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                >
                  {stats.taskStatusDist.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-2">
              {stats.taskStatusDist.map((d, i) => (
                <div
                  key={d.status}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                      }}
                    />
                    {d.label}
                  </span>
                  <span className="font-medium">{d.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 订单趋势 + 订单状态 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">订单趋势（近14天）</CardTitle>
            <CardDescription className="text-xs">
              日均订单{" "}
              {Math.round(
                stats.orderTrend.reduce((s, d) => s + d.value, 0) /
                  stats.orderTrend.length
              )}{" "}
              单
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart
                data={stats.orderTrend}
                margin={{ left: -20, right: 8, top: 8 }}
              >
                <defs>
                  <linearGradient id="ordGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="#e5e7eb"
                  className="dark:stroke-zinc-800"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  stroke="#9ca3af"
                />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    fontSize: 12,
                  }}
                  formatter={(v: number) => [`${v} 单`, "订单"]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  fill="url(#ordGrad)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">订单状态</CardTitle>
            <CardDescription className="text-xs">订单分布情况</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={stats.orderStatusDist}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  paddingAngle={1}
                >
                  {stats.orderStatusDist.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* AI 智能工作流入口 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-violet-600" />
            AI 智能工作流
          </CardTitle>
          <CardDescription className="text-xs">
            Mo 助手可以帮你智能分析平台运营情况，一键生成报告
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <WorkflowAnalysisTrigger analysisType="anomaly_detection" />
            <WorkflowAnalysisTrigger analysisType="task_routing" />
            <WorkflowAnalysisTrigger analysisType="capacity_planning" />
            <WorkflowAnalysisTrigger analysisType="workflow_optimization" />
          </div>
        </CardContent>
      </Card>

      {/* 最新动态 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 最新任务 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4 text-violet-600" />
              最新任务
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-80 overflow-y-auto">
            {recentTasks.map((t) => (
              <div
                key={t.taskId}
                className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {t.taskId} · 订单 {t.orderId}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(t.createdAt, true)} · 截止{" "}
                    {formatDate(t.deadline)}
                  </p>
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${TASK_STATUS_COLORS[t.status as TaskStatus]}`}
                >
                  {TASK_STATUS_LABELS[t.status as TaskStatus]}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* 最新订单 */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="h-4 w-4 text-sky-600" />
              最新订单
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-80 overflow-y-auto">
            {recentOrders.map((o) => (
              <div
                key={o.orderId}
                className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {o.orderId} · {o.items[0]?.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(o.createdAt, true)} · {o.username}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">
                    {formatCurrency(o.totalAmount)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {o.status}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
