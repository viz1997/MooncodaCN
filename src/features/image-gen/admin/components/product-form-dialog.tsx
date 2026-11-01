"use client";

/**
 * 商品表单 —— 新建/编辑共用
 *
 * 2026-10-21：商品资料从 product-catalog.ts 硬编码搬到 product 表后，
 * 运营在这里改。对应 actions 的 createProductAdminAction / updateProductAdminAction。
 *
 * 金额单位换算（容易踩坑，改之前先想清楚）：
 *  - DB 存「分」（basePriceCents），与 productEffect.price / promptTemplate.price 一致
 *  - 表单给运营看「元」（¥19.00 比 1900 好填）
 *  - 提交时 ×100，表单回填时 ÷100
 *
 * 尺寸 / 配件清单不能在这里配 —— 那些仍是 product-catalog.ts 的 PRODUCT_TYPES
 * 常量，本页只管商品资料 + 基础价 + SKU 价。
 */

import { App, Button, Form, Input, InputNumber, Modal, Select } from "antd";
import { useAction } from "next-safe-action/hooks";
import { useEffect } from "react";
import {
  createProductAdminAction,
  updateProductAdminAction,
} from "@/features/image-gen/admin/actions";
import type { AdminProduct } from "@/features/image-gen/lib/db-products";

/** ProductCategory 联合类型的可选项（与 image-gen-types.ProductCategory 对齐） */
const CATEGORY_OPTIONS = [
  { value: "keychain", label: "钥匙扣" },
  { value: "shape-keychain", label: "异形钥匙扣" },
  { value: "magnet", label: "冰箱贴" },
  { value: "frame", label: "相框" },
  { value: "leather-badge", label: "皮革徽章" },
  { value: "figure", label: "手办" },
];

const STATUS_OPTIONS = [
  { value: "active", label: "上架" },
  { value: "inactive", label: "下架（对外接口不返回该商品）" },
];

/** 表单值 —— 基础价用「元」，submit 时换算成分 */
export interface ProductFormValues {
  code: string;
  name: string;
  nameEn: string;
  category: string;
  description: string;
  coverUrl: string;
  basePriceYuan: number;
  leadTimeDays: number;
  accent: string;
  status: "active" | "inactive";
  sortOrder: number;
}

/** 回填：DB 行 → 表单值 */
export function productToFormValues(p: AdminProduct): ProductFormValues {
  return {
    code: p.code,
    name: p.name,
    nameEn: p.nameEn,
    category: p.category,
    description: p.description,
    coverUrl: p.coverUrl,
    basePriceYuan: p.basePriceCents / 100,
    leadTimeDays: p.leadTimeDays,
    accent: p.accent,
    status: p.status,
    sortOrder: p.sortOrder,
  };
}

/** 表单值 → action 入参（基础价换算成分） */
export function formValuesToInput(v: ProductFormValues): {
  code: string;
  name: string;
  nameEn: string;
  category: string;
  description: string;
  coverUrl: string;
  basePriceCents: number;
  leadTimeDays: number;
  accent: string;
  status: "active" | "inactive";
  sortOrder: number;
} {
  return {
    ...v,
    basePriceCents: Math.round(v.basePriceYuan * 100),
  };
}

/**
 * 表单字段（新建弹窗与详情页内联表单共用，避免两处字段漂移）
 *
 * @param showCode 编辑时隐藏 code（它是主键，不允许改）
 */
export function ProductFormFields({ showCode = true }: { showCode?: boolean }) {
  return (
    <>
      {showCode ? (
        <Form.Item
          name="code"
          label="产品码"
          tooltip="主键，同时是 SKU 前缀。必须在 PRODUCT_TYPES 字典里（R/A/P/RM/LB/M），新增型号要改代码"
          rules={[
            { required: true, message: "请输入产品码" },
            {
              pattern: /^[A-Z][A-Z0-9]*$/,
              message: "只能是大写字母和数字，如 R / RM / M",
            },
          ]}
        >
          <Input placeholder="R" className="font-mono" />
        </Form.Item>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Form.Item
          name="name"
          label="商品名称（中文）"
          rules={[{ required: true, message: "请输入商品名称" }]}
        >
          <Input placeholder="钥匙扣" />
        </Form.Item>
        <Form.Item name="nameEn" label="商品名称（英文）">
          <Input placeholder="Keychain" />
        </Form.Item>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Form.Item name="category" label="分类">
          <Select options={CATEGORY_OPTIONS} />
        </Form.Item>
        <Form.Item name="coverUrl" label="封面图 URL">
          <Input placeholder="留空则用首个 AI 模板的封面" />
        </Form.Item>
      </div>

      <Form.Item name="description" label="商品描述">
        <Input.TextArea rows={3} placeholder="一段话描述这个商品" />
      </Form.Item>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Form.Item
          name="basePriceYuan"
          label="基础价（元）"
          tooltip="对外 ProductCapability.basePriceCents = 该值 × 100。SKU 绝对价在「SKU 管理」页单独维护"
          rules={[{ required: true, message: "请输入基础价" }]}
        >
          <InputNumber
            className="w-full"
            min={0}
            step={1}
            precision={2}
            placeholder="19.00"
          />
        </Form.Item>
        <Form.Item name="leadTimeDays" label="交期（天）">
          <InputNumber className="w-full" min={0} max={365} />
        </Form.Item>
        <Form.Item name="sortOrder" label="排序" extra="数字越小越靠前">
          <InputNumber className="w-full" placeholder="10" />
        </Form.Item>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Form.Item name="status" label="状态">
          <Select options={STATUS_OPTIONS} />
        </Form.Item>
        <Form.Item name="accent" label="主题色">
          <Input placeholder="#7c3aed" className="font-mono" />
        </Form.Item>
      </div>
    </>
  );
}

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 编辑模式传初始行；新建模式不传 */
  initialProduct?: AdminProduct | null;
  onSuccess?: () => void;
}

/** 新建 / 编辑商品的模态弹窗（列表页「新建」和卡片上的「编辑」共用） */
export function ProductFormDialog({
  open,
  onOpenChange,
  initialProduct,
  onSuccess,
}: ProductFormDialogProps) {
  const isEdit = !!initialProduct;
  const { message } = App.useApp();
  const [form] = Form.useForm<ProductFormValues>();

  useEffect(() => {
    if (!open) return;
    if (initialProduct) {
      form.setFieldsValue(productToFormValues(initialProduct));
    } else {
      form.setFieldsValue({
        code: "",
        name: "",
        nameEn: "",
        category: "keychain",
        description: "",
        coverUrl: "",
        basePriceYuan: 0,
        leadTimeDays: 7,
        accent: "",
        status: "active",
        sortOrder: 0,
      });
    }
  }, [open, initialProduct, form]);

  const { execute: createProduct, isPending: isCreating } = useAction(
    createProductAdminAction,
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

  const { execute: updateProduct, isPending: isUpdating } = useAction(
    updateProductAdminAction,
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
    let values: ProductFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // antd 已展示字段级错误
    }
    const input = formValuesToInput(values);
    if (isEdit && initialProduct) {
      updateProduct({ code: initialProduct.code, updates: input });
    } else {
      createProduct(input);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={() => onOpenChange(false)}
      title={isEdit ? `编辑商品 · ${initialProduct?.name ?? ""}` : "新建商品"}
      width={640}
      footer={null}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" className="mt-2">
        <ProductFormFields showCode={!isEdit} />
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
