import { Avatar, Badge } from "antd";
import { desc, eq } from "drizzle-orm";
import Link from "next/link";

import { db } from "@/db";
import { ticket, user } from "@/db/schema";
import {
  ticketCategories,
  ticketPriorities,
  ticketStatuses,
} from "@/features/support/schemas";

/**
 * 工单状态 → antd Badge color
 */
const STATUS_COLOR_MAP: Record<string, string> = {
  open: "blue",
  in_progress: "gold",
  resolved: "green",
  closed: "default",
};

/**
 * 优先级 → antd Badge color
 */
const PRIORITY_COLOR_MAP: Record<string, string> = {
  low: "green",
  medium: "gold",
  high: "red",
};

/**
 * 管理员 - 工单管理列表页面
 *
 * 展示所有用户提交的工单
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 3.1）
 * - shadcn Avatar/Badge 切到 antd
 * - shadcn Card 切到内联 div（保留 rounded-lg + border + bg-card + shadow）
 */
export default async function AdminTicketsPage() {
  // 获取所有工单（包含用户信息）
  const tickets = await db
    .select({
      id: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(ticket)
    .leftJoin(user, eq(ticket.userId, user.id))
    .orderBy(desc(ticket.createdAt));

  /**
   * 获取状态徽章
   */
  const getStatusBadge = (status: string) => {
    const statusConfig = ticketStatuses.find((s) => s.value === status);
    return (
      <Badge color={STATUS_COLOR_MAP[status] ?? "default"} className="!text-xs">
        {statusConfig?.label || status}
      </Badge>
    );
  };

  /**
   * 获取优先级徽章
   */
  const getPriorityBadge = (priority: string) => {
    const priorityConfig = ticketPriorities.find((p) => p.value === priority);
    return (
      <Badge
        color={PRIORITY_COLOR_MAP[priority] ?? "default"}
        className="!text-xs"
      >
        {priorityConfig?.label || priority}
      </Badge>
    );
  };

  /**
   * 获取类别标签
   */
  const getCategoryLabel = (category: string) => {
    const categoryConfig = ticketCategories.find((c) => c.value === category);
    return categoryConfig?.label || category;
  };

  /**
   * 获取用户名首字母
   */
  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  // 统计数据
  const openCount = tickets.filter((t) => t.status === "open").length;
  const inProgressCount = tickets.filter(
    (t) => t.status === "in_progress"
  ).length;
  const resolvedCount = tickets.filter((t) => t.status === "resolved").length;

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">工单管理</h2>
        <p className="text-muted-foreground">查看和处理用户提交的支持工单</p>
      </div>

      {/* 统计信息 */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6 pb-2">
            <h3 className="text-sm font-medium">待处理</h3>
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold text-blue-600">{openCount}</div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6 pb-2">
            <h3 className="text-sm font-medium">处理中</h3>
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold text-yellow-600">
              {inProgressCount}
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6 pb-2">
            <h3 className="text-sm font-medium">已解决</h3>
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold text-green-600">
              {resolvedCount}
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6 pb-2">
            <h3 className="text-sm font-medium">总工单</h3>
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold">{tickets.length}</div>
          </div>
        </div>
      </div>

      {/* 工单列表 */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6">
          <h3 className="text-lg font-semibold leading-none tracking-tight">
            工单列表
          </h3>
        </div>
        <div className="p-6 pt-0">
          {tickets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              暂无工单
            </div>
          ) : (
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs uppercase bg-muted/50">
                  <tr>
                    <th className="px-4 py-3">工单主题</th>
                    <th className="px-4 py-3">用户</th>
                    <th className="px-4 py-3">类别</th>
                    <th className="px-4 py-3">优先级</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="px-4 py-3">创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr
                      key={t.id}
                      className="border-b hover:bg-muted/50 cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/tickets/${t.id}`}
                          className="font-medium hover:underline"
                        >
                          {t.subject}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar
                            src={t.user?.image || undefined}
                            alt={t.user?.name || "用户"}
                            size={24}
                            className="shrink-0 !bg-primary !text-primary-foreground !text-xs"
                          >
                            {t.user?.name ? getInitials(t.user.name) : "U"}
                          </Avatar>
                          <div>
                            <div className="font-medium text-sm">
                              {t.user?.name || "未知用户"}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {t.user?.email}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {getCategoryLabel(t.category)}
                      </td>
                      <td className="px-4 py-3">
                        {getPriorityBadge(t.priority)}
                      </td>
                      <td className="px-4 py-3">{getStatusBadge(t.status)}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(t.createdAt).toLocaleDateString("zh-CN")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
