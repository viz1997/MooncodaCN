"use client";

/**
 * /admin/orders 全局订单管理 —— 取消确认 dialog（2026-09-18）
 *
 * 危险确认：必须勾选「我已了解后果」复选框才能点确认
 * 可选填写取消原因（写日志 / metadata，不持久化到 promptOrder）
 *
 * 提交流程：
 *   - 调 adminCancelOrderAction(orderId, reason)
 *   - 服务层原子 compare-and-set → status=CANCELLED → 退 creditsCharged
 *   - 失败抛错（toast 由父组件 AdminOrdersView 处理）
 */

import { App, Button, Checkbox, Input, Modal } from "antd";
import { AlertTriangle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { AdminOrderRow } from "@/features/admin/orders/types";

export interface CancelConfirmDialogProps {
  order: AdminOrderRow | null;
  onClose: () => void;
  onConfirm: (reason: string | null) => Promise<void> | void;
}

export function CancelConfirmDialog({
  order,
  onClose,
  onConfirm,
}: CancelConfirmDialogProps) {
  const t = useTranslations("AdminOrders");
  const { message } = App.useApp();
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!order) return null;

  const refundAmount = order.creditsCharged ?? 0;
  const willRefund = refundAmount > 0;

  const handleConfirm = async () => {
    if (!acknowledged) {
      message.error("请先勾选「我已了解后果」");
      return;
    }
    setSubmitting(true);
    try {
      const trimmed = reason.trim();
      await onConfirm(trimmed.length > 0 ? trimmed : null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "取消失败";
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // 关闭时重置
  const handleClose = () => {
    if (submitting) return;
    setReason("");
    setAcknowledged(false);
    onClose();
  };

  return (
    <Modal
      open={order !== null}
      onCancel={handleClose}
      title={
        <div className="flex items-center gap-2 text-rose-700">
          <AlertTriangle className="h-4 w-4" />
          {t("cancelDialog.title")}
        </div>
      }
      width={520}
      footer={[
        <Button
          key="cancel"
          type="default"
          icon={<X className="h-4 w-4" />}
          onClick={handleClose}
          disabled={submitting}
        >
          {t("cancelDialog.cancel")}
        </Button>,
        <Button
          key="confirm"
          type="primary"
          danger
          loading={submitting}
          disabled={!acknowledged}
          onClick={handleConfirm}
        >
          {t("cancelDialog.confirm")}
        </Button>,
      ]}
      destroyOnClose
    >
      <div className="space-y-4">
        {/* 订单简述 */}
        <div className="rounded-md bg-muted/40 p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">订单号</span>
            <span className="font-mono text-xs">{order.orderNo}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">创建者</span>
            <span className="text-xs">{order.createdByName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">当前状态</span>
            <span className="text-xs">
              {t(
                `statuses.${order.status}` as
                  | "statuses.PENDING"
                  | "statuses.GENERATING"
                  | "statuses.CANDIDATES_READY"
                  | "statuses.SELECTED"
                  | "statuses.CANCELLED"
                  | "statuses.FAILED"
              )}
            </span>
          </div>
          {willRefund && (
            <div className="flex justify-between border-t pt-1.5 mt-1.5">
              <span className="text-muted-foreground">本单已扣积分</span>
              <span className="font-mono text-rose-700 font-medium">
                {refundAmount}
              </span>
            </div>
          )}
        </div>

        {/* 警告 */}
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-700 dark:text-rose-300">
          {t("cancelDialog.warning")}
        </div>

        {/* 原因（可选） */}
        <div className="space-y-1.5">
          <span className="text-xs font-medium">
            {t("cancelDialog.reasonLabel")}
          </span>
          <Input.TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("cancelDialog.reasonPlaceholder")}
            maxLength={500}
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </div>

        {/* 必须勾选 */}
        <Checkbox
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        >
          我已了解取消后果，确认执行
        </Checkbox>
      </div>
    </Modal>
  );
}
