"use client";

import { Ban, Loader2, X } from "lucide-react";
import { useCallback, useState } from "react";
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
import type {
  OrderHistorySnapshotView,
  OrderStatus,
  OrderView,
} from "@/features/gpt-image/lib/types";

import { CancelledPanel } from "./cancelled-panel";
import { FailureNotice } from "./failure-notice";
import { GenerateStep } from "./generate-step";
import { HistoryDrawer } from "./history-drawer";
import { InvalidLinkScreen } from "./invalid-link-screen";
import { LoadingScreen } from "./loading-screen";
import { OrderTimeline } from "./order-timeline";
import { ResultStep } from "./result-step";
import { SelectStep } from "./select-step";
import { UploadStep } from "./upload-step";
import { useOrder } from "./use-order";
import type { UseOrderActionsResult } from "./use-order-actions";
import { useOrderActions } from "./use-order-actions";
import { useOrderHistory } from "./use-order-history";
import type { UseSelectionsResult } from "./use-selections";
import { useSelections } from "./use-selections";
import { Link } from "@/i18n/routing";

interface UserOrderViewProps {
  token: string;
}

export function UserOrderView({ token }: UserOrderViewProps) {
  const { order, loading, notFound, refresh } = useOrder(token);
  const actions = useOrderActions({ token, refresh });
  const selection = useSelections(order);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (loading) return <LoadingScreen />;
  if (notFound || !order) return <InvalidLinkScreen />;

  return (
    <UserOrderContent
      token={token}
      order={order}
      actions={actions}
      selection={selection}
      cancelOpen={cancelOpen}
      setCancelOpen={setCancelOpen}
      refreshOrder={refresh}
    />
  );
}

/**
 * 主渲染 —— 拆出 UserOrderContent 是为了让 hooks 在条件渲染前完成，
 * React 不允许 hooks 在 early return 之后调用。
 */
interface UserOrderContentProps {
  token: string;
  order: OrderView;
  actions: UseOrderActionsResult;
  selection: UseSelectionsResult;
  cancelOpen: boolean;
  setCancelOpen: (v: boolean) => void;
  refreshOrder: () => Promise<void>;
}

function UserOrderContent({
  token,
  order,
  actions,
  selection,
  cancelOpen,
  setCancelOpen,
  refreshOrder,
}: UserOrderContentProps) {
  const status = order.status;
  const history = useOrderHistory({
    token,
    enabled: status !== "PENDING",
  });

  /**
   * 合并刷新：regenerate / upload / restore 等 mutation 完成后，
   * 既要刷新订单状态，也要刷新历史列表。
   * useOrderActions 的 callback 不再使用各自的 refresh —— 全部走 refreshAll。
   */
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshOrder(), history.refreshHistory()]);
  }, [refreshOrder, history]);

  /**
   * restore 后立刻：
   * 1. 把服务端权威 selections 推给 use-selections（替换本地草稿）
   * 2. 刷新订单 + 历史
   */
  const handleHistoryRestore = useCallback(
    async (id: string) => {
      const data = await history.restore(id);
      if (data) {
        selection.replaceFromServer(data.selections, data.uploadedImageCount);
        await refreshAll();
      }
    },
    [history, selection, refreshAll]
  );

  const uploadedCount = order.uploadedImageCount ?? 0;
  const uploadCount = order.uploadCount ?? 1;
  const candidateCount = order.candidateCount ?? order.template.candidateCount;
  const readyGroups = order.candidateGroups ?? 0;

  const isPending = status === "PENDING";
  const isGenerating = status === "GENERATING";
  const isReady = status === "CANDIDATES_READY";
  const isSelected = status === "SELECTED";
  const isCancelled = status === "CANCELLED";
  const isFailed = status === "FAILED";

  // 重新上传的允许范围：**只有 SELECTED / CANCELLED / GENERATING 之前的状态允许重新上传**。
  // 也就是说，用户一旦"选择提交效果图"（status = SELECTED）就进入终态，
  // 不能再补传新图——只能取消订单后联系服务方重开（CANCELLED 也是终态）。
  // 表达成布尔 `allowReupload`，下面所有 stage 判断都从它派生，避免漏检。
  const allowReupload = !isSelected && !isCancelled && !isGenerating;

  // 同一时刻只出现一个 stage：
  // - PENDING / FAILED                       → UploadStep（首次上传 / 失败重传）
  // - CANDIDATES_READY + 未选完              → SelectStep（继续选）
  // - CANDIDATES_READY + 全部选完 + 还有余量  → UploadStep（传下一张）
  // - CANDIDATES_READY + 全部选完 + 已满      → SelectStep（确认提交）
  // - SELECTED                               → ResultStep（终态，不再允许上传）
  // - CANCELLED                              → CancelledPanel（终态）
  const showSelectStep =
    allowReupload &&
    isReady &&
    uploadedCount > 0 &&
    (!selection.allSelected || uploadedCount >= uploadCount);
  const showUploadStep =
    allowReupload &&
    (isPending ||
      isFailed ||
      (isReady && selection.allSelected && uploadedCount < uploadCount));
  const canCancel = !isCancelled && !isPending;

  const handleSubmit = () => {
    const payload = selection.toPayload();
    if (!payload) return;
    void actions.submit(payload);
  };

  // SelectStep 和 ResultStep 自己有 fixed bottom CTA，需要更大的底部 padding 避免遮挡
  const mainHasFixedCta = showSelectStep || isSelected;

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa]">
      {/* ── TopBar（mobile-first 单列） ── */}
      <TopBar
        templateName={order.template.name}
        orderNo={order.orderNo}
        recipientName={order.recipientName}
        status={status}
        canCancel={canCancel}
        cancelling={actions.cancelling}
        onCancelClick={() => setCancelOpen(true)}
        history={history.history}
        historyLoading={history.loading}
        historyRestoringId={history.restoringId}
        onHistoryRestore={(id) => void handleHistoryRestore(id)}
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
                onRetryAll={() => void actions.retryAll().then(refreshAll)}
                retrying={actions.retryingAll}
              />
            )}

            {showUploadStep && (
              <UploadStep
                templateName={order.template.name}
                uploadCount={uploadCount}
                uploadedImageCount={uploadedCount}
                candidateCount={candidateCount}
                hasFailure={isFailed}
                uploading={actions.uploading}
                onUpload={async (files) => {
                  const ok = await actions.upload(files);
                  if (ok) await history.refreshHistory();
                  return ok;
                }}
              />
            )}

            {isGenerating && (
              <GenerateStep
                token={token}
                updatedAt={order.updatedAt}
                uploadedImageCount={uploadedCount}
                readyGroups={readyGroups}
                candidateCount={candidateCount}
                uploadedAt={order.uploadedAt}
                // 注意：生成阶段的"停止生成"是协作式打断当前 in-flight 的
                // 生成任务，**不**等于取消订单。订单级取消仍走 TopBar 的
                // AlertDialog，由 actions.cancel() 触发（终态 CANCELLED）。
                stopping={actions.stopping}
                onStopClick={() => void actions.stopGeneration()}
              />
            )}

            {showSelectStep && (
              <SelectStep
                token={token}
                updatedAt={order.updatedAt}
                imageCount={uploadedCount}
                candidateCount={candidateCount}
                selections={selection.selections}
                selectedCount={selection.selectedCount}
                allSelected={selection.allSelected}
                firstUnselectedIdx={selection.firstUnselectedIdx}
                submitting={actions.submitting}
                regenerating={actions.regenerating}
                onToggle={selection.toggle}
                onSubmit={handleSubmit}
                onRegenerate={async (idx) => {
                  const ok = await actions.regenerate(idx);
                  if (ok) await history.refreshHistory();
                  return ok;
                }}
              />
            )}

            {isSelected && (
              <ResultStep
                token={token}
                orderNo={order.orderNo}
                updatedAt={order.updatedAt}
                imageCount={uploadedCount}
                candidateCount={candidateCount}
                selections={selection.selections}
                onDownload={actions.download}
              />
            )}
          </div>
        )}

        {/* 订单活动时间线——PENDING / CANCELLED 时隐藏（无事件可看或太简短），其余展示 */}
        {/* TODO: 暂时整体隐藏底部订单动态时间线，后续设计调整后再恢复 */}
        {/* {!isPending && !isCancelled && (
          <div className="mt-6">
            <OrderTimeline
              createdAt={order.createdAt}
              uploadedAt={order.uploadedAt}
              uploadedImageCount={uploadedCount}
              uploadCount={uploadCount}
              generatedAt={order.generatedAt}
              candidateGroups={readyGroups}
              candidateCount={candidateCount}
              selectedAt={order.selectedAt}
              selectedCount={selection.selectedCount}
              cancelledAt={order.cancelledAt}
              failed={isFailed}
              status={status}
              errorMessage={order.errorMessage}
            />
          </div>
        )} */}
      </main>

      {/* ── 取消订单 AlertDialog ── */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认取消这个订单？</AlertDialogTitle>
            <AlertDialogDescription>
              {isSelected
                ? "已提交的结果将作废。取消后无法恢复，如需重新生图请联系服务方创建新订单 🐾"
                : "取消后将终止当前流程，此操作不可撤销 ✨"}
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
                  <Ban className="h-4 w-4" /> 确认取消
                </span>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── 底部品牌脚注 ── 极简文字样式，不抢主内容 */}
      <p className="mt-12 pb-2 text-center">
        <Link
          href="/"
          aria-label="Mooncoda 首页"
          className="inline-flex items-center gap-1.5 text-xs text-stone-400 transition-colors hover:text-stone-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 rounded"
        >
          <img
            src="/logo.svg"
            alt="Mooncoda"
            className="h-3.5 w-3.5 shrink-0"
          />
          <span className="tracking-tight">Mooncoda梦可达</span>
        </Link>
      </p>
    </div>
  );
}

/* ====================================================================== */
/* TopBar — 内联组件，避免单独文件                            */
/* ====================================================================== */

interface TopBarProps {
  templateName: string;
  orderNo: string;
  recipientName: string;
  status: OrderStatus;
  canCancel: boolean;
  cancelling: boolean;
  onCancelClick: () => void;
  history: OrderHistorySnapshotView[];
  historyLoading: boolean;
  historyRestoringId: string | null;
  onHistoryRestore: (id: string) => void;
}

const STATUS_PILL: Record<OrderStatus, { label: string; className: string }> = {
  PENDING: { label: "待上传", className: "bg-stone-100 text-stone-600" },
  GENERATING: {
    label: "生成中",
    className: "bg-amber-50 text-amber-600",
  },
  CANDIDATES_READY: {
    label: "待选择",
    className: "bg-indigo-50 text-indigo-600",
  },
  SELECTED: {
    label: "已提交",
    className: "bg-emerald-50 text-emerald-600",
  },
  CANCELLED: { label: "已取消", className: "bg-stone-100 text-stone-400" },
  FAILED: { label: "生成失败", className: "bg-red-50 text-red-600" },
};

function TopBar({
  templateName,
  orderNo,
  recipientName,
  status,
  canCancel,
  cancelling,
  onCancelClick,
  history,
  historyLoading,
  historyRestoringId,
  onHistoryRestore,
}: TopBarProps) {
  const pill = STATUS_PILL[status];
  return (
    <header className="sticky top-0 z-30 bg-[#fafafa]">
      <div className="mx-auto flex h-14 max-w-md items-center gap-3 px-5">
        {/* 左：模板名 + 订单号 + 收件人 */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight text-stone-900">
            {templateName}
          </p>
          <p className="truncate text-xs text-stone-400">
            {orderNo}
            {recipientName && <span> · {recipientName}</span>}
          </p>
        </div>

        {/* 中：状态徽章 */}
        <span
          className={[
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium tabular-nums",
            pill.className,
          ].join(" ")}
        >
          {pill.label}
        </span>

        {/* 右：历史按钮 + 取消按钮 */}
        <div className="flex shrink-0 items-center gap-1.5">
          <HistoryDrawer
            history={history}
            loading={historyLoading}
            status={status}
            restoringId={historyRestoringId}
            onRestore={onHistoryRestore}
          />
          {canCancel && (
            <button
              type="button"
              onClick={onCancelClick}
              disabled={cancelling}
              aria-label="取消订单"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:opacity-60"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
