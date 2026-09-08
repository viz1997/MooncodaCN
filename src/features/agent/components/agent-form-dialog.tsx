"use client";

/**
 * 代理商创建/编辑对话框
 *
 * 单一组件同时处理「新建」与「编辑」两种 mode：
 * - mode="create"：name 必填，其余可选，提交后调用 createAgentAdminAction
 * - mode="edit"：所有字段预填，提交后调用 updateAgentAdminAction
 *
 * 客户端表单校验：仅 name 必填；email 走简单正则。
 * 服务端校验在 actions 层再做一遍（next-safe-action schema）。
 *
 * 2026-08-23：shadcn → antd 风格统一（Modal + Input + App.useApp().message）
 *
 * 2026-09-07：edit 模式新增三块：
 * - imageGenToken 显示 + 复制链接按钮
 * - creditBalance 显示 + 充值/扣款按钮（弹出 AgentCreditDialog）
 * - 可服务模板 M2M 编辑（AgentTemplatesSelector）
 */

import { App, Button, Divider, Input, Modal, Tag } from "antd";
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";

import type { Agent } from "@/db/schema";
import {
  type CreateAgentInput,
  createAgentAdminAction,
  type UpdateAgentInput,
  updateAgentAdminAction,
} from "@/features/agent/actions/agents";

import { AgentCreditDialog } from "./agent-credit-dialog";
import { AgentTemplatesSelector } from "./agent-templates-selector";

type Mode = "create" | "edit";

interface AgentFormDialogProps {
  open: boolean;
  mode: Mode;
  agent?: Agent | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

interface FormState {
  name: string;
  contact: string;
  phone: string;
  email: string;
  remark: string;
}

const EMPTY: FormState = {
  name: "",
  contact: "",
  phone: "",
  email: "",
  remark: "",
};

function fromAgent(a: Agent): FormState {
  return {
    name: a.name,
    contact: a.contact ?? "",
    phone: a.phone ?? "",
    email: a.email ?? "",
    remark: a.remark ?? "",
  };
}

export function AgentFormDialog({
  open,
  mode,
  agent,
  onOpenChange,
  onSaved,
}: AgentFormDialogProps) {
  const { message } = App.useApp();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);

  // 打开时重置 / 回填
  useEffect(() => {
    if (!open) return;
    setForm(mode === "edit" && agent ? fromAgent(agent) : EMPTY);
  }, [open, mode, agent]);

  const workbenchUrl =
    agent?.imageGenToken && typeof window !== "undefined"
      ? `${window.location.origin}/p/agent/${agent.imageGenToken}`
      : null;

  const handleCopyLink = async () => {
    if (!workbenchUrl) return;
    try {
      await navigator.clipboard.writeText(workbenchUrl);
      message.success("已复制 workbench 链接");
    } catch {
      message.error("复制失败，请手动选中复制");
    }
  };

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      message.error("请输入代理商名称");
      return;
    }
    if (
      form.email.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())
    ) {
      message.error("请输入有效邮箱");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "create") {
        const payload: CreateAgentInput = {
          name: form.name.trim(),
          contact: form.contact.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          remark: form.remark.trim() || undefined,
        };
        const result = await createAgentAdminAction(payload);
        if (result?.data) {
          message.success("代理商创建成功");
          onSaved();
          onOpenChange(false);
        } else if (result?.serverError) {
          message.error(result.serverError);
        }
      } else {
        if (!agent) {
          message.error("缺少代理商信息");
          return;
        }
        const payload: UpdateAgentInput = {
          id: agent.id,
          name: form.name.trim(),
          contact: form.contact.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          remark: form.remark.trim() || undefined,
        };
        const result = await updateAgentAdminAction(payload);
        if (result?.data) {
          message.success("代理商已更新");
          onSaved();
          onOpenChange(false);
        } else if (result?.serverError) {
          message.error(result.serverError);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "操作失败";
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => !submitting && onOpenChange(false)}
      title={mode === "create" ? "新建代理商" : "编辑代理商"}
      footer={[
        <Button
          key="cancel"
          type="default"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
        >
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          loading={submitting}
          onClick={handleSubmit}
        >
          {mode === "create" ? "创建" : "保存"}
        </Button>,
      ]}
      width={560}
      destroyOnClose
    >
      <p className="mb-4 text-xs text-muted-foreground">
        {mode === "create"
          ? "代理商可绑定到 promptOrder.agentId，用于 ToB 业务订单归因与统计。"
          : "编辑代理商基础信息；启停状态请在列表操作列切换。"}
      </p>
      <div className="space-y-4">
        <div className="space-y-2">
          <label
            htmlFor="agent-name"
            className="text-sm font-medium leading-none"
          >
            代理商名称 <span className="text-red-500">*</span>
          </label>
          <Input
            id="agent-name"
            placeholder="例：杭州漫潮文化"
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            maxLength={100}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <label
              htmlFor="agent-contact"
              className="text-sm font-medium leading-none"
            >
              联系人
            </label>
            <Input
              id="agent-contact"
              placeholder="姓名 / 微信昵称"
              value={form.contact}
              onChange={(e) => update("contact", e.target.value)}
              maxLength={50}
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="agent-phone"
              className="text-sm font-medium leading-none"
            >
              电话
            </label>
            <Input
              id="agent-phone"
              placeholder="手机号"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
              maxLength={30}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="agent-email"
            className="text-sm font-medium leading-none"
          >
            邮箱
          </label>
          <Input
            id="agent-email"
            type="email"
            placeholder="business@example.com"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            maxLength={255}
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="agent-remark"
            className="text-sm font-medium leading-none"
          >
            内部备注
          </label>
          <Input.TextArea
            id="agent-remark"
            placeholder="仅管理员可见；记录对接背景 / 备注"
            value={form.remark}
            onChange={(e) => update("remark", e.target.value)}
            maxLength={500}
            rows={3}
          />
        </div>

        {/* 2026-09-07：edit 模式才展示 workbench / 账本 / 模板三块 */}
        {mode === "edit" && agent && (
          <>
            <Divider style={{ margin: "8px 0 16px" }} />

            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">
                Workbench 链接
              </label>
              <div className="flex items-center gap-2">
                <Input
                  value={workbenchUrl ?? "(未生成)"}
                  readOnly
                  className="!font-mono !text-xs"
                />
                <Button
                  icon={<Copy className="h-3.5 w-3.5" />}
                  disabled={!workbenchUrl}
                  onClick={handleCopyLink}
                >
                  复制
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                代理商登录后访问此链接进入 workbench。
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">
                积分余额
              </label>
              <div className="flex items-center gap-3 rounded-md border bg-violet-500/5 px-3 py-2">
                <Tag color="violet" className="!m-0">
                  ¥{agent.creditBalance}
                </Tag>
                <span className="text-[11px] text-muted-foreground flex-1">
                  workbench 提交订单时按模板价格扣减
                </span>
                <Button
                  size="small"
                  type="default"
                  onClick={() => setCreditDialogOpen(true)}
                >
                  充值 / 扣款
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium leading-none">
                可服务商品类别（提示词模板）
              </label>
              <p className="text-[11px] text-muted-foreground">
                代理商在 workbench 只能选择已勾选的模板生成效果图。
              </p>
              <AgentTemplatesSelector agentId={agent.id} onSaved={onSaved} />
            </div>
          </>
        )}
      </div>

      {/* 子对话框：账本管理（仅 edit 模式） */}
      {mode === "edit" && agent && (
        <AgentCreditDialog
          open={creditDialogOpen}
          agentId={agent.id}
          agentName={agent.name}
          onOpenChange={setCreditDialogOpen}
        />
      )}
    </Modal>
  );
}
