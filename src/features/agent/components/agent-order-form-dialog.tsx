"use client";

/**
 * 2026-09-03：代理商 portal 自下单对话框（ToB 业务必填三件套）。
 *
 * 与 admin 的 OrderFormDialog 区别：
 * - 没有 agentId 下拉 —— 强制注入 ctx.agentId（portal 用户看不到其他代理商）
 * - 产品三件套（productTypeCode/productSize/accessoryCode）必填，front-end 校验
 * - 没有"订单号冲突"确认 —— 单个 agent 内 orderNo 允许重复（同 admin）
 * - 取消"更多设置"折叠（代理商自下单通常知道每批参考图 / 重试次数默认值，
 *   但还是展开以保持形态一致）
 *
 * 字段语义与 admin 一致，沿用 promptOrderCreateSchema。
 */

import { App, Button, Form, Input, Modal, Select, Tooltip } from "antd";
import { HelpCircle, Minus, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { agentCreateOrderAction } from "@/features/agent/actions/agent-portal";
import {
  ACCESSORIES,
  getProductType,
  PRODUCT_TYPES,
} from "@/features/gpt-image/lib/product-catalog";
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
  // 三件套：代理商自下单必填
  const [productTypeCode, setProductTypeCode] = useState<string>("");
  const [productSize, setProductSize] = useState<string>("");
  const [accessoryCode, setAccessoryCode] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setOrderNo("");
      setTemplateId(templates[0]?.id ?? "");
      setUploadCount(1);
      setImagesPerUpload(3);
      setRegenerateLimit(5);
      setProductTypeCode("");
      setProductSize("");
      setAccessoryCode("");
    }
  }, [open, templates]);

  const selectedProductType = useMemo(
    () => getProductType(productTypeCode),
    [productTypeCode]
  );
  const availableSizes = selectedProductType?.sizes ?? [];
  const availableAccessories = useMemo(() => {
    if (!selectedProductType) return [];
    return selectedProductType.accessories.map((code) => {
      const a = ACCESSORIES.find((x) => x.code === code);
      return a ?? { code, name: code };
    });
  }, [selectedProductType]);

  // 切换型号：清空尺寸与配件
  const handleProductTypeChange = (v: string) => {
    setProductTypeCode(v);
    setProductSize("");
    setAccessoryCode("");
  };

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
    if (!productSize) {
      message.error("请选择产品尺寸");
      return;
    }
    if (
      selectedProductType &&
      selectedProductType.accessories.length > 0 &&
      !accessoryCode
    ) {
      message.error(`${selectedProductType.name} 必须选择配件`);
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
        productSize,
        accessoryCode: accessoryCode || undefined,
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

        {/* ToB 三件套必填 */}
        <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 space-y-3">
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
              onChange={(v) => handleProductTypeChange(v ?? "")}
              placeholder="选择型号"
              className="w-full"
              options={PRODUCT_TYPES.map((t) => ({
                value: t.code,
                label: `${t.code} · ${t.name}`,
              }))}
            />
          </div>

          <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
            <div className="flex items-center gap-1">
              <span className="text-sm">
                尺寸 <span className="text-rose-600">*</span>
              </span>
              {!selectedProductType && (
                <span className="text-xs font-normal text-zinc-400">
                  （先选型号）
                </span>
              )}
            </div>
            <Select
              value={productSize || undefined}
              onChange={(v) => setProductSize(v ?? "")}
              placeholder={selectedProductType ? "选择尺寸" : "请先选择型号"}
              className="w-full"
              disabled={!selectedProductType}
              options={availableSizes.map((s) => ({
                value: s,
                label: `${s}cm`,
              }))}
            />
          </div>

          <div className="grid grid-cols-[140px_1fr] items-center gap-x-3">
            <div className="flex items-center gap-1">
              <span className="text-sm">
                配件{" "}
                {selectedProductType &&
                selectedProductType.accessories.length > 0 ? (
                  <span className="text-rose-600">*</span>
                ) : (
                  <span className="text-xs font-normal text-zinc-400">
                    （该型号无配件）
                  </span>
                )}
              </span>
            </div>
            <Select
              value={accessoryCode || undefined}
              onChange={(v) => setAccessoryCode(v ?? "")}
              placeholder={
                !selectedProductType
                  ? "请先选择型号"
                  : availableAccessories.length === 0
                    ? "该型号无配件选项"
                    : "选择配件"
              }
              className="w-full"
              disabled={
                !selectedProductType || availableAccessories.length === 0
              }
              options={availableAccessories.map((a) => ({
                value: a.code,
                label: a.name,
              }))}
            />
          </div>
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
            <Tooltip title="每个效果图的重新生成机会。设为 0 表示不允许重新生成。">
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
