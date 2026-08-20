"use client";

/**
 * 工单消息回复表单组件
 *
 * 用于用户或管理员在工单中添加新消息
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 2.5）
 * - shadcn Card/Button/Textarea 切到 antd
 * - 用 antd Input.TextArea 替代 Textarea
 * - toast 切到 App.useApp().message
 */

import { App, Button, Input } from "antd";
import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { addTicketMessageAction } from "@/features/support/actions";

interface TicketMessageFormProps {
  /** 工单 ID */
  ticketId: string;
  /** 是否为管理员模式 */
  isAdmin?: boolean;
}

export function TicketMessageForm({
  ticketId,
  isAdmin = false,
}: TicketMessageFormProps) {
  const router = useRouter();
  const t = useTranslations("Support");
  const { message } = App.useApp();
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!content.trim()) {
      message.error(t("enterMessage"));
      return;
    }

    setIsLoading(true);

    try {
      const result = await addTicketMessageAction({
        ticketId,
        content: content.trim(),
      });

      if (result?.data) {
        message.success(t("messageSent"));
        setContent("");
        router.refresh();
      } else if (result?.serverError) {
        message.error(result.serverError);
      }
    } catch (error) {
      message.error(t("sendFailed"));
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-col space-y-1.5 p-6">
        <h3 className="text-lg leading-none font-semibold tracking-tight">
          {isAdmin ? t("replyUser") : t("addReply")}
        </h3>
      </div>
      <div className="p-6 pt-0">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input.TextArea
            placeholder={t("inputPlaceholder")}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            maxLength={5000}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {content.length}/5000 {t("characters")}
            </p>
            <Button
              type="primary"
              htmlType="submit"
              loading={isLoading}
              disabled={!content.trim()}
              icon={<Send className="h-4 w-4" />}
            >
              {t("send")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
