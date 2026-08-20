"use client";

/**
 * 新建工单页面
 *
 * 用户填写表单创建新的支持工单
 *
 * 2026-08-20：shadcn → antd 迁移（Phase 2.7）
 * - shadcn Button/Card/Input/Label/Select/Textarea 切到 antd
 * - toast 切到 App.useApp().message
 */

import { App, Button, Input, Select } from "antd";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createTicketAction } from "@/features/support/actions";
import { ticketCategories, ticketPriorities } from "@/features/support/schemas";

type TicketCategory = "billing" | "technical" | "bug" | "feature" | "other";

type TicketPriority = "low" | "medium" | "high";

export default function NewTicketPage() {
  const router = useRouter();
  const { message } = App.useApp();
  const [isLoading, setIsLoading] = useState(false);

  // 表单状态
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("other");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [msg, setMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const result = await createTicketAction({
        subject,
        category,
        priority,
        message: msg,
      });

      if (result?.data) {
        message.success("工单创建成功");
        router.push(`/dashboard/support/${result.data.ticketId}`);
      } else if (result?.serverError) {
        message.error(result.serverError);
      }
    } catch (error) {
      message.error("创建工单失败，请重试");
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

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
        <div>
          <h2 className="text-2xl font-bold tracking-tight">新建工单</h2>
          <p className="text-muted-foreground">
            描述您遇到的问题，我们会尽快回复
          </p>
        </div>
      </div>

      {/* 工单表单 */}
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6">
          <h3 className="text-lg leading-none font-semibold tracking-tight">
            工单信息
          </h3>
        </div>
        <div className="p-6 pt-0">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 主题 */}
            <div className="space-y-2">
              <label
                htmlFor="subject"
                className="text-sm font-medium leading-none"
              >
                主题 *
              </label>
              <Input
                id="subject"
                placeholder="简要描述您的问题"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                minLength={5}
                maxLength={200}
              />
            </div>

            {/* 类别和优先级 */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="category"
                  className="text-sm font-medium leading-none"
                >
                  类别
                </label>
                <Select
                  id="category"
                  value={category}
                  onChange={(v) => setCategory(v as TicketCategory)}
                  className="w-full"
                  options={ticketCategories.map((cat) => ({
                    value: cat.value,
                    label: cat.label,
                  }))}
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="priority"
                  className="text-sm font-medium leading-none"
                >
                  优先级
                </label>
                <Select
                  id="priority"
                  value={priority}
                  onChange={(v) => setPriority(v as TicketPriority)}
                  className="w-full"
                  options={ticketPriorities.map((pri) => ({
                    value: pri.value,
                    label: pri.label,
                  }))}
                />
              </div>
            </div>

            {/* 详细描述 */}
            <div className="space-y-2">
              <label
                htmlFor="message"
                className="text-sm font-medium leading-none"
              >
                详细描述 *
              </label>
              <Input.TextArea
                id="message"
                placeholder={`请详细描述您遇到的问题，包括：\n- 问题发生的时间\n- 具体的错误信息\n- 您已尝试的解决方法`}
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                minLength={10}
                maxLength={5000}
                rows={8}
              />
              <p className="text-xs text-muted-foreground">
                {msg.length}/5000 字符
              </p>
            </div>

            {/* 提交按钮 */}
            <div className="flex justify-end gap-4">
              <Link href="/dashboard/support">
                <Button type="default">取消</Button>
              </Link>
              <Button type="primary" htmlType="submit" loading={isLoading}>
                提交工单
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
