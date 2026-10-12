import { Avatar, Badge, Button } from "antd";
import { eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { ticket, ticketMessage, user } from "@/db/schema";
import { AdminTicketReplyForm } from "@/features/support/components/admin-ticket-reply-form";
import { AdminTicketStatusSelect } from "@/features/support/components/admin-ticket-status-select";
import {
  ticketCategories,
  ticketPriorities,
  ticketStatuses,
} from "@/features/support/schemas";

interface AdminTicketDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

const STATUS_COLOR_MAP: Record<string, string> = {
  open: "blue",
  in_progress: "gold",
  resolved: "green",
  closed: "default",
};

const PRIORITY_COLOR_MAP: Record<string, string> = {
  low: "green",
  medium: "gold",
  high: "red",
};

/**
 * 管理员 - 工单详情页面
 *
 * 展示工单信息和消息历史，允许管理员回复和更改状态
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 3.1）
 * - shadcn Avatar/Badge/Button 切到 antd
 * - shadcn Card 切到内联 div
 */
export default async function AdminTicketDetailPage({
  params,
}: AdminTicketDetailPageProps) {
  const { id } = await params;

  // 获取工单信息（包含用户信息）
  const ticketResult = await db
    .select({
      ticket: ticket,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    })
    .from(ticket)
    .leftJoin(user, eq(ticket.userId, user.id))
    .where(eq(ticket.id, id))
    .limit(1);

  const result = ticketResult[0];
  if (!result) {
    notFound();
  }

  const ticketData = result.ticket;
  const ticketUser = result.user;

  // 获取消息列表
  const messages = await db
    .select({
      id: ticketMessage.id,
      content: ticketMessage.content,
      isAdminResponse: ticketMessage.isAdminResponse,
      createdAt: ticketMessage.createdAt,
      user: {
        id: user.id,
        name: user.name,
        image: user.image,
      },
    })
    .from(ticketMessage)
    .leftJoin(user, eq(ticketMessage.userId, user.id))
    .where(eq(ticketMessage.ticketId, id))
    .orderBy(ticketMessage.createdAt);

  const getStatusBadge = (status: string) => {
    const statusConfig = ticketStatuses.find((s) => s.value === status);
    return (
      <Badge color={STATUS_COLOR_MAP[status] ?? "default"} className="!text-xs">
        {statusConfig?.label || status}
      </Badge>
    );
  };

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

  const getCategoryLabel = (category: string) => {
    const categoryConfig = ticketCategories.find((c) => c.value === category);
    return categoryConfig?.label || category;
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center gap-4">
        <Link href="/admin/tickets">
          <Button
            type="text"
            shape="circle"
            icon={<ArrowLeft className="h-4 w-4" />}
          />
        </Link>
        <div className="flex-1">
          <h2 className="text-2xl font-bold tracking-tight">
            {ticketData.subject}
          </h2>
          <p className="text-muted-foreground">
            {getCategoryLabel(ticketData.category)} · 创建于{" "}
            {new Date(ticketData.createdAt).toLocaleDateString("zh-CN")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {getPriorityBadge(ticketData.priority)}
          {getStatusBadge(ticketData.status)}
        </div>
      </div>

      {/* 用户信息和状态管理 */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="text-lg font-semibold leading-none tracking-tight">
              用户信息
            </h3>
          </div>
          <div className="p-6 pt-0">
            <div className="flex items-center gap-4">
              <Avatar
                src={ticketUser?.image || undefined}
                alt={ticketUser?.name || "用户"}
                size={48}
                className="shrink-0 !bg-primary !text-primary-foreground"
              >
                {ticketUser?.name ? getInitials(ticketUser.name) : "U"}
              </Avatar>
              <div>
                <p className="font-medium">{ticketUser?.name || "未知用户"}</p>
                <p className="text-sm text-muted-foreground">
                  {ticketUser?.email}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <h3 className="text-lg font-semibold leading-none tracking-tight">
              工单状态
            </h3>
          </div>
          <div className="p-6 pt-0">
            <AdminTicketStatusSelect
              ticketId={ticketData.id}
              currentStatus={ticketData.status}
            />
          </div>
        </div>
      </div>

      {/* 消息列表 */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6">
          <h3 className="text-lg font-semibold leading-none tracking-tight">
            对话记录
          </h3>
        </div>
        <div className="space-y-4 p-6 pt-0">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-4 p-4 rounded-lg ${
                msg.isAdminResponse
                  ? "bg-blue-50 dark:bg-blue-950/30"
                  : "bg-muted/50"
              }`}
            >
              <Avatar
                src={msg.user?.image || undefined}
                alt={msg.user?.name || "用户"}
                size={40}
                className={
                  msg.isAdminResponse
                    ? "shrink-0 !bg-blue-600 !text-white"
                    : "shrink-0 !bg-primary !text-primary-foreground"
                }
              >
                {msg.user?.name ? getInitials(msg.user.name) : "U"}
              </Avatar>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {msg.user?.name || "用户"}
                  </span>
                  {msg.isAdminResponse && (
                    <Badge color="blue" className="!text-xs">
                      客服
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(msg.createdAt).toLocaleString("zh-CN")}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 管理员回复表单 */}
      <AdminTicketReplyForm
        ticketId={id}
        isClosed={ticketData.status === "closed"}
      />
    </div>
  );
}
