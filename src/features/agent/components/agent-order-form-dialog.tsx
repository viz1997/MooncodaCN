"use client";

/**
 * 2026-09-07：代理商 portal 自下单对话框。
 *
 * 2026-09-07 调整：代理商自下单时只选产品型号（ToB 业务必填）；
 * 尺寸 / 配件由 createOrder service 按"该型号首选项"自动填入（"链接
 * 创建时定死"），前端不再提供。
 *
 * 与 admin 的 OrderFormDialog 区别：
 * - 没有 agentId 下拉 —— 强制注入 ctx.agentId（portal 用户看不到其他代理商）
 * - 产品三件套里只暴露 productTypeCode；size / accessory 在 service 层
 *   自动补
 * - 没有"订单号冲突"确认 —— 单个 agent 内 orderNo 允许重复（同 admin）
 * - 取消"更多设置"折叠（代理商自下单通常知道每批参考图 / 重试次数默认值，
 *   但还是展开以保持形态一致）
 *
 * 字段语义与 admin 一致，沿用 promptOrderCreateSchema。
 */

import { App, Button, Form, Input, Modal, Select, Tooltip } from "antd";
import { HelpCircle, Minus, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { agentCreateOrderAction } from "@/features/agent/actions/agent-portal";
import { PRODUCT_TYPES } from "@/features/gpt-image/lib/product-catalog";
import type {
  OrderView,
  PromptTemplateView,
} from "@/features/gpt-image/lib/types";

interface AgentOrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: PromptTemplateView[];
  templatesLoading?: boolean;
  templatesError?: string | null;
  onRetryTemplates?: () => void;
  /** 创建成功回调（OrderView 含 token）—— 父组件拿到后跳 /p/[token] */
  onCreated: (order: OrderView) => void;
}

export function AgentOrderFormDialog({
  open,
  onOpenChange,
  templates,
  templatesLoading = false,
  templatesError = null,
  onRetryTemplates,
  onCreated,
}: AgentOrderFormDialogProps) {
  const { message } = App.useApp();
  const [orderNo, setOrderNo] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [uploadCount, setUploadCount] = useState(1);
  const [imagesPerUpload, setImagesPerUpload] = useState(3);
  const [regenerateLimit, setRegenerateLimit] = useState(5);
  // 2026-09-07：代理商自下单只挑产品型号；尺寸 / 配件由 service 自动补
  const [productTypeCode, setProductTypeCode] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setOrderNo("");
      setTemplateId(templates[0]?.id ?? "");
      setUploadCount(1);
      setImagesPerUpload(3);
      setRegenerateLimit(5);
      setProductTypeCode("");
    }
  }, [open, templates]);

  const activeTemplates = templates.filter((t) => t.isActive);

  const handleCreate = async () => {
    if (!orderNo.trim()) {
      message.error("请填写订单号");
      return;
    }
    if (!templateId) {
      message.error("请选择模板");
      return;
    }
    if (!productTypeCode) {
      message.error("请选择产品型号");
      return;
    }
    setSaving(true);
    try {
      const res = await agentCreateOrderAction({
        orderNo: orderNo.trim(),
        templateId,
        uploadCount,
        imagesPerUpload,
        regenerateLimit,
        productTypeCode,
      });
      if (!res?.data) {
        const err = res as unknown as { serverError?: string };
        throw new Error(err.serverError ?? "创建失败");
      }
      message.success("订单已创建，正在跳转…");
      onCreated(res.data.order);
      onOpenChange(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => !saving && onOpenChange(false)}
      title="新建订单"
      footer={[
        <Button
          key="cancel"
          onClick={() => onOpenChange(false)}
          disabled={saving}
          icon={<X className="h-4 w-4" />}
        >
          取消
        </Button>,
        <Button
          key="create"
          type="primary"
          onClick={handleCreate}
          disabled={saving}
          loading={saving}
          className="!bg-violet-600 hover:!bg-violet-700"
        >
          {saving ? "创建中…" : "创建并生成链接"}
        </Button>,
      ]}
      width={640}
      styles={{ body: { maxHeight: "calc(90vh - 110px)", overflowY: "auto" } }}
    >
      <Form layout="vertical" className="space-y-3 pt-2">
        <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
          <div className="flex items-center gap-1">
            <span className="text-sm">
              订单号 <span className="text-rose-600">*</span>
            </span>
            <Tooltip title="业务标识，自己取。订单号不必唯一。">
              <HelpCircle className="h-3.5 w-3.5 text-stone-400 cursor-help" />
            </Tooltip>
          </div>
          <Input
            value={orderNo}
            onChange={(e) => setOrderNo(e.target.value)}
            placeholder="如：AG-20260903-001"
          />
        </div>

        <div className="grid grid-cols-[140px_1fr] items-start gap-x-3">
          <span className="text-sm pt-2">
            关联模板 <span className="text-rose-600">*</span>
          </span>
          <div className="space-y-1.5">
            {templatesLoading ? (
              <Select
                value="_loading"
                disabled
                className="w-full opacity-60"
                options={[{ value: "_loading", label: "加载模板中…" }]}
              />
            ) : templatesError ? (
              <>
                <Select
                  value="_error"
                  disabled
                  className="w-full opacity-60"
                  options={[{ value: "_error", label: "模板加载失败" }]}
                />
                {onRetryTemplates && (
                  <Button
                    type="default"
                    size="small"
                    onClick={onRetryTemplates}
                  >
                    重新加载
                  </Button>
                )}
              </>
            ) : activeTemplates.length === 0 ? (
              <Select
                value="_empty"
                disabled
                className="w-full opacity-60"
                options={[{ value: "_empty", label: "暂无启用的模板" }]}
              />
            ) : (
              <Select
                value={templateId}
                onChange={(v) => setTemplateId(v)}
                placeholder="选择模板"
                className="w-full"
                options={activeTemplates.map((t) => ({
                  value: t.id,
                  label: t.name,
                }))}
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
          <div className="flex items-center gap-1">
            <span className="text-sm">
              效果数量 <span className="text-rose-600">*</span>
            </span>
            <Tooltip title="你要交付的效果图数量。每个效果图对应一批参考图 + 一轮生产。">
              <HelpCircle className="h-3.5 w-3.5 text-stone-400 cursor-help" />
            </Tooltip>
          </div>
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
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                setUploadCount(Math.max(1, Math.min(10, Math.floor(v))));
              }}
              className="text-center font-medium"
            />
            <Button
              type="default"
              onClick={() => setUploadCount((n) => Math.min(10, n + 1))}
              disabled={uploadCount >= 10}
              aria-label="增加"
              icon={<Plus className="h-4 w-4" />}
            />
          </div>
        </div>

        {/* ToB 产品型号 —— 2026-09-07 起只挑型号；尺寸 / 配件由 service 自动取首选项 */}
        <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-2">
          <div className="flex items-center gap-1 text-violet-700">
            <span className="text-sm font-medium">产品规格（ToB 必填）</span>
          </div>

          <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
            <div className="flex items-center gap-1">
              <span className="text-sm">
                产品型号 <span className="text-rose-600">*</span>
              </span>
            </div>
            <Select
              value={productTypeCode || undefined}
              onChange={(v) => setProductTypeCode(v ?? "")}
              placeholder="选择型号"
              className="w-full"
              options={PRODUCT_TYPES.map((t) => ({
                value: t.code,
                label: `${t.code} · ${t.name}`,
              }))}
            />
          </div>

          <p className="text-[11px] text-violet-700/80 pl-[152px]">
            尺寸 /
            配件系统会按该型号默认规格自动填入（链接生成时定死），下单后不可改。
          </p>
        </div>

        <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
          <div className="flex items-center gap-1">
            <span className="text-sm">每批参考图数量</span>
            <Tooltip title="每批效果图的参考图张数（多张被融合生图）。默认 3 张，1-3 张可选。">
              <HelpCircle className="h-3.5 w-3.5 text-stone-400 cursor-help" />
            </Tooltip>
          </div>
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
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                setImagesPerUpload(Math.max(1, Math.min(3, Math.floor(v))));
              }}
              className="text-center font-medium"
            />
            <Button
              type="default"
              onClick={() => setImagesPerUpload((n) => Math.min(3, n + 1))}
              disabled={imagesPerUpload >= 3}
              aria-label="增加"
              icon={<Plus className="h-4 w-4" />}
            />
          </div>
        </div>

        <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
          <div className="flex items-center gap-1">
            <span className="text-sm">每批重试次数</span>
            <Tooltip title="每个效果图最多尝试次数，含首次生成。例如填 5 = 共可生成 5 次（首次 + 4 次重新生成）。设为 0 表示禁止用户主动重新生成。">
              <HelpCircle className="h-3.5 w-3.5 text-stone-400 cursor-help" />
            </Tooltip>
          </div>
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
                const v = Number(e.target.value);
                if (!Number.isFinite(v)) return;
                setRegenerateLimit(Math.max(0, Math.min(20, Math.floor(v))));
              }}
              className="text-center font-medium"
            />
            <Button
              type="default"
              onClick={() => setRegenerateLimit((n) => Math.min(20, n + 1))}
              disabled={regenerateLimit >= 20}
              aria-label="增加"
              icon={<Plus className="h-4 w-4" />}
            />
          </div>
        </div>
      </Form>
    </Modal>
  );
}
