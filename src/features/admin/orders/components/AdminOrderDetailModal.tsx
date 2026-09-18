"use client";

/**
 * /admin/orders 全局订单管理 —— 详情 modal（2026-09-18）
 *
 * 把 AdminOrderRow 直接当 OrderDetail 用（字段完全覆盖），
 * 包一个 antd Modal + 复用 OrderDetailView。
 *
 * Footer：
 *   - 「编辑备注」按钮（蓝）
 *   - 「取消订单」按钮（danger）—— 状态=CANCELLED 时禁用
 *   - 「关闭」按钮
 *
 * 复用：
 *   - OrderDetailView（@/features/image-gen/components/order-detail-view）
 */

import { Button, Modal, Space } from "antd";
import { Ban, MessageSquareText, X } from "lucide-react";
import { useTranslations } from "next-intl";
import type { AdminOrderRow } from "@/features/admin/orders/types";
import { OrderDetailView } from "@/features/image-gen/components/order-detail-view";

export interface AdminOrderDetailModalProps {
  order: AdminOrderRow | null;
  onClose: () => void;
  /** 「取消订单」按钮 → 关闭当前 modal + 打开 CancelConfirmDialog */
  onCancel: (orderId: string) => void;
  /** 「编辑备注」按钮 → 关闭当前 modal + 打开 OrderRemarksDialog */
  onEditRemarks: (orderId: string) => void;
}

export function AdminOrderDetailModal({
  order,
  onClose,
  onCancel,
  onEditRemarks,
}: AdminOrderDetailModalProps) {
  const t = useTranslations("AdminOrders");

  return (
    <Modal
      open={order !== null}
      onCancel={onClose}
      title={
        <div className="flex items-center gap-2">
          <span>{t("actions.viewDetail")}</span>
          {order && (
            <span className="font-mono text-xs text-muted-foreground">
              {order.orderNo}
            </span>
          )}
        </div>
      }
      width={920}
      footer={
        order ? (
          <Space>
            <Button
              type="default"
              icon={<MessageSquareText className="h-4 w-4" />}
              onClick={() => onEditRemarks(order.orderId)}
            >
              {t("actions.editRemarks")}
            </Button>
            <Button
              danger
              type="default"
              icon={<Ban className="h-4 w-4" />}
              disabled={order.status === "CANCELLED"}
              onClick={() => onCancel(order.orderId)}
            >
              {t("actions.cancelOrder")}
            </Button>
            <Button
              type="primary"
              icon={<X className="h-4 w-4" />}
              onClick={onClose}
            >
              {t("remarksDialog.cancel")}
            </Button>
          </Space>
        ) : null
      }
      destroyOnClose
    >
      {order && (
        <div className="max-h-[70vh] overflow-y-auto -mx-6">
          <OrderDetailView order={order} />
        </div>
      )}
    </Modal>
  );
}
