import { count, eq, gte, sum } from "drizzle-orm";
import {
  Coins,
  CreditCard,
  MessageSquare,
  Ticket,
  TrendingUp,
  Users,
} from "lucide-react";

import { db } from "@/db";
import { creditsBalance, subscription, ticket, user } from "@/db/schema";

/**
 * Admin 控制面板页面
 *
 * 展示关键统计数据:
 * - 用户统计
 * - 工单统计
 * - 积分统计
 * - 订阅统计
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 3.1）
 * - shadcn Card 切到内联 div（保留 rounded-lg + border + bg-card + shadow）
 * - 卡片头/卡片内容改成 div 组合，避免 antd Card padding 行为干扰 grid
 */
export default async function AdminDashboardPage() {
  // 获取今天的开始时间
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // 获取本周的开始时间
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);

  // 获取本月的开始时间
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // 并行获取所有统计数据
  const [
    // 用户统计
    totalUsersResult,
    adminUsersResult,
    bannedUsersResult,
    newUsersThisWeekResult,
    // 工单统计
    openTicketsResult,
    inProgressTicketsResult,
    totalTicketsResult,
    newTicketsTodayResult,
    // 积分统计
    totalCreditsResult,
    totalCreditsEarnedResult,
    totalCreditsSpentResult,
    // 订阅统计
    activeSubscriptionsResult,
    totalSubscriptionsResult,
  ] = await Promise.all([
    // 用户统计
    db
      .select({ count: count() })
      .from(user),
    db.select({ count: count() }).from(user).where(eq(user.role, "admin")),
    db.select({ count: count() }).from(user).where(eq(user.banned, true)),
    db
      .select({ count: count() })
      .from(user)
      .where(gte(user.createdAt, weekStart)),

    // 工单统计
    db
      .select({ count: count() })
      .from(ticket)
      .where(eq(ticket.status, "open")),
    db
      .select({ count: count() })
      .from(ticket)
      .where(eq(ticket.status, "in_progress")),
    db.select({ count: count() }).from(ticket),
    db
      .select({ count: count() })
      .from(ticket)
      .where(gte(ticket.createdAt, todayStart)),

    // 积分统计
    db
      .select({ total: sum(creditsBalance.balance) })
      .from(creditsBalance),
    db.select({ total: sum(creditsBalance.totalEarned) }).from(creditsBalance),
    db.select({ total: sum(creditsBalance.totalSpent) }).from(creditsBalance),

    // 订阅统计
    db
      .select({ count: count() })
      .from(subscription)
      .where(eq(subscription.status, "active")),
    db.select({ count: count() }).from(subscription),
  ]);

  // 解析统计结果
  const stats = {
    users: {
      total: totalUsersResult[0]?.count ?? 0,
      admins: adminUsersResult[0]?.count ?? 0,
      banned: bannedUsersResult[0]?.count ?? 0,
      newThisWeek: newUsersThisWeekResult[0]?.count ?? 0,
    },
    tickets: {
      open: openTicketsResult[0]?.count ?? 0,
      inProgress: inProgressTicketsResult[0]?.count ?? 0,
      total: totalTicketsResult[0]?.count ?? 0,
      newToday: newTicketsTodayResult[0]?.count ?? 0,
    },
    credits: {
      totalBalance: Number(totalCreditsResult[0]?.total ?? 0),
      totalEarned: Number(totalCreditsEarnedResult[0]?.total ?? 0),
      totalSpent: Number(totalCreditsSpentResult[0]?.total ?? 0),
    },
    subscriptions: {
      active: activeSubscriptionsResult[0]?.count ?? 0,
      total: totalSubscriptionsResult[0]?.count ?? 0,
    },
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">控制面板</h2>
        <p className="text-muted-foreground">
          欢迎来到管理后台，这里是系统概览。
        </p>
      </div>

      {/* 主要统计卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* 总用户数 */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
            <h3 className="text-sm font-medium">总用户数</h3>
            <Users className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold">{stats.users.total}</div>
            <p className="text-xs text-muted-foreground">
              本周新增 {stats.users.newThisWeek} 位
            </p>
          </div>
        </div>

        {/* 待处理工单 */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
            <h3 className="text-sm font-medium">待处理工单</h3>
            <Ticket className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold text-orange-600">
              {stats.tickets.open + stats.tickets.inProgress}
            </div>
            <p className="text-xs text-muted-foreground">
              今日新增 {stats.tickets.newToday} 个
            </p>
          </div>
        </div>

        {/* 活跃订阅 */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
            <h3 className="text-sm font-medium">活跃订阅</h3>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold text-green-600">
              {stats.subscriptions.active}
            </div>
            <p className="text-xs text-muted-foreground">
              总订阅 {stats.subscriptions.total} 个
            </p>
          </div>
        </div>

        {/* 积分流通量 */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-row items-center justify-between space-y-0 p-6 pb-2">
            <h3 className="text-sm font-medium">积分流通</h3>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="p-6 pt-0">
            <div className="text-2xl font-bold text-yellow-600">
              {stats.credits.totalBalance.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">当前用户持有总积分</p>
          </div>
        </div>
      </div>

      {/* 详细统计 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* 用户详情 */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
              <Users className="h-5 w-5" />
              用户统计
            </h3>
          </div>
          <div className="space-y-3 p-6 pt-0">
            <div className="flex justify-between">
              <span className="text-muted-foreground">总用户</span>
              <span className="font-medium">{stats.users.total}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">管理员</span>
              <span className="font-medium text-blue-600">
                {stats.users.admins}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">普通用户</span>
              <span className="font-medium">
                {stats.users.total - stats.users.admins}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">已封禁</span>
              <span className="font-medium text-red-600">
                {stats.users.banned}
              </span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">本周新增</span>
              <span className="font-medium text-green-600">
                +{stats.users.newThisWeek}
              </span>
            </div>
          </div>
        </div>

        {/* 工单详情 */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
              <MessageSquare className="h-5 w-5" />
              工单统计
            </h3>
          </div>
          <div className="space-y-3 p-6 pt-0">
            <div className="flex justify-between">
              <span className="text-muted-foreground">待处理</span>
              <span className="font-medium text-blue-600">
                {stats.tickets.open}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">处理中</span>
              <span className="font-medium text-yellow-600">
                {stats.tickets.inProgress}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">总工单</span>
              <span className="font-medium">{stats.tickets.total}</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">今日新增</span>
              <span className="font-medium text-orange-600">
                +{stats.tickets.newToday}
              </span>
            </div>
          </div>
        </div>

        {/* 积分详情 */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="flex items-center gap-2 text-lg font-semibold leading-none tracking-tight">
              <TrendingUp className="h-5 w-5" />
              积分流水
            </h3>
          </div>
          <div className="space-y-3 p-6 pt-0">
            <div className="flex justify-between">
              <span className="text-muted-foreground">当前持有</span>
              <span className="font-medium text-yellow-600">
                {stats.credits.totalBalance.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">累计发放</span>
              <span className="font-medium text-green-600">
                +{stats.credits.totalEarned.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">累计消费</span>
              <span className="font-medium text-red-600">
                -{stats.credits.totalSpent.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">订阅用户</span>
              <span className="font-medium">
                {stats.subscriptions.active} 活跃
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 快速操作 */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="text-lg font-semibold leading-none tracking-tight">
              快速操作
            </h3>
          </div>
          <div className="space-y-2 p-6 pt-0">
            <a
              href="/admin/users"
              className="flex items-center gap-2 rounded-md p-2 hover:bg-muted transition-colors"
            >
              <Users className="h-4 w-4" />
              <span>管理用户</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {stats.users.total} 位
              </span>
            </a>
            <a
              href="/admin/tickets"
              className="flex items-center gap-2 rounded-md p-2 hover:bg-muted transition-colors"
            >
              <Ticket className="h-4 w-4" />
              <span>处理工单</span>
              {stats.tickets.open > 0 && (
                <span className="ml-auto rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800">
                  {stats.tickets.open} 待处理
                </span>
              )}
            </a>
          </div>
        </div>

        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="text-lg font-semibold leading-none tracking-tight">
              系统信息
            </h3>
          </div>
          <div className="space-y-2 p-6 pt-0 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">版本</span>
              <span>1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">环境</span>
              <span>{process.env.NODE_ENV}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">数据库</span>
              <span>PostgreSQL</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
