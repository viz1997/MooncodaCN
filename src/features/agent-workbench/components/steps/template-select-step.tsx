"use client";

/**
 * 模板选择步骤（workbench 第一步）
 * 显示 agent 授权范围内的所有 active 模板，点击调 createDraftOrderAction。
 */

import { Button, Card, Empty, Tag } from "antd";
import { useState } from "react";

import type { TemplateSummary } from "../agent-workbench-view";

interface TemplateSelectStepProps {
  templates: TemplateSummary[];
  onSelect: (templateId: string) => Promise<void> | void;
}

export function TemplateSelectStep({
  templates,
  onSelect,
}: TemplateSelectStepProps) {
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  if (templates.length === 0) {
    return (
      <Card>
        <Empty description="暂无可用模板" />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-base font-medium">选择商品类别</h2>
      <p className="text-xs text-muted-foreground">
        点击下方任一模板开始下单。每张订单只生成 1
        张效果图，选完候选后再选择产品规格。
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {templates.map((t) => (
          <Card
            key={t.id}
            hoverable
            cover={
              t.coverUrl ? (
                <div
                  className="aspect-video bg-muted bg-cover bg-center"
                  style={{ backgroundImage: `url(${t.coverUrl})` }}
                />
              ) : (
                <div className="aspect-video bg-muted flex items-center justify-center text-muted-foreground text-xs">
                  无封面
                </div>
              )
            }
            actions={[
              <Button
                key="select"
                type="primary"
                size="small"
                loading={submittingId === t.id}
                onClick={() => {
                  setSubmittingId(t.id);
                  const p = onSelect(t.id);
                  if (p && typeof (p as Promise<void>).finally === "function") {
                    void (p as Promise<void>).finally(() =>
                      setSubmittingId(null)
                    );
                  } else {
                    setSubmittingId(null);
                  }
                }}
              >
                选择此模板
              </Button>,
            ]}
          >
            <Card.Meta
              title={
                <div className="flex items-center gap-2">
                  <span>{t.name}</span>
                  {t.productTypeCode && (
                    <Tag color="violet" className="!m-0 !text-[10px]">
                      {t.productTypeCode}
                    </Tag>
                  )}
                  {(t.price ?? 0) > 0 && (
                    <Tag color="emerald" className="!m-0 !text-[10px]">
                      ¥{t.price}
                    </Tag>
                  )}
                </div>
              }
              description={
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {t.description}
                </p>
              }
            />
          </Card>
        ))}
      </div>
    </div>
  );
}
