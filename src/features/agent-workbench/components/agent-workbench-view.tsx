"use client";

/**
 * 代理商 workbench 主视图（2026-09-07）
 *
 * 状态机（draftOrder.status）：
 * - null（无草稿）→ TemplateSelectStep
 * - PENDING → UploadStep（单图）
 * - GENERATING → GeneratingStep（轮询 /api/orders/{token}/status）
 * - CANDIDATES_READY → SelectStep → 选完后 → SpecSelectStep
 * - SELECTED → ResultStep（只读展示 + 订单详情）
 *
 * 复用现有 /api/orders/[token]/{upload,select,status} 路由 —— workbench 草稿
 * 也是 promptOrder，token 在 createDraftOrderAction 时生成，前端用它调用
 * 上传/选择/状态接口。这样 upload/generation 的服务端逻辑只维护一份。
 *
 * 终态提交走专属 /api/agent-workbench/{token}/submit-final（实现为
 * server action：submitFinalOrderAction），因为要事务化扣 credit。
 */

import { Alert, App, Tag } from "antd";
import { useCallback, useState } from "react";

import {
  createDraftOrderAction,
  submitFinalOrderAction,
} from "@/features/agent-workbench/actions/workbench";
import { GeneratingStep } from "./steps/generating-step";
import { ResultStep } from "./steps/result-step";
import { SelectStep } from "./steps/select-step";
import { SpecSelectStep } from "./steps/spec-select-step";
import { TemplateSelectStep } from "./steps/template-select-step";
import { UploadStep } from "./steps/upload-step";

// ============================================
// 类型：与 server action 返回对齐
// ============================================

export interface AgentInfo {
  id: string;
  name: string;
  contact: string | null;
  creditBalance: number;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  coverUrl: string | null;
  price: number | null;
  productTypeCode: string | null;
  candidateCount: number;
  size: string;
  /** DB 返回 string（drizzle 不强类型 enum），前端按 "grid" | "separate" 解释 */
  outputMode: string | null;
  model: string | null;
}

export interface DraftOrder {
  id: string;
  token: string;
  orderNo: string;
  status:
    | "PENDING"
    | "GENERATING"
    | "CANDIDATES_READY"
    | "SELECTED"
    | "FAILED"
    | "CANCELLED";
  uploadedImages: string | null;
  candidates: string | null;
  selections: string | null;
  selectedAt: Date | null;
  productTypeCode: string | null;
  productSize: string | null;
  accessoryCode: string | null;
  engravingText: string | null;
  engravingExposed: boolean | null;
  templateId: string;
  /** 该草稿订单对应的模板快照（含 price），用于 SpecSelectStep 显示扣费提示 */
  template?: {
    id: string;
    name: string;
    price: number | null;
    productTypeCode: string | null;
  } | null;
}

interface AgentWorkbenchViewProps {
  token: string;
  agent: AgentInfo;
  templates: TemplateSummary[];
  draftOrder: DraftOrder | null;
}

// ============================================
// 主组件
// ============================================

export function AgentWorkbenchView({
  token,
  agent: initialAgent,
  templates,
  draftOrder: initialDraft,
}: AgentWorkbenchViewProps) {
  const { message } = App.useApp();
  const [agent, setAgent] = useState(initialAgent);
  // 'spec' 阶段是 CANDIDATES_READY 选完之后过渡到选规格的子步骤
  const [phase, setPhase] = useState<"order" | "spec">("order");
  // 用 initialDraft 当真实 draft 的快照，每次刷新通过 reload 重新初始化
  // 同时把 template 信息合并进去，SpecSelectStep 需要看价格
  const draft = initialDraft
    ? {
        ...initialDraft,
        template:
          templates.find((t) => t.id === initialDraft.templateId) ?? null,
      }
    : null;

  /**
   * 创建草稿订单（TemplateSelectStep 选中模板后调用）
   */
  const handleSelectTemplate = useCallback(
    async (templateId: string) => {
      try {
        const res = await createDraftOrderAction({ token, templateId });
        if (!res?.data) {
          message.error("创建订单失败");
          return;
        }
        const data = res.data;
        if (data.ok) {
          // 重新拉 draftOrder —— 真实 status / token
          await refreshDraft();
          message.success("已创建订单，开始上传原图");
        } else if (data.code === "DRAFT_EXISTS") {
          // 已有 draft，跳到续做
          message.info("您有进行中的订单，正在续做");
          await refreshDraft();
        } else {
          message.error("未知错误");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "创建订单失败";
        message.error(msg);
      }
    },
    [token, message]
  );

  /**
   * 上传完成后由 UploadStep 调，进入 GENERATING 状态。
   * 调用 /api/orders/{token}/upload 即可，response 即含新状态。
   */
  const handleUploaded = useCallback(async () => {
    await refreshDraft();
  }, []);

  /**
   * SelectStep 选完候选后，调 /select 接口，再切到 SpecSelectStep。
   */
  const handleSelected = useCallback(async () => {
    await refreshDraft();
    setPhase("spec");
  }, []);

  /**
   * SpecSelectStep 提交后调 —— 核心事务（写规格 + 扣 credit）。
   */
  const handleSubmitFinal = useCallback(
    async (spec: {
      productSize: string;
      accessoryCode: string | null;
      engravingText: string | null;
      engravingExposed: boolean | null;
    }) => {
      if (!draft) {
        message.error("订单丢失");
        return;
      }
      try {
        const res = await submitFinalOrderAction({
          token,
          orderId: draft.id,
          productSize: spec.productSize,
          accessoryCode: spec.accessoryCode,
          engravingText: spec.engravingText,
          engravingExposed: spec.engravingExposed,
        });
        if (!res?.data) {
          message.error("提交失败");
          return;
        }
        const data = res.data;
        // 更新余额
        setAgent((prev) => ({
          ...prev,
          creditBalance: data.newBalance,
        }));
        await refreshDraft();
        setPhase("order");
        message.success(
          data.deducted > 0 ? `已提交，扣减 ¥${data.deducted}` : "已提交订单"
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "提交失败";
        if (msg.includes("INSUFFICIENT_CREDITS")) {
          message.error("积分余额不足，请联系管理员充值");
        } else {
          message.error(msg);
        }
      }
    },
    [token, draft, message]
  );

  /**
   * 重新从服务端拉 draft order 状态。
   * 用 /api/agent-workbench/[token]/status GET，避免每次刷新都走 server action。
   */
  const refreshDraft = useCallback(async () => {
    if (!draft) return;
    try {
      const res = await fetch(`/api/agent-workbench/${draft.token}/status`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        success?: boolean;
        data?: {
          status: DraftOrder["status"];
        };
      };
      if (!json.success || !json.data) return;
      // 简单做法：直接 reload 页面（首次做不需要精细化）
      // 复杂做法：再调一个 server action 拉完整 DraftOrder。
      // 这里用 reload 简化实现，保证看到的状态与服务端 100% 一致。
      window.location.reload();
    } catch {
      // 网络错误静默忽略
    }
  }, [draft]);

  // 渲染
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
        {/* 顶部：代理商身份 + 余额 */}
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">代理商 Workbench</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {agent.name}
              {agent.contact && ` · ${agent.contact}`}
            </p>
          </div>
          <Tag color="violet" className="!m-0 !text-sm">
            余额 ¥{agent.creditBalance}
          </Tag>
        </header>

        {/* 没有可用模板 */}
        {templates.length === 0 && (
          <Alert
            type="warning"
            showIcon
            message="暂无可用模板"
            description="请联系平台分配商品类别后再来。"
          />
        )}

        {/* 状态机 */}
        {templates.length > 0 && !draft && (
          <TemplateSelectStep
            templates={templates}
            onSelect={handleSelectTemplate}
          />
        )}

        {draft && draft.status === "PENDING" && (
          <UploadStep orderToken={draft.token} onUploaded={handleUploaded} />
        )}

        {draft && draft.status === "GENERATING" && (
          <GeneratingStep orderToken={draft.token} />
        )}

        {draft && draft.status === "CANDIDATES_READY" && phase === "order" && (
          <SelectStep
            orderToken={draft.token}
            onSelected={handleSelected}
          />
        )}

        {draft && phase === "spec" && draft.status === "CANDIDATES_READY" && (
          <SpecSelectStep
            draft={draft}
            creditBalance={agent.creditBalance}
            onSubmit={handleSubmitFinal}
            onBack={() => setPhase("order")}
          />
        )}

        {draft && draft.status === "SELECTED" && <ResultStep draft={draft} />}

        {draft &&
          (draft.status === "FAILED" || draft.status === "CANCELLED") && (
            <Alert
              type="error"
              showIcon
              message={`订单${draft.status === "FAILED" ? "生成失败" : "已取消"}`}
              description="请刷新页面或联系管理员"
            />
          )}
      </div>
    </div>
  );
}
