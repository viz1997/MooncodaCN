"use client";

/**
 * 2026-09-08：用户维度 workbench 客户端壳
 *
 * 由 /image-gen RSC 注入登录用户 / 模板 / 草稿，渲染成「个人生图工具」UI。
 *
 * v0 范围（最小可用）：
 * - 显示登录用户信息
 * - 显示 active 模板网格，点击 → 创建草稿订单（status PENDING）
 * - 显示当前进行中的草稿订单（按状态分支）
 * - 草稿在 SELECTED 时显示完成提示
 *
 * 不在 v0（后续 PR 补）：
 * - TemplateSelectStep / SpecSelectStep / ResultStep 的完整工作流
 *   （上传 / 生成 / 选候选 / 选规格 / 提交）
 *   —— v0 先把入口 + 草稿生命周期打通，UI 走现有 generate-workbench-view
 *   （位于 /dashboard/generate）。
 * - 个人 credit 余额展示（顶部加个余额卡后续 PR）
 *
 * 备注：workbench 完整 UI 沿用既有 promptOrder + /api/orders/[token]/*
 * 公共路由（upload/poll/select/configure），新逻辑只负责「创建/查询/提交」
 * 三件事，所以 v0 这个壳就够把流程跑起来。
 */

import { App, Badge, Button, Card, Empty, Spin } from "antd";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  Package,
  Sparkles,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type {
  createUserDraftOrderAction,
  listUserWorkbenchAction,
  submitUserDraftOrderAction,
} from "@/features/image-gen/actions/workbench";

// ============================================
// 类型（与服务端 action 返回对齐）
// ============================================

type WorkbenchTemplates = NonNullable<
  Awaited<ReturnType<typeof listUserWorkbenchAction>>["data"]
>["templates"];

type WorkbenchDraft = NonNullable<
  Awaited<ReturnType<typeof listUserWorkbenchAction>>["data"]
>["draftOrder"];

interface UserWorkbenchViewProps {
  user: { id: string; name: string | null; email: string | null };
  templates: WorkbenchTemplates;
  draftOrder: WorkbenchDraft;
  actions: {
    createDraft: typeof createUserDraftOrderAction;
    submitDraft: typeof submitUserDraftOrderAction;
  };
}

// 草稿订单状态文案映射（中文 + 颜色）
const STATUS_META: Record<
  string,
  { label: string; color: string; description: string }
> = {
  PENDING: {
    label: "待上传",
    color: "default",
    description: "用户上传参考图后即可生成候选",
  },
  GENERATING: {
    label: "生成中",
    color: "processing",
    description: "服务端正在跑生成任务",
  },
  CANDIDATES_READY: {
    label: "待选择",
    color: "warning",
    description: "候选图已生成，请选择后提交",
  },
  SELECTED: {
    label: "已提交",
    color: "success",
    description: "已扣个人 credit 并锁定订单",
  },
};

export function UserWorkbenchView({
  user,
  templates,
  draftOrder,
  actions,
}: UserWorkbenchViewProps) {
  const router = useRouter();
  const { message } = App.useApp();
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  /**
   * 用户点模板卡 → 创建草稿订单 → 刷新页面让 RSC 重新拉数据
   *
   * 不在 client 里维护状态机（上传 / 生成 / 选候选 这些留给后续 PR 的
   * StepBar），v0 只打通「选模板 → 有草稿」这一段。
   */
  const handlePickTemplate = (templateId: string) => {
    setPendingTemplateId(templateId);
    startTransition(async () => {
      try {
        const res = await actions.createDraft({ templateId });
        if (!res?.data) throw new Error("创建草稿失败");
        message.success("已创建草稿订单");
        // 刷新 RSC，让 draftOrder 数据重载
        router.refresh();
      } catch (e) {
        message.error(e instanceof Error ? e.message : "创建失败");
      } finally {
        setPendingTemplateId(null);
      }
    });
  };

  /**
   * 草稿是 CANDIDATES_READY 时调用：扣 credit + 推进到 SELECTED。
   * 当前 v0 的 UI 上提供这个按钮只是为了让流程跑通；后续 PR 会把工作台
   * 完整步骤接入后，再决定按钮放哪、放给谁触发。
   */
  const handleSubmit = () => {
    if (!draftOrder) return;
    setSubmitting(true);
    startTransition(async () => {
      try {
        const res = await actions.submitDraft({ orderId: draftOrder.id });
        if (!res?.data) throw new Error("提交失败");
        message.success(
          `已提交，${res.data.creditsConsumed > 0 ? `扣减 ${res.data.creditsConsumed} 积分` : "无积分扣减"}`
        );
        router.refresh();
      } catch (e) {
        message.error(e instanceof Error ? e.message : "提交失败");
      } finally {
        setSubmitting(false);
      }
    });
  };

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 space-y-8">
      {/* ===== Header ===== */}
      <header className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">生图工作台</h1>
          <p className="text-sm text-muted-foreground mt-1">
            登录后使用：选模板 → 上传参考图 → 生成候选 → 选规格 → 扣个人积分提交
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <User className="h-4 w-4" />
          <span>{user.name ?? user.email ?? user.id}</span>
        </div>
      </header>

      {/* ===== 当前草稿 ===== */}
      {draftOrder ? (
        <DraftBanner
          draft={draftOrder}
          submitting={submitting || isPending}
          onSubmit={handleSubmit}
        />
      ) : (
        <Empty
          image={
            <Package className="h-10 w-10 mx-auto text-muted-foreground" />
          }
          description={
            <span className="text-muted-foreground">
              还没有进行中的订单 —— 从下方选个模板开个工作台吧
            </span>
          }
        />
      )}

      {/* ===== 模板网格 ===== */}
      <section>
        <h2 className="text-lg font-medium mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          可选模板
          <span className="text-xs text-muted-foreground font-normal">
            （共 {templates.length} 个）
          </span>
        </h2>
        {templates.length === 0 ? (
          <Empty description="暂无可用模板" />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                disabled={
                  isPending ||
                  pendingTemplateId === t.id ||
                  // 有草稿时禁用新模板选择（必须先完成或取消）
                  draftOrder !== null
                }
                loading={pendingTemplateId === t.id}
                onPick={() => handlePickTemplate(t.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ===== 底部说明 ===== */}
      <footer className="text-xs text-muted-foreground border-t pt-4">
        <p>
          v0：仅打通「选模板 → 创建草稿 → 提交扣费」骨架。完整工作台 （上传 /
          生成 / 选候选 / 选规格）将由后续 PR 的 StepBar 组件接入。
        </p>
        <p className="mt-1">
          完整流程对应 promptOrder 状态机：PENDING → GENERATING →
          CANDIDATES_READY → SELECTED。
        </p>
      </footer>
    </div>
  );
}

// ============================================
// 子组件：草稿订单 banner
// ============================================

function DraftBanner({
  draft,
  submitting,
  onSubmit,
}: {
  draft: NonNullable<WorkbenchDraft>;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const meta = STATUS_META[draft.status] ?? {
    label: draft.status,
    color: "default",
    description: "",
  };

  return (
    <Card size="small" className="border-l-4 border-l-blue-500">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge color={meta.color} text={meta.label} />
            <span className="text-sm font-medium">{draft.template.name}</span>
            <span className="text-xs text-muted-foreground">
              · token: {draft.token.slice(0, 8)}...
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>批次 {draft.uploadCount}</span>
            <span>· 每批 {draft.imagesPerUpload} 张</span>
            <span>· 已上传 {draft.uploadedImageCount}</span>
            <span>· 候选批 {draft.candidateGroups}</span>
            <span>· 已选 {draft.selections}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {draft.status === "CANDIDATES_READY" && (
            <Button
              type="primary"
              icon={<ArrowRight className="h-4 w-4" />}
              loading={submitting}
              onClick={onSubmit}
            >
              提交订单
            </Button>
          )}
          {draft.status === "SELECTED" && (
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          )}
          {(draft.status === "PENDING" || draft.status === "GENERATING") && (
            <Clock className="h-5 w-5 text-amber-500" />
          )}
          {draft.status === "GENERATING" && (
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
          )}
        </div>
      </div>
    </Card>
  );
}

// ============================================
// 子组件：模板卡
// ============================================

function TemplateCard({
  template,
  disabled,
  loading,
  onPick,
}: {
  template: WorkbenchTemplates[number];
  disabled: boolean;
  loading: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      className="group block w-full text-left rounded-lg border bg-card p-3 transition hover:border-blue-400 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:shadow-none"
    >
      <div className="aspect-square rounded-md bg-muted overflow-hidden mb-2 flex items-center justify-center">
        {template.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={template.coverUrl}
            alt={template.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <Sparkles className="h-8 w-8 text-muted-foreground" />
        )}
      </div>
      <div className="space-y-1">
        <div className="font-medium text-sm truncate">{template.name}</div>
        <div className="text-xs text-muted-foreground line-clamp-2 min-h-[2em]">
          {template.description ?? "—"}
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {template.size} · {template.candidateCount} 张
          </span>
          {(template.price ?? 0) > 0 ? (
            <Badge color="gold" text={`${template.price} 积分`} />
          ) : (
            <Badge color="default" text="免费" />
          )}
        </div>
      </div>
      {loading && (
        <div className="mt-2 flex items-center justify-center text-xs text-blue-600">
          <Spin size="small" /> <span className="ml-1">创建草稿中…</span>
        </div>
      )}
    </button>
  );
}
