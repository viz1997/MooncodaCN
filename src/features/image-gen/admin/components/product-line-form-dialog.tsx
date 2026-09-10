"use client";

/**
 * 产品线表单弹窗（新建/编辑共用）
 *
 * 2026-09-10：替代 mooncada-source ENRICHED 内联 mock；与 product_line 表对接。
 * - antd Modal + Form（vertical layout）
 * - 字段：productLineId / name / category / description / coverUrl /
 *   spec (JSON TextArea) / pricing (JSON TextArea) / status / sortOrder
 * - spec / pricing 提交前 JSON.parse 校验合法性（错误时给用户提示，不发请求）
 * - submit 调 createProductLineAdminAction 或 updateProductLineAdminAction
 */

import { App, Button, Form, Input, InputNumber, Modal, Select } from "antd";
import { useAction } from "next-safe-action/hooks";
import { useEffect } from "react";
import {
  createProductLineAdminAction,
  updateProductLineAdminAction,
} from "@/features/image-gen/admin/actions";
import type { ProductLine } from "@/features/image-gen/lib/product-effect-types";

interface ProductLineFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 编辑模式传初始行；新建模式不传 → 自动生成 productLineId
   */
  initialLine?: ProductLine | null;
  /**
   * 提交成功回调（父组件用来刷新列表 + 关弹窗）
   */
  onSuccess?: () => void;
}

const STATUS_OPTIONS = [
  { value: "active", label: "上架" },
  { value: "inactive", label: "下架" },
  { value: "draft", label: "草稿" },
];

function generateProductLineId(): string {
  return `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 把对象格式化为缩进 JSON 字符串（输入框默认填值用）
 * null / undefined → 空字符串
 */
function stringifyForInput(obj: unknown): string {
  if (obj == null) return "";
  if (typeof obj !== "object") return "";
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return "";
  }
}

export function ProductLineFormDialog({
  open,
  onOpenChange,
  initialLine,
  onSuccess,
}: ProductLineFormDialogProps) {
  const isEdit = !!initialLine;
  const { message } = App.useApp();
  const [form] = Form.useForm<{
    productLineId: string;
    name: string;
    category: string;
    description: string;
    coverUrl: string;
    spec: string;
    pricing: string;
    status: "active" | "inactive" | "draft";
    sortOrder: number;
  }>();

  // 每次 open 切换时同步 initialLine → form
  useEffect(() => {
    if (!open) return;
    if (initialLine) {
      form.setFieldsValue({
        productLineId: initialLine.productLineId,
        name: initialLine.name,
        category: initialLine.category,
        description: initialLine.description ?? "",
        coverUrl: initialLine.coverUrl ?? "",
        spec: stringifyForInput(initialLine.spec),
        pricing: stringifyForInput(initialLine.pricing),
        status: initialLine.status,
        sortOrder: initialLine.sortOrder,
      });
    } else {
      form.setFieldsValue({
        productLineId: generateProductLineId(),
        name: "",
        category: "",
        description: "",
        coverUrl: "",
        spec: "",
        pricing: "",
        status: "active",
        sortOrder: 0,
      });
    }
  }, [open, initialLine, form]);

  const { execute: createLine, isPending: isCreating } = useAction(
    createProductLineAdminAction,
    {
      onSuccess: () => {
        message.success("创建成功");
        onSuccess?.();
        onOpenChange(false);
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "创建失败");
      },
    }
  );

  const { execute: updateLine, isPending: isUpdating } = useAction(
    updateProductLineAdminAction,
    {
      onSuccess: () => {
        message.success("更新成功");
        onSuccess?.();
        onOpenChange(false);
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? "更新失败");
      },
    }
  );

  const isPending = isCreating || isUpdating;

  const handleSubmit = async () => {
    let values: Awaited<ReturnType<typeof form.validateFields>>;
    try {
      values = await form.validateFields();
    } catch {
      // antd Form 已经展示字段级错误
      return;
    }

    // 提交前 JSON.parse 校验（parseLineJsonInput 已在 actions.ts 实现，
    // 这里再校验一遍给用户更明确的提示）
    const fieldsToValidate: Array<{ key: "spec" | "pricing"; label: string }> =
      [
        { key: "spec", label: "规格 spec" },
        { key: "pricing", label: "报价 pricing" },
      ];
    for (const { key, label } of fieldsToValidate) {
      const raw = values[key];
      if (raw && raw.trim()) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            message.error(`${label} 必须是 JSON 对象`);
            return;
          }
        } catch (err) {
          message.error(
            `${label} JSON 解析失败：${err instanceof Error ? err.message : String(err)}`
          );
          return;
        }
      }
    }

    if (isEdit && initialLine) {
      updateLine({
        productLineId: initialLine.productLineId,
        updates: values,
      });
    } else {
      createLine(values);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => onOpenChange(false)}
      title={isEdit ? `编辑产品线 · ${initialLine?.name ?? ""}` : "新建产品线"}
      width={640}
      footer={null}
      destroyOnClose
    >
      <Form form={form} layout="vertical" className="mt-2">
        <div className="grid grid-cols-2 gap-4">
          <Form.Item
            name="productLineId"
            label="ID（业务主键）"
            rules={[{ required: true, message: "请输入 productLineId" }]}
          >
            <Input
              placeholder="pl_xxx"
              disabled={isEdit}
              className="font-mono"
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: "请输入名称" }]}
          >
            <Input placeholder="真皮皮革徽章" />
          </Form.Item>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Form.Item
            name="category"
            label="分类"
            rules={[{ required: true, message: "请输入分类" }]}
          >
            <Input placeholder="leather_badge / badge / keychain..." />
          </Form.Item>
          <Form.Item name="coverUrl" label="封面图 URL">
            <Input placeholder="https://..." />
          </Form.Item>
        </div>

        <Form.Item name="description" label="描述">
          <Input.TextArea rows={2} placeholder="一段话描述这条产品线" />
        </Form.Item>

        <Form.Item
          name="spec"
          label={
            <span>
              规格 spec
              <span className="ml-1 text-xs text-muted-foreground">
                （JSON 对象，可空）
              </span>
            </span>
          }
        >
          <Input.TextArea
            rows={4}
            placeholder='{"sizeRange":{"min":4,"max":8,"unit":"cm"},"material":["头层牛皮"]}'
            className="!font-mono !text-xs"
          />
        </Form.Item>

        <Form.Item
          name="pricing"
          label={
            <span>
              报价 pricing
              <span className="ml-1 text-xs text-muted-foreground">
                （JSON 对象，可空）
              </span>
            </span>
          }
        >
          <Input.TextArea
            rows={4}
            placeholder='{"basePrice":12,"currency":"CNY","sizeSurcharge":[{"threshold":6,"extra":2}]}'
            className="!font-mono !text-xs"
          />
        </Form.Item>

        <div className="grid grid-cols-2 gap-4">
          <Form.Item name="status" label="状态">
            <Select options={STATUS_OPTIONS} />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序">
            <InputNumber className="w-full" placeholder="数字越小越靠前" />
          </Form.Item>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="primary" onClick={handleSubmit} loading={isPending}>
            {isPending ? "保存中..." : isEdit ? "更新" : "创建"}
          </Button>
          <Button onClick={() => onOpenChange(false)} disabled={isPending}>
            取消
          </Button>
        </div>
      </Form>
    </Modal>
  );
}
