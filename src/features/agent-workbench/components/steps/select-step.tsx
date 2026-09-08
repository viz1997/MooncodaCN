"use client";

/**
 * 候选选择步骤（workbench 第四步）
 * 显示所有候选（candidates JSON 数组），点选后调 /select 提交 → 进入 spec 阶段。
 */

import { App, Button, Card, Empty, Spin, Tag } from "antd";
import { useEffect, useState } from "react";

interface SelectStepProps {
  orderToken: string;
  onSelected: () => Promise<void> | void;
}

export function SelectStep({ orderToken, onSelected }: SelectStepProps) {
  const { message } = App.useApp();
  const [submitting, setSubmitting] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);

  /**
   * 单图单批场景：选第 0 张候选即可。
   * 服务端 /select 接受 [{ batchIdx: 0, candIdx: chosen }]，单批场景 batchIdx 永远 = 0。
   */
  const handleConfirm = async () => {
    if (chosen === null) {
      message.warning("请先选择一个候选");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/orders/${orderToken}/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selections: [{ batchIdx: 0, candIdx: chosen }],
        }),
      });
      if (!res.ok) {
        throw new Error("提交选择失败");
      }
      const json = (await res.json()) as { success?: boolean; error?: string };
      if (!json.success) {
        throw new Error(json.error ?? "提交选择失败");
      }
      message.success("已选择候选，请选择产品规格");
      await onSelected();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "提交选择失败";
      message.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <h2 className="text-base font-medium mb-3">选择候选效果图</h2>
      <p className="text-xs text-muted-foreground mb-4">
        点击候选图选中后确认，进入规格选择步骤。
      </p>
      <CandidateGrid
        orderToken={orderToken}
        chosen={chosen}
        onChoose={setChosen}
      />
      <div className="mt-4 flex justify-end">
        <Button
          type="primary"
          loading={submitting}
          disabled={chosen === null}
          onClick={() => void handleConfirm()}
        >
          确认选择
        </Button>
      </div>
    </Card>
  );
}

/**
 * 候选网格：拉取 candidates 并以单图渲染（workbench 单图单批场景）。
 * 调 GET /api/orders/[token]（基础 GET）拿到完整 order view 含 candidates。
 */
function CandidateGrid({
  orderToken,
  chosen,
  onChoose,
}: {
  orderToken: string;
  chosen: number | null;
  onChoose: (idx: number) => void;
}) {
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stopped = false;
    const fetchOrder = async () => {
      try {
        const res = await fetch(`/api/agent-workbench/${orderToken}/status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as {
          data?: { candidates?: string[][] };
        };
        if (stopped || !json.data?.candidates) return;
        // 取第一个 batch 的所有候选（workbench 单图单批）
        const firstBatch = json.data.candidates[0] ?? [];
        setImages(firstBatch);
      } catch {
        // ignore
      } finally {
        if (!stopped) setLoading(false);
      }
    };
    void fetchOrder();
    return () => {
      stopped = true;
    };
  }, [orderToken]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spin />
      </div>
    );
  }
  if (images.length === 0) {
    return <Empty description="暂无候选" />;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {images.map((url, idx) => (
        <button
          key={url}
          type="button"
          onClick={() => onChoose(idx)}
          className={`relative aspect-square overflow-hidden rounded-md border-2 transition ${
            chosen === idx
              ? "border-violet-500 ring-2 ring-violet-300"
              : "border-transparent hover:border-slate-300"
          }`}
        >
          {/* 用 img 简化，避免引入代理；R2 公开域一般允许 img 直连 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`候选 ${idx + 1}`}
            className="h-full w-full object-cover"
          />
          {chosen === idx && (
            <Tag color="violet" className="!absolute !right-1 !top-1 !m-0">
              已选
            </Tag>
          )}
        </button>
      ))}
    </div>
  );
}
