"use client";

/**
 * 2026-09-07：代理商账本管理对话框（admin 端）。
 *
 * 功能：
 * - 当前余额展示
 * - Tab 切换「充值 / 手动扣款」
 * - 流水日志表格（最近 50 条）
 *
 * 不在此组件做积分扣减的实际控制；ToB workbench 提交时由
 * submitFinalOrderAction 自动扣费，本对话框只供 admin 调整。
 */

import { App, Button, Input, InputNumber, Modal, Table, Tabs, Tag } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { AgentCreditTransaction } from "@/db/schema";
import {
  deductAgentCreditsAdminAction,
  listAgentCreditsAdminAction,
  topUpAgentCreditsAdminAction,
} from "@/features/agent/actions/agent-credits";

interface AgentCreditDialogProps {
  open: boolean;
  agentId: string;
  agentName: string;
  onOpenChange: (open: boolean) => void;
}

export function AgentCreditDialog({
  open,
  agentId,
  agentName,
  onOpenChange,
}: AgentCreditDialogProps) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [logs, setLogs] = useState<AgentCreditTransaction[]>([]);

  // 表单状态
  const [topUpAmount, setTopUpAmount] = useState<number | "">("");
  const [topUpNote, setTopUpNote] = useState("");
  const [deductAmount, setDeductAmount] = useState<number | "">("");
  const [deductNote, setDeductNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAgentCreditsAdminAction({ agentId });
      if (res?.data) {
        setBalance(res.data.creditBalance);
        setLogs(res.data.logs);
      } else if (res?.serverError) {
        message.error(res.serverError);
      }
    } catch (e) {
      console.error("[AgentCreditDialog] load failed", e);
      message.error("加载账本失败");
    } finally {
      setLoading(false);
    }
  }, [agentId, message]);

  useEffect(() => {
    if (!open) return;
    setTopUpAmount("");
    setTopUpNote("");
    setDeductAmount("");
    setDeductNote("");
    loadData();
  }, [open, loadData]);

  const handleTopUp = async () => {
    if (!topUpAmount || topUpAmount <= 0) {
      message.error("请输入大于 0 的充值金额");
      return;
    }
    setSubmitting(true);
    try {
      const res = await topUpAgentCreditsAdminAction({
        agentId,
        amount: topUpAmount,
        note: topUpNote || undefined,
      });
      if (res?.data) {
        message.success(`已充值 ¥${topUpAmount}`);
        setTopUpAmount("");
        setTopUpNote("");
        await loadData();
      } else if (res?.serverError) {
        message.error(res.serverError);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "充值失败";
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeduct = async () => {
    if (!deductAmount || deductAmount <= 0) {
      message.error("请输入大于 0 的扣款金额");
      return;
    }
    if (!deductNote.trim()) {
      message.error("请填写扣款备注");
      return;
    }
    setSubmitting(true);
    try {
      const res = await deductAgentCreditsAdminAction({
        agentId,
        amount: deductAmount,
        note: deductNote.trim(),
      });
      if (res?.data) {
        message.success(`已扣款 ¥${deductAmount}`);
        setDeductAmount("");
        setDeductNote("");
        await loadData();
      } else if (res?.serverError) {
        message.error(res.serverError);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "扣款失败";
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => !submitting && onOpenChange(false)}
      title={`代理商账本 · ${agentName}`}
      width={720}
      footer={[
        <Button
          key="close"
          type="default"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
        >
          关闭
        </Button>,
      ]}
      destroyOnClose
    >
      <div className="mb-4 rounded-md border bg-violet-500/5 p-4">
        <p className="text-xs text-muted-foreground">当前余额</p>
        <p className="text-2xl font-bold text-violet-700">¥{balance ?? "—"}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          积分单位"元"，对齐 promptTemplate.price；workbench
          提交订单时按模板价格扣减。
        </p>
      </div>

      <Tabs
        defaultActiveKey="topup"
        items={[
          {
            key: "topup",
            label: "充值",
            children: (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">充值金额（¥）</label>
                  <InputNumber
                    className="!w-full"
                    min={1}
                    max={1_000_000}
                    value={topUpAmount}
                    onChange={(v) =>
                      setTopUpAmount(typeof v === "number" ? v : "")
                    }
                    placeholder="请输入正整数"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">备注（可选）</label>
                  <Input
                    value={topUpNote}
                    onChange={(e) => setTopUpNote(e.target.value)}
                    placeholder="例：客户付款，2026-09 月对账"
                    maxLength={200}
                  />
                </div>
                <Button
                  type="primary"
                  loading={submitting}
                  onClick={handleTopUp}
                >
                  确认充值
                </Button>
              </div>
            ),
          },
          {
            key: "deduct",
            label: "手动扣款",
            children: (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">扣款金额（¥）</label>
                  <InputNumber
                    className="!w-full"
                    min={1}
                    max={1_000_000}
                    value={deductAmount}
                    onChange={(v) =>
                      setDeductAmount(typeof v === "number" ? v : "")
                    }
                    placeholder="请输入正整数"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    备注 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={deductNote}
                    onChange={(e) => setDeductNote(e.target.value)}
                    placeholder="例：误充退回 / 平台补贴调整"
                    maxLength={200}
                  />
                </div>
                <Button
                  type="primary"
                  danger
                  loading={submitting}
                  onClick={handleDeduct}
                >
                  确认扣款
                </Button>
              </div>
            ),
          },
        ]}
      />

      <div className="mt-6">
        <h4 className="mb-2 text-sm font-medium">最近流水</h4>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={logs}
          pagination={false}
          scroll={{ y: 240 }}
          locale={{ emptyText: "暂无流水" }}
          columns={[
            {
              title: "时间",
              dataIndex: "createdAt",
              width: 160,
              render: (d: Date) => (
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(d).toLocaleString("zh-CN")}
                </span>
              ),
            },
            {
              title: "类型",
              dataIndex: "type",
              width: 80,
              render: (t: string) =>
                t === "topup" ? (
                  <Tag color="green">充值</Tag>
                ) : (
                  <Tag color="volcano">扣款</Tag>
                ),
            },
            {
              title: "金额",
              dataIndex: "amount",
              width: 100,
              align: "right",
              render: (a: number) =>
                a > 0 ? (
                  <span className="font-mono text-emerald-600">+{a}</span>
                ) : (
                  <span className="font-mono text-rose-600">{a}</span>
                ),
            },
            {
              title: "备注",
              dataIndex: "note",
              render: (n: string | null) =>
                n ? (
                  <span className="text-xs">{n}</span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                ),
            },
          ]}
        />
      </div>
    </Modal>
  );
}
