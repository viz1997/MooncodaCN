"use client";

/**
 * /admin/orders 全局订单管理 —— 编辑备注 dialog（2026-09-18）
 *
 * 输入：textarea（max 500 字符，与 promptOrder.remarks 列宽对齐）
 * 提交：调 adminUpdateRemarksAction
 *
 * 设计：
 *   - 「空字符串」保存时由 service 层 trim → null（与 /image-gen SpecModal 一致）
 *   - 「删除」按钮：快速清空（不删订单）
 *   - Submitting 期间禁用所有按钮 + 显示 loading
 */

import { App, Button, Input, Modal } from "antd";
import { Eraser, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import type { AdminOrderRow } from "@/features/admin/orders/types";

const MAX_REMARKS_LENGTH = 500;

export interface OrderRemarksDialogProps {
  order: AdminOrderRow | null;
  onClose: () => void;
  onConfirm: (remarks: string | null) => Promise<void> | void;
}

export function OrderRemarksDialog({
  order,
  onClose,
  onConfirm,
}: OrderRemarksDialogProps) {
  const t = useTranslations("AdminOrders");
  const { message } = App.useApp();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // 每次打开 dialog → 重置 text 为当前订单的 remarks
  useEffect(() => {
    if (order) {
      setText(order.remarks ?? "");
    }
  }, [order]);

  if (!order) return null;

  const handleClear = () => {
    setText("");
  };

  const handleSave = async () => {
    setSubmitting(true);
    try {
      // 空字符串按 null 提交（service 层也兜底 trim → null）
      const trimmed = text.trim();
      await onConfirm(trimmed.length > 0 ? trimmed : null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存失败";
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={order !== null}
      onCancel={() => !submitting && onClose()}
      title={
        <div className="flex items-center gap-2">
          <span>{t("remarksDialog.title")}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {order.orderNo}
          </span>
        </div>
      }
      width={560}
      footer={[
        <Button
          key="clear"
          type="default"
          icon={<Eraser className="h-4 w-4" />}
          onClick={handleClear}
          disabled={submitting || text.length === 0}
        >
          清空
        </Button>,
        <Button
          key="cancel"
          type="default"
          onClick={onClose}
          disabled={submitting}
        >
          {t("remarksDialog.cancel")}
        </Button>,
        <Button
          key="save"
          type="primary"
          icon={<Save className="h-4 w-4" />}
          loading={submitting}
          onClick={handleSave}
        >
          {t("remarksDialog.save")}
        </Button>,
      ]}
      destroyOnClose
    >
      <div className="space-y-3">
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("remarksDialog.placeholder")}
          maxLength={MAX_REMARKS_LENGTH}
          showCount
          autoSize={{ minRows: 4, maxRows: 8 }}
        />
        <p className="text-xs text-muted-foreground">
          {t("remarksDialog.emptyTip")}
        </p>
      </div>
    </Modal>
  );
}
