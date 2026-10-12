import { Avatar, Badge, Button } from "antd";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { db } from "@/db";
import { ticket, ticketMessage, user } from "@/db/schema";
import { TicketMessageForm } from "@/features/support/components/ticket-message-form";
import {
  ticketCategories,
  ticketPriorities,
  ticketStatuses,
} from "@/features/support/schemas";
import { getServerSession } from "@/lib/auth/server";

interface TicketDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

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
 * 工单详情页面
 *
 * 展示工单信息和消息历史，允许用户回复
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 2.7）
 * - shadcn Avatar 切到 antd Avatar（src + size + className + children）
 * - shadcn Badge 切到 antd Badge（color）
 * - shadcn Button 切到 antd Button（type="text" shape="circle" 替代 ghost+icon）
 * - shadcn Card 切到内联 div
 */
export default async function TicketDetailPage({
  params,
}: TicketDetailPageProps) {
  const { id } = await params;

  // 获取当前用户会话
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in");
  }

  // 获取工单信息
  const ticketResult = await db
    .select()
    .from(ticket)
    .where(and(eq(ticket.id, id), eq(ticket.userId, session.user.id)))
    .limit(1);

  const ticketData = ticketResult[0];
  if (!ticketData) {
    notFound();
  }

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

  const isClosed = ticketData.status === "closed";

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/support">
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

      {/* 消息列表 */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6">
          <h3 className="text-lg leading-none font-semibold tracking-tight">
            对话记录
          </h3>
        </div>
        <div className="p-6 pt-0 space-y-4">
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

      {/* 回复表单 */}
      {isClosed ? (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="p-6 py-6 text-center text-muted-foreground">
            此工单已关闭，无法添加新消息
          </div>
        </div>
      ) : (
        <TicketMessageForm ticketId={id} />
      )}
    </div>
  );
}
