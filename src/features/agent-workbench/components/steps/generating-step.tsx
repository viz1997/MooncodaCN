"use client";

/**
 * 生成中步骤（workbench 第三步）
 * 轮询 /api/orders/[token]/status 直到 status 切到 CANDIDATES_READY。
 * 轮询间隔 3s，达到 CANDIDATES_READY 后 reload 页面让上层渲染 SelectStep。
 */

import { Alert, Card, Progress, Spin } from "antd";
import { useEffect, useState } from "react";

interface GeneratingStepProps {
  orderToken: string;
}

interface StatusResponse {
  status: string;
  candidateGroups?: number;
  uploadedImageCount?: number;
  errorMessage?: string | null;
}

export function GeneratingStep({ orderToken }: GeneratingStepProps) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/orders/${orderToken}/status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: StatusResponse };
        if (stopped || !json.data) return;
        setStatus(json.data);
        // 进入 CANDIDATES_READY 或终态 → reload 让上层切步骤
        if (
          json.data.status === "CANDIDATES_READY" ||
          json.data.status === "SELECTED" ||
          json.data.status === "FAILED" ||
          json.data.status === "CANCELLED"
        ) {
          window.location.reload();
        }
      } catch (e) {
        if (stopped) return;
        setError(e instanceof Error ? e.message : "轮询失败");
      }
    };
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [orderToken]);

  const groups = status?.candidateGroups ?? 0;
  const total = status?.uploadedImageCount ?? 1;

  return (
    <Card>
      <div className="space-y-4 py-6 text-center">
        <Spin size="large" />
        <div>
          <h2 className="text-base font-medium">正在生成效果图…</h2>
          <p className="text-xs text-muted-foreground mt-1">
            一般需要 30 秒到 2 分钟，请勿关闭页面。
          </p>
        </div>
        {groups > 0 && (
          <div className="mx-auto max-w-xs">
            <Progress
              percent={Math.min(
                100,
                Math.round((groups / Math.max(total, 1)) * 100)
              )}
              format={() => `${groups}/${total} 批完成`}
            />
          </div>
        )}
        {error && <Alert type="warning" message={error} showIcon />}
        {status?.errorMessage && (
          <Alert type="error" message={status.errorMessage} showIcon />
        )}
      </div>
    </Card>
  );
}
