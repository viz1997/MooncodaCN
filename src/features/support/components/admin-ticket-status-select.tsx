"use client";

/**
 * 管理员工单状态选择组件
 *
 * 管理员可以通过此组件修改工单状态
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 2.5）
 * - shadcn Select/Badge 切到 antd
 * - toast 切到 App.useApp().message
 * - 加载中显示 spinner + 文案（不再渲染 Select）
 */

import { App, Badge, Select } from "antd";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { updateTicketStatusAction } from "@/features/support/actions";
import { ticketStatuses } from "@/features/support/schemas";

interface AdminTicketStatusSelectProps {
  /** 工单 ID */
  ticketId: string;
  /** 当前状态 */
  currentStatus: "open" | "in_progress" | "resolved" | "closed";
}

type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

/**
 * 状态 → antd Badge color
 */
const STATUS_COLOR_MAP: Record<TicketStatus, string> = {
  open: "blue",
  in_progress: "gold",
  resolved: "green",
  closed: "default",
};

export function AdminTicketStatusSelect({
  ticketId,
  currentStatus,
}: AdminTicketStatusSelectProps) {
  const router = useRouter();
  const t = useTranslations("Support");
  const { message } = App.useApp();
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<TicketStatus>(currentStatus);

  const getStatusLabel = (s: string) => {
    const statusConfig = ticketStatuses.find((item) => item.value === s);
    return statusConfig?.label || s;
  };

  const renderBadge = (value: TicketStatus) => (
    <Badge color={STATUS_COLOR_MAP[value]} className="!text-xs">
      {getStatusLabel(value)}
    </Badge>
  );

  const handleStatusChange = async (newStatus: string) => {
    if (newStatus === status) return;

    setIsLoading(true);

    try {
      const result = await updateTicketStatusAction({
        ticketId,
        status: newStatus as TicketStatus,
      });

      if (result?.data) {
        message.success(result.data.message);
        setStatus(newStatus as TicketStatus);
        router.refresh();
      } else if (result?.serverError) {
        message.error(result.serverError);
      }
    } catch (error) {
      message.error(t("statusUpdateFailed"));
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
        {t("updating")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{t("selectNewStatus")}</p>
      <Select
        value={status}
        onChange={handleStatusChange}
        className="w-full"
        options={ticketStatuses.map((s) => ({
          value: s.value,
          label: renderBadge(s.value as TicketStatus),
        }))}
        labelRender={(props) => renderBadge(props.value as TicketStatus)}
      />
    </div>
  );
}
