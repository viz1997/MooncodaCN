"use client";

/**
 * 2026-08-20：shadcn → antd 迁移（Phase 3.4）
 * - shadcn Dialog/Input/Label/Select/Button → antd
 * - sonner toast → antd App.useApp().message
 * - 用 antd Form.Item 包裹 label + input；Select options 数组
 */

import { App, Button, Form, Input, Modal, Select } from "antd";
import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { updateOrderAction } from "@/features/gpt-image/actions/orders";
import {
  ORDER_PLATFORM_LABELS,
  ORDER_PLATFORMS,
  type OrderPlatform,
  type OrderView,
} from "@/features/gpt-image/lib/types";

interface OrderEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 待编辑订单；null 时对话框不渲染内容 */
  order: OrderView | null;
  /** 编辑成功回调，传入最新 OrderView（用于乐观替换列表中的旧条目） */
  onUpdated: (order: OrderView) => void;
}

export function OrderEditDialog({
  open,
  onOpenChange,
  order,
  onUpdated,
}: OrderEditDialogProps) {
  const { message } = App.useApp();
  const [orderNo, setOrderNo] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [platform, setPlatform] = useState<OrderPlatform | "">("");
  const [uploadCount, setUploadCount] = useState(1);
  const [imagesPerUpload, setImagesPerUpload] = useState(3);
  const [regenerateLimit, setRegenerateLimit] = useState(5);
  const [saving, setSaving] = useState(false);

  // 每次打开时用 order 字段填充表单
  useEffect(() => {
    if (!open || !order) return;
    setOrderNo(order.orderNo);
    setRecipientName(order.recipientName ?? "");
    setPlatform((order.platform ?? "") as OrderPlatform | "");
    setUploadCount(order.uploadCount);
    setImagesPerUpload(order.imagesPerUpload ?? 3);
    setRegenerateLimit(order.regenerateLimit ?? 5);
  }, [open, order]);

  const handleSave = async () => {
    if (!order) return;
    if (!orderNo.trim()) {
      message.error("请输入订单号");
      return;
    }
    setSaving(true);
    try {
      const res = await updateOrderAction({
        id: order.id,
        orderNo: orderNo.trim(),
        recipientName: recipientName.trim(),
        platform: platform || null,
        uploadCount,
        imagesPerUpload,
        regenerateLimit,
        // 2026-08-23：代理商业务字段（编辑时直传；不提供"清空"按钮，先
        // 用 order 上的值兜底；要清空就在管理后台编辑 DB 或后续扩展 UI）
        agentId: order.agentId ?? null,
        productTypeCode: order.productTypeCode ?? null,
        productSize: order.productSize ?? null,
        accessoryCode: order.accessoryCode ?? null,
      });
      if (!res?.data) throw new Error("保存失败");
      message.success("订单已更新");
      onUpdated(res.data.order);
      onOpenChange(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => !saving && onOpenChange(false)}
      title="编辑订单"
      footer={[
        <Button
          key="cancel"
          onClick={() => onOpenChange(false)}
          disabled={saving}
        >
          取消
        </Button>,
        <Button
          key="save"
          type="primary"
          onClick={handleSave}
          disabled={saving || !order}
          loading={saving}
        >
          保存修改
        </Button>,
      ]}
      width={480}
    >
      <p className="text-sm text-muted-foreground mb-4">
        仅业务字段（订单号、收件人、平台、上传数量、重新生成次数）可改；模板、访问链接、状态、上传内容保持不变。
      </p>

      {!order ? null : (
        <Form layout="vertical" className="space-y-3">
          <Form.Item label="订单号" required className="!mb-0">
            <Input
              value={orderNo}
              onChange={(e) => setOrderNo(e.target.value)}
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground mt-1">
              订单号不必唯一；改完后历史访问链接不受影响（token 未动）。
            </p>
          </Form.Item>

          <Form.Item label="收件人（昵称/标识）" className="!mb-0">
            <Input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              maxLength={100}
              placeholder="留空表示未指定"
            />
          </Form.Item>

          <Form.Item label="来源平台" className="!mb-0">
            <Select
              value={platform || "_none"}
              onChange={(v) =>
                setPlatform(v === "_none" ? "" : (v as OrderPlatform))
              }
              options={[
                { value: "_none", label: "未指定" },
                ...ORDER_PLATFORMS.map((p) => ({
                  value: p,
                  label: ORDER_PLATFORM_LABELS[p],
                })),
              ]}
              placeholder="未指定"
              className="w-full"
            />
          </Form.Item>

          <Form.Item label="用户上传批次（次数）" className="!mb-0">
            <div className="flex items-stretch gap-2">
              <Button
                type="default"
                onClick={() => setUploadCount((n) => Math.max(1, n - 1))}
                disabled={uploadCount <= 1}
                aria-label="减少"
                icon={<Minus className="h-4 w-4" />}
              />
              <Input
                type="number"
                min={1}
                max={10}
                value={uploadCount}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setUploadCount(
                    Number.isNaN(n) ? 1 : Math.min(10, Math.max(1, n))
                  );
                }}
                className="text-center"
              />
              <Button
                type="default"
                onClick={() => setUploadCount((n) => Math.min(10, n + 1))}
                disabled={uploadCount >= 10}
                aria-label="增加"
                icon={<Plus className="h-4 w-4" />}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              修改后用户可继续按新批次上传；总容量 = 批次 × 每批张数。
            </p>
          </Form.Item>

          <Form.Item label="每批上传原图数量" className="!mb-0">
            <div className="flex items-stretch gap-2">
              <Button
                type="default"
                onClick={() => setImagesPerUpload((n) => Math.max(1, n - 1))}
                disabled={imagesPerUpload <= 1}
                aria-label="减少"
                icon={<Minus className="h-4 w-4" />}
              />
              <Input
                type="number"
                min={1}
                max={3}
                value={imagesPerUpload}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setImagesPerUpload(
                    Number.isNaN(n) ? 1 : Math.min(3, Math.max(1, n))
                  );
                }}
                className="text-center"
              />
              <Button
                type="default"
                onClick={() => setImagesPerUpload((n) => Math.min(3, n + 1))}
                disabled={imagesPerUpload >= 3}
                aria-label="增加"
                icon={<Plus className="h-4 w-4" />}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              用户每次上传会话最多塞几张参考图。范围 1-3。
            </p>
          </Form.Item>

          <Form.Item label="用户重新生成次数上限" className="!mb-0">
            <div className="flex items-stretch gap-2">
              <Button
                type="default"
                onClick={() => setRegenerateLimit((n) => Math.max(0, n - 1))}
                disabled={regenerateLimit <= 0}
                aria-label="减少"
                icon={<Minus className="h-4 w-4" />}
              />
              <Input
                type="number"
                min={0}
                max={20}
                value={regenerateLimit}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setRegenerateLimit(
                    Number.isNaN(n) ? 0 : Math.min(20, Math.max(0, n))
                  );
                }}
                className="text-center"
              />
              <Button
                type="default"
                onClick={() => setRegenerateLimit((n) => Math.min(20, n + 1))}
                disabled={regenerateLimit >= 20}
                aria-label="增加"
                icon={<Plus className="h-4 w-4" />}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              仅"重新生成第 N 张"（单图路径）计数；批量重跑 / FAILED
              一键重试不计。
            </p>
          </Form.Item>

          <div className="rounded-md border bg-slate-50 p-3 text-xs text-muted-foreground">
            <div className="mb-1 font-medium text-slate-700">不可修改</div>
            <ul className="list-inside list-disc space-y-0.5">
              <li>模板：{order.template.name}</li>
              <li>访问链接：/p/{order.token}</li>
              <li>状态：{order.status}</li>
            </ul>
          </div>
        </Form>
      )}
    </Modal>
  );
}
