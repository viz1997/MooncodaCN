"use client";

/**
 * 已提交结果展示（workbench 终态）
 * 显示订单号 + 三件套 + 刻字 + 选中候选预览。
 */

import { Alert, Card, Descriptions, Tag } from "antd";
import { CheckCircle2 } from "lucide-react";

import {
  formatCustomization,
  formatProductSpec,
  getProductType,
} from "@/features/gpt-image/lib/product-catalog";

import type { DraftOrder } from "../agent-workbench-view";

interface ResultStepProps {
  draft: DraftOrder;
}

export function ResultStep({ draft }: ResultStepProps) {
  const productType = getProductType(draft.productTypeCode);

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
        <h2 className="text-base font-medium">订单已提交</h2>
      </div>

      <Alert
        type="success"
        showIcon
        className="!mb-4"
        message={`订单号 ${draft.orderNo}`}
        description="订单已提交至管理员队列，可在管理后台查看进度。"
      />

      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="产品类别">
          <Tag color="violet" className="!m-0">
            {productType?.code ?? "-"}
          </Tag>
          <span className="ml-2 text-sm">
            {productType?.name ?? "未知型号"}
          </span>
        </Descriptions.Item>
        <Descriptions.Item label="规格">
          <span className="text-sm">
            {formatProductSpec({
              productTypeCode: draft.productTypeCode,
              productSize: draft.productSize,
              accessoryCode: draft.accessoryCode,
            })}
          </span>
        </Descriptions.Item>
        {(draft.engravingText ?? "").trim().length > 0 && (
          <Descriptions.Item label="定制">
            <span className="text-sm">
              {formatCustomization({
                engravingText: draft.engravingText,
                engravingExposed: draft.engravingExposed,
              })}
            </span>
          </Descriptions.Item>
        )}
        <Descriptions.Item label="提交时间">
          <span className="text-sm font-mono">
            {draft.selectedAt
              ? new Date(draft.selectedAt).toLocaleString("zh-CN")
              : "-"}
          </span>
        </Descriptions.Item>
      </Descriptions>

      <div className="mt-4 text-xs text-muted-foreground">
        如需修改请联系平台管理员。
      </div>
    </Card>
  );
}
