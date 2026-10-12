import { Badge } from "antd";
import { desc, eq } from "drizzle-orm";
import { Plus, Ticket } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { ticket } from "@/db/schema";
import {
  ticketCategories,
  ticketPriorities,
  ticketStatuses,
} from "@/features/support/schemas";
import { getServerSession } from "@/lib/auth/server";

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
 * 用户工单列表页面
 *
 * 展示用户提交的所有支持工单
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 2.7）
 * - shadcn Badge 切到 antd Badge（color prop）
 * - shadcn Card 切到内联 div（保留 hover + rounded-lg + border + transition）
 * - shadcn Button 切到 antd Button（Link 包裹仍是 a，按钮 hit 区保留）
 */
export default async function SupportPage() {
  // 获取当前用户会话
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in");
  }

  // 获取用户的工单列表
  const tickets = await db
    .select()
    .from(ticket)
    .where(eq(ticket.userId, session.user.id))
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

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">支持中心</h2>
          <p className="text-muted-foreground">查看和管理您的支持工单</p>
        </div>
        <Link href="/dashboard/support/new">
          <span className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-4 py-2 cursor-pointer">
            <Plus className="h-4 w-4" />
            新建工单
          </span>
        </Link>
      </div>

      {/* 工单列表 */}
      {tickets.length === 0 ? (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col items-center justify-center py-12 p-6">
            <Ticket className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">暂无工单</h3>
            <p className="text-muted-foreground mb-4">
              您还没有提交过任何支持工单
            </p>
            <Link href="/dashboard/support/new">
              <span className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium bg-primary text-primary-foreground shadow hover:bg-primary/90 h-10 px-4 py-2 cursor-pointer">
                <Plus className="h-4 w-4" />
                创建第一个工单
              </span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {tickets.map((t) => (
            <Link key={t.id} href={`/dashboard/support/${t.id}`}>
              <div className="rounded-lg border bg-card text-card-foreground shadow-sm hover:bg-muted/50 transition-colors cursor-pointer">
                <div className="p-6 pb-2">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h3 className="text-base font-semibold leading-none tracking-tight">
                        {t.subject}
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        {getCategoryLabel(t.category)} ·{" "}
                        {new Date(t.createdAt).toLocaleDateString("zh-CN")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {getPriorityBadge(t.priority)}
                      {getStatusBadge(t.status)}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
