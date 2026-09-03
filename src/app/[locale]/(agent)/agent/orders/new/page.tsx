"use client";

/**
 * 2026-09-03：代理商 portal 新建订单页（ToB 自下单）。
 *
 * 复用 AgentOrdersView 的"新建"按钮逻辑（打开同一个 AgentOrderFormDialog），
 * 但单独建一个 page 让 /agent/orders/new URL 也能直接落地打开表单。
 * 这样侧边栏"新建订单"导航 = 落地页；用户体验"我点了一下就有个表单"。
 */

import { useEffect, useState } from "react";
import { agentListTemplatesAction } from "@/features/agent/actions/agent-portal";

import { AgentOrderFormDialog } from "@/features/agent/components/agent-order-form-dialog";
import type {
  OrderView,
  PromptTemplateView,
} from "@/features/gpt-image/lib/types";
import { useRouter } from "@/i18n/routing";

export default function AgentNewOrderPage() {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [templates, setTemplates] = useState<PromptTemplateView[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError(null);
    agentListTemplatesAction()
      .then((res) => {
        if (cancelled) return;
        if (res?.data?.templates) setTemplates(res.data.templates);
        else throw new Error("返回数据格式异常");
      })
      .catch((e) => {
        if (cancelled) return;
        setTemplatesError(e instanceof Error ? e.message : "未知错误");
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCreated = (_order: OrderView) => {
    // 创建后跳公开链接页（同 AgentOrdersView.handleCreated）
    // 这里 order.token 已经附在 URL 路径里了，由 router.push 走
    router.push(`/p/${_order.token}`);
  };

  const handleClose = () => {
    setOpen(false);
    // 关闭后跳回 /agent/orders，避免停留在空 URL
    router.push("/agent/orders");
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-violet-900">
          新建订单
        </h2>
        <p className="text-sm text-muted-foreground">
          填写订单基本信息 + 产品规格，创建后会立即跳到订单页上传参考图
        </p>
      </div>

      <AgentOrderFormDialog
        open={open}
        onOpenChange={(o) => {
          if (!o) handleClose();
          else setOpen(true);
        }}
        templates={templates}
        templatesLoading={templatesLoading}
        templatesError={templatesError}
        onRetryTemplates={() => {
          setTemplatesLoading(true);
          setTemplatesError(null);
          agentListTemplatesAction().then((res) => {
            if (res?.data?.templates) setTemplates(res.data.templates);
          });
        }}
        onCreated={handleCreated}
      />
    </div>
  );
}
