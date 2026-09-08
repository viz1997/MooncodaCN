"use client";

/**
 * 规格选择步骤（workbench 第五步）
 * 根据 draft.productTypeCode 从字典查可选尺寸 / 配件 / 是否能刻字。
 * 提交时调 submitFinalOrderAction（事务化扣 credit + 写 spec + 改状态）。
 */

import { Alert, App, Button, Card, Checkbox, Input, Select, Tag } from "antd";
import { useMemo, useState } from "react";

import {
  ACCESSORIES,
  getAccessory,
  getProductType,
} from "@/features/gpt-image/lib/product-catalog";

import type { DraftOrder } from "../agent-workbench-view";

interface SpecSelectStepProps {
  draft: DraftOrder;
  creditBalance: number;
  onSubmit: (spec: {
    productSize: string;
    accessoryCode: string | null;
    engravingText: string | null;
    engravingExposed: boolean | null;
  }) => Promise<void> | void;
  onBack: () => void;
}

export function SpecSelectStep({
  draft,
  creditBalance,
  onSubmit,
  onBack,
}: SpecSelectStepProps) {
  const { message } = App.useApp();
  const productType = useMemo(
    () => getProductType(draft.productTypeCode),
    [draft.productTypeCode]
  );

  const [size, setSize] = useState<string | undefined>(productType?.sizes[0]);
  const [accessory, setAccessory] = useState<string | undefined>(
    productType?.accessories[0]
  );
  const [engravingText, setEngravingText] = useState("");
  const [engravingExposed, setEngravingExposed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!productType) {
    return (
      <Card>
        <Alert
          type="error"
          showIcon
          message="模板未配置商品类别"
          description="请刷新页面或联系管理员"
        />
      </Card>
    );
  }

  // 扣费金额从草稿订单的模板快照拿；price=0 跳过余额校验
  const price = draft.template?.price ?? 0;
  const insufficient = price > 0 && creditBalance < price;

  const handleSubmit = async () => {
    if (!size) {
      message.error("请选择尺寸");
      return;
    }
    if (
      productType.capabilities.canEngrave &&
      engravingText.trim().length > 0
    ) {
      // OK
    }
    setSubmitting(true);
    try {
      await onSubmit({
        productSize: size,
        accessoryCode: accessory ?? null,
        engravingText:
          productType.capabilities.canEngrave && engravingText.trim().length > 0
            ? engravingText.trim()
            : null,
        engravingExposed:
          productType.capabilities.canEngrave && engravingText.trim().length > 0
            ? engravingExposed
            : null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <h2 className="text-base font-medium mb-3">选择产品规格</h2>

      <div className="rounded-md border bg-violet-500/5 px-3 py-2 mb-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">
            {productType.name}{" "}
            <Tag color="violet" className="!m-0 !ml-1">
              {productType.code}
            </Tag>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {price > 0
              ? `本次将扣除 ¥${price}，当前余额 ¥${creditBalance}`
              : `本次不扣费（模板价格 ¥0），当前余额 ¥${creditBalance}`}
          </div>
        </div>
        <Tag color={insufficient ? "red" : "green"} className="!m-0">
          {insufficient ? "余额不足" : price > 0 ? "余额充足" : "免费"}
        </Tag>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">
            尺寸 <span className="text-red-500">*</span>
          </label>
          <Select
            value={size}
            onChange={(v) => setSize(v)}
            className="!w-full !mt-1"
            options={productType.sizes.map((s) => ({
              value: s,
              label: `${s}cm`,
            }))}
            placeholder="选择尺寸"
          />
        </div>

        {productType.accessories.length > 0 && (
          <div>
            <label className="text-sm font-medium">配件</label>
            <Select
              value={accessory}
              onChange={(v) => setAccessory(v)}
              className="!w-full !mt-1"
              options={productType.accessories.map((code) => {
                const acc = getAccessory(code);
                return {
                  value: code,
                  label: acc?.name ?? code,
                };
              })}
              placeholder="选择配件"
              allowClear
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              可选配件：
              {productType.accessories
                .map((c) => ACCESSORIES.find((a) => a.code === c)?.name ?? c)
                .join(" / ")}
            </p>
          </div>
        )}

        {productType.capabilities.canEngrave && (
          <div className="space-y-2">
            <label className="text-sm font-medium">刻字（可选）</label>
            <Input.TextArea
              value={engravingText}
              onChange={(e) => setEngravingText(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="如：Love U / 2026-01-01（限 500 字）"
            />
            <Checkbox
              checked={engravingExposed}
              onChange={(e) => setEngravingExposed(e.target.checked)}
              disabled={engravingText.trim().length === 0}
            >
              <span className="text-xs">外露（不勾 = 内刻）</span>
            </Checkbox>
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-between">
        <Button onClick={onBack} disabled={submitting}>
          返回上一步
        </Button>
        <Button
          type="primary"
          loading={submitting}
          disabled={!size || insufficient}
          onClick={() => void handleSubmit()}
        >
          提交订单
        </Button>
      </div>
    </Card>
  );
}
