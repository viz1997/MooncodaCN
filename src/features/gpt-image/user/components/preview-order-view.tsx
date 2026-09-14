"use client";

/**
 * /p/[token] preview 流 6 步工作台（2026-09-14 升级）
 *
 * 历史：
 *   之前 PreviewShareView + PreviewConfirmStep 是「一次性确认」UI（客人只能看
 *   预览图 + 选 cell + 确认）。代理商要求升级：客人走完整 6 步工作台
 *   （upload → generate → select → regenerate → configure → confirm），与
 *   ToC /order/[token] 等价但数据源走 preview_share 表。
 *
 * 实现策略：
 *   - 数据源 = preview_share，service 层通过 /api/orders/[token] GET 路由
 *     投影 preview_share → OrderView 形状，useOrder/useSelections/useOrderActions
 *     不改。
 *   - 渲染逻辑与 UserOrderView 几乎一致，差异：
 *     1. SELECTED 阶段（客人已选 cell）→ 显示「PreviewConfirmStep」含
 *        confirm CTA（确认下单），而**不是** ResultStep（ToC SELECTED 终态）。
 *     2. 顶部 banner 提示「代理商分享预览 · 还可重新生成 N 次」。
 *     3. 取消按钮文案适配 preview 流（释放积分）。
 *
 * 为什么不全复用 UserOrderView：UserOrderView 的 isSelected 分支硬接 ResultStep，
 * 而 preview 流 SELECTED ≠ ToC SELECTED（preview 流是「客人已选 cell 待 confirm」）。
 * 把 UserOrderContent 提取成 render-prop 改造面太大，这里直接复制并改 isSelected 分支。
 */

import {
  AlertTriangle,
  Ban,
  Loader2,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { OrderStatus, OrderView } from "@/features/gpt-image/lib/types";
import { Link } from "@/i18n/routing";
import { CancelledPanel } from "./cancelled-panel";
import { FailureNotice } from "./failure-notice";
import { GenerateStep } from "./generate-step";
import { InvalidLinkScreen } from "./invalid-link-screen";
import { LoadingScreen } from "./loading-screen";
import { ProductConfigSection } from "./product-config-section";
import { ResultStep } from "./result-step";
import { SelectStep } from "./select-step";
import { UploadStep } from "./upload-step";
import { useOrder } from "./use-order";
import type { UseOrderActionsResult } from "./use-order-actions";
import { useOrderActions } from "./use-order-actions";
import type { UseOrderHistoryResult } from "./use-order-history";
import { useOrderHistory } from "./use-order-history";
import type { UseSelectionsResult } from "./use-selections";
import { useSelections } from "./use-selections";

interface PreviewOrderViewProps {
  token: string;
  /** preview 流 metadata —— banner / TopBar 显示 */
  previewOrderNo: string;
  templateName: string;
}

export function PreviewOrderView({
  token,
  previewOrderNo,
  templateName,
}: PreviewOrderViewProps) {
  const { order, loading, notFound, refresh, quietEndsAt } = useOrder(token);
  const actions = useOrderActions({ token, refresh });
  const selection = useSelections(order);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (loading) return <LoadingScreen />;
  if (notFound || !order) return <InvalidLinkScreen />;

  return (
    <PreviewOrderContent
      token={token}
      order={order}
      actions={actions}
      selection={selection}
      cancelOpen={cancelOpen}
      setCancelOpen={setCancelOpen}
      refreshOrder={refresh}
      quietEndsAt={quietEndsAt}
      previewOrderNo={previewOrderNo}
      templateName={templateName}
    />
  );
}

interface PreviewOrderContentProps {
  token: string;
  order: OrderView;
  actions: UseOrderActionsResult;
  selection: UseSelectionsResult;
  cancelOpen: boolean;
  setCancelOpen: (v: boolean) => void;
  refreshOrder: () => Promise<void>;
  quietEndsAt: number | null;
  previewOrderNo: string;
  templateName: string;
}

function PreviewOrderContent({
  token,
  order,
  actions,
  selection,
  cancelOpen,
  setCancelOpen,
  refreshOrder,
  quietEndsAt,
  previewOrderNo,
  templateName,
}: PreviewOrderContentProps) {
  const status = order.status;

  const historyEnabled = status === "CANDIDATES_READY" || status === "FAILED";
  const history: UseOrderHistoryResult = useOrderHistory({
    token,
    enabled: historyEnabled,
  });

  const uploadedCount = order.uploadedImageCount ?? 0;
  const uploadCount = order.uploadCount ?? 1;
  const imagesPerUpload = order.imagesPerUpload ?? 1;
  const candidateCount = order.candidateCount ?? order.template.candidateCount;
  const readyGroups = order.candidateGroups ?? 0;

  const isPending = status === "PENDING";
  const isGenerating = status === "GENERATING";
  const isReady = status === "CANDIDATES_READY";
  const isSelected = status === "SELECTED"; // preview 流：客人已选 cell 待 confirm
  const isCancelled = status === "CANCELLED";
  const isFailed = status === "FAILED";

  const effectiveGenerating = isGenerating || actions.regenerating;
  const allowReupload = !isSelected && !isCancelled && !effectiveGenerating;

  const showSelectStep =
    allowReupload && isReady && uploadedCount > 0 && selection.pendingCount > 0;
  const showUploadStep =
    allowReupload &&
    (isPending ||
      isFailed ||
      (isReady && selection.pendingCount === 0 && uploadedCount < uploadCount));
  // preview 流 cancel 在 candidates_ready / selected / uploaded / pending 等都可走（释放锁定积分）。
  // 不允许 cancelled / failed（failed 是 Lingting 失败，用户可重新生成）。
  const canCancel = !isCancelled && !effectiveGenerating;

  const handleSubmit = () => {
    const payload = selection.toPayload();
    if (!payload) return;
    void actions.submit(payload);
  };

  const handleConfirm = async () => {
    // preview 流 batchCount=1，selectedIndex 即 batchIdx=0 的 candIdx
    const selections = order.selections;
    const firstSelection =
      selections && selections.length > 0
        ? (selections.find((s) => s !== null) ?? 0)
        : 0;
    const ok = await actions.confirmPreview(firstSelection);
    if (ok) {
      // refresh 让 status='confirmed' 投影到 SELECTED → page.tsx redirect 到 linkedOrderId
      await refreshOrder();
    }
  };

  const regenerateLimit = order.regenerateLimit ?? 0;
  const usedRegenerateCount = order.regenerateUsedByBatch?.[0] ?? 0;
  const remainingRegenerate = Math.max(
    0,
    regenerateLimit - usedRegenerateCount
  );

  const mainHasFixedCta = showSelectStep || isSelected;

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa]">
      {/* ── 顶部 preview 流提示 banner ── */}
      <PreviewBanner
        previewOrderNo={previewOrderNo}
        templateName={templateName}
        regenerateLimit={regenerateLimit}
        remainingRegenerate={remainingRegenerate}
      />

      {/* ── TopBar（mobile-first 单列） ── */}
      <PreviewTopBar
        templateName={order.template.name}
        orderNo={order.orderNo}
        status={status}
        canCancel={canCancel}
        cancelling={actions.cancelling}
        onCancelClick={() => setCancelOpen(true)}
      />

      {/* ── 主内容 ── */}
      <main
        className={[
          "mx-auto w-full max-w-md flex-1 px-5",
          mainHasFixedCta ? "pb-32" : "pb-10",
        ].join(" ")}
      >
        {isCancelled ? (
          <CancelledPanel cancelledAt={order.cancelledAt} />
        ) : (
          <div className="space-y-4">
            {isFailed && (
              <FailureNotice
                message={order.errorMessage}
                canRetry={showUploadStep}
                onRetryAll={() => void actions.retryAll().then(refreshOrder)}
                retrying={actions.retryingAll}
              />
            )}

            <ProductConfigSection
              order={order}
              // preview 流在 pending/uploaded/generating/candidates_ready 都允许改规格
              editable={isPending || isGenerating || isReady}
              saving={actions.configuring}
              onSave={actions.configure}
            />

            {showUploadStep && (
              <UploadStep
                templateName={order.template.name}
                uploadCount={uploadCount}
                imagesPerUpload={imagesPerUpload}
                uploadedImageCount={uploadedCount}
                candidateCount={candidateCount}
                hasFailure={isFailed}
                uploading={actions.uploading}
                onUpload={async (files) => {
                  await actions.upload(files);
                  return true;
                }}
              />
            )}

            {effectiveGenerating && (
              <GenerateStep
                token={token}
                updatedAt={order.updatedAt}
                uploadedImageCount={uploadedCount}
                imagesPerUpload={imagesPerUpload}
                readyGroups={readyGroups}
                quietEndsAt={quietEndsAt}
                stopping={actions.stopping}
                onStopClick={() => void actions.stopGeneration()}
              />
            )}

            {showSelectStep && (
              <SelectStep
                token={token}
                updatedAt={order.updatedAt}
                batchCount={
                  imagesPerUpload > 1
                    ? Math.ceil(uploadedCount / imagesPerUpload)
                    : uploadedCount
                }
                imagesPerUpload={imagesPerUpload}
                uploadedImageCount={uploadedCount}
                candidateCount={candidateCount}
                outputMode={order.template.outputMode ?? "grid"}
                selections={selection.selections}
                selectedCount={selection.selectedCount}
                lockedCount={selection.lockedCount}
                isLocked={selection.isLocked}
                submitting={actions.submitting}
                regenerating={actions.regenerating}
                onToggle={selection.toggle}
                onSubmit={handleSubmit}
                onRegenerate={actions.regenerate}
                regenerateLimit={regenerateLimit}
                regenerateUsedByBatch={order.regenerateUsedByBatch ?? []}
                snapshots={history.history}
              />
            )}

            {/* preview 流 SELECTED 阶段：客人已选 cell，显示 confirm CTA。
                与 ToC ResultStep 不同 —— preview 流 SELECTED ≠ 终态，需再点 confirm
                走 guest-confirm 路由（扣代理商 basePrice + 释放剩余 + 新建 promptOrder）。 */}
            {isSelected && (
              <PreviewConfirmBlock
                token={token}
                order={order}
                previewOrderNo={previewOrderNo}
                templateName={templateName}
                candidateCount={candidateCount}
                outputMode={order.template.outputMode ?? "grid"}
                updatedAt={order.updatedAt}
                onConfirm={handleConfirm}
              />
            )}
          </div>
        )}

        {/* 品牌脚注 */}
        <div className="mt-12 flex items-center justify-center gap-1.5 pb-2 text-center text-xs font-medium leading-none text-stone-400">
          <Link
            href="/"
            aria-label="Mooncoda 首页"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 rounded"
          >
            <img src="/logo.svg" alt="Mooncoda" className="h-4 w-4 shrink-0" />
            <span className="tracking-tight">Mooncoda梦可达</span>
          </Link>
          <span className="text-stone-300">·</span>
          <span>代理商分享预览</span>
        </div>
      </main>

      {/* 取消 AlertDialog */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃这次预览？</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-red-600">
                预览将作废，预扣的积分会原路退还。
              </span>
              <br />
              此操作不可恢复，如需重新预览请联系代理商重新分享链接。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actions.cancelling}>
              再想想
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              disabled={actions.cancelling}
              onClick={(e) => {
                e.preventDefault();
                void actions.cancel().then((ok) => ok && setCancelOpen(false));
              }}
            >
              {actions.cancelling ? (
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="h-4 w-4 animate-spin" /> 取消中
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Ban className="h-4 w-4" /> 确认放弃（不可恢复）
                </span>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ====================================================================== */
/* Preview 顶部 banner + TopBar + Confirm 块 — 内联组件                    */
/* ====================================================================== */

interface PreviewBannerProps {
  previewOrderNo: string;
  templateName: string;
  regenerateLimit: number;
  remainingRegenerate: number;
}

function PreviewBanner({
  previewOrderNo,
  templateName,
  regenerateLimit,
  remainingRegenerate,
}: PreviewBannerProps) {
  return (
    <div className="border-b border-indigo-100 bg-gradient-to-r from-indigo-50/80 to-violet-50/60">
      <div className="mx-auto flex max-w-md items-center gap-2 px-5 py-2">
        <Sparkles className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
        <div className="flex-1 min-w-0 text-[11px] leading-tight">
          <span className="font-medium text-stone-700">代理商分享预览</span>
          <span className="text-stone-400 ml-1">· {templateName}</span>
        </div>
        {regenerateLimit > 0 && (
          <span className="shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-indigo-700 shadow-sm">
            还可重新生成 {remainingRegenerate}/{regenerateLimit} 次
          </span>
        )}
      </div>
      <div className="mx-auto max-w-md px-5 pb-1.5 text-[10px] text-stone-400 tabular-nums">
        凭证号：{previewOrderNo}
      </div>
    </div>
  );
}

interface PreviewTopBarProps {
  templateName: string;
  orderNo: string;
  status: OrderStatus;
  canCancel: boolean;
  cancelling: boolean;
  onCancelClick: () => void;
}

const STATUS_PILL: Record<OrderStatus, { label: string; className: string }> = {
  PENDING: { label: "待上传", className: "bg-stone-100 text-stone-600" },
  GENERATING: { label: "生成中", className: "bg-amber-50 text-amber-600" },
  CANDIDATES_READY: {
    label: "待选择",
    className: "bg-indigo-50 text-indigo-600",
  },
  SELECTED: { label: "待确认", className: "bg-amber-50 text-amber-700" },
  CANCELLED: { label: "已取消", className: "bg-stone-100 text-stone-400" },
  FAILED: { label: "生成失败", className: "bg-red-50 text-red-600" },
};

function PreviewTopBar({
  templateName,
  orderNo,
  status,
  canCancel,
  cancelling,
  onCancelClick,
}: PreviewTopBarProps) {
  const pill = STATUS_PILL[status];
  return (
    <header className="sticky top-0 z-30 bg-[#fafafa]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-12 max-w-md items-center gap-3 px-5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-stone-900">
            {templateName}
          </p>
          <p className="truncate text-[11px] text-stone-400 tabular-nums">
            {orderNo}
          </p>
        </div>
        <span
          className={[
            "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums",
            pill.className,
          ].join(" ")}
        >
          {pill.label}
        </span>
        {canCancel && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="更多操作"
                    disabled={cancelling}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:opacity-60"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">更多操作</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem
                variant="destructive"
                onSelect={(e) => {
                  e.preventDefault();
                  onCancelClick();
                }}
              >
                <Ban className="mr-2 h-4 w-4" />
                放弃预览
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

interface PreviewConfirmBlockProps {
  token: string;
  order: OrderView;
  previewOrderNo: string;
  templateName: string;
  candidateCount: number;
  outputMode: "grid" | "separate";
  updatedAt: string;
  onConfirm: () => Promise<void>;
}

/**
 * preview 流 SELECTED 阶段——客人已选 cell 显示此块：
 *   - 顶部 Status 卡片（指示「已选 cell 待确认」）
 *   - 中间预览图（用 ResultStep 复用图片渲染逻辑）
 *   - 底部固定 CTA「确认下单」
 */
function PreviewConfirmBlock({
  token,
  order,
  previewOrderNo,
  templateName,
  candidateCount,
  updatedAt,
  onConfirm,
}: PreviewConfirmBlockProps) {
  const [submitting, setSubmitting] = useState(false);
  const selections = order.selections ?? [];
  const selectedCand = selections.find((s) => s !== null) ?? 0;

  return (
    <div className="space-y-4">
      {/* 顶部 Status 卡片 */}
      <div className="rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50/60 to-orange-50/40 p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm">
            <Sparkles className="h-4 w-4 text-amber-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold tracking-tight text-stone-900">
              已选候选，待确认下单
            </h2>
            <p className="text-xs text-stone-600 mt-1 leading-relaxed">
              {templateName}
              {" · 候选 "}
              {selectedCand + 1}/{candidateCount}
            </p>
          </div>
        </div>
      </div>

      {/* 预览图 —— 复用 ResultStep 的单批视图（mobile-first） */}
      <div className="rounded-2xl border border-stone-100 bg-white p-3 shadow-sm">
        <ResultStep
          token={token}
          orderNo={order.orderNo}
          updatedAt={updatedAt}
          batchCount={1}
          candidateCount={candidateCount}
          selections={selections}
          imagesPerUpload={1}
          onDownload={async () => {
            // ResultStep 自带下载按钮；preview 流允许客人下载预览图查看细节
          }}
        />
      </div>

      {/* 错误提示占位（hook 给 ResultStep 内部 toast 用即可） */}

      {/* 浮底 CTA —— mobile-first 固定底部 */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-100 bg-[#fafafa]/95 backdrop-blur-sm">
        <div className="mx-auto max-w-md px-5 py-4">
          <Button
            type="button"
            onClick={async () => {
              setSubmitting(true);
              try {
                await onConfirm();
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={submitting}
            className="w-full h-12 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-sm font-semibold shadow-sm"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                确认中...
              </>
            ) : (
              <>
                <AlertTriangle className="h-4 w-4 mr-1.5" />
                确认下单（不可修改）
              </>
            )}
          </Button>
          <p className="mt-2 text-[10px] text-center text-stone-400 leading-relaxed">
            提交后订单立即进入生产排期，结果不可修改。
            <br />
            凭证号：{previewOrderNo}
          </p>
        </div>
      </div>
    </div>
  );
}
