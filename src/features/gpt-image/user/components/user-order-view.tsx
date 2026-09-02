"use client";

import { Ban, Loader2, X } from "lucide-react";
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
import type { OrderStatus, OrderView } from "@/features/gpt-image/lib/types";
import { Link } from "@/i18n/routing";
import { CancelledPanel } from "./cancelled-panel";
import { FailureNotice } from "./failure-notice";
import { GenerateStep } from "./generate-step";
import { InvalidLinkScreen } from "./invalid-link-screen";
import { LoadingScreen } from "./loading-screen";
import { ResultStep } from "./result-step";
import { SelectStep } from "./select-step";
import { UploadStep } from "./upload-step";
import { useOrder } from "./use-order";
import type { UseOrderActionsResult } from "./use-order-actions";
import { useOrderActions } from "./use-order-actions";
import { useOrderHistory } from "./use-order-history";
import type { UseSelectionsResult } from "./use-selections";
import { useSelections } from "./use-selections";

interface UserOrderViewProps {
  token: string;
}

export function UserOrderView({ token }: UserOrderViewProps) {
  const { order, loading, notFound, refresh, quietEndsAt } = useOrder(token);
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
      quietEndsAt={quietEndsAt}
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
  /** GENERATING 起始「安静期」结束时刻（ms epoch），传给 GenerateStep 对齐假进度 */
  quietEndsAt: number | null;
}

function UserOrderContent({
  token,
  order,
  actions,
  selection,
  cancelOpen,
  setCancelOpen,
  refreshOrder,
  quietEndsAt,
}: UserOrderContentProps) {
  const status = order.status;

  // 效果图历史快照 —— 传给 SelectStep 用于大图两侧的左右切换箭头。
  // 仅 CANDIDATES_READY / FAILED 状态有意义；其它阶段服务端返回空数组。
  // 等价地：useOrderHistory 内部 enabled 也按此判断。
  const historyEnabled = status === "CANDIDATES_READY" || status === "FAILED";
  const history = useOrderHistory({ token, enabled: historyEnabled });

  const uploadedCount = order.uploadedImageCount ?? 0;
  const uploadCount = order.uploadCount ?? 1;
  const imagesPerUpload = order.imagesPerUpload ?? 3;
  const candidateCount = order.candidateCount ?? order.template.candidateCount;
  const readyGroups = order.candidateGroups ?? 0;

  const isPending = status === "PENDING";
  const isGenerating = status === "GENERATING";
  const isReady = status === "CANDIDATES_READY";
  const isSelected = status === "SELECTED";
  const isCancelled = status === "CANCELLED";
  const isFailed = status === "FAILED";

  // 「正在重新生成」的合并视图：`actions.regenerating` 在用户点确认到
  // /regenerate 返回 + refresh 写回 status=GENERATING 之间有 1-2s 窗口
  // 为真。这期间如果只用 `isGenerating` 判断，会出现 SelectStep 仍在渲染
  // （含"确认提交"按钮 + 旧候选图）+ GenerateStep 没切进去的卡顿窗口。
  // 把 `actions.regenerating` 合并进来，regen 一开始就把 SelectStep 下线、
  // 直接显示 GenerateStep 的进度条，"确认提交"按钮与旧候选 UI 一起被替换。
  const effectiveGenerating = isGenerating || actions.regenerating;

  // 重新上传的允许范围：**只有 SELECTED / CANCELLED / GENERATING 之前的状态允许重新上传**。
  // 也就是说，用户一旦"选择提交效果图"（status = SELECTED）就进入终态，
  // 不能再补传新图——只能取消订单后联系服务方重开（CANCELLED 也是终态）。
  // 表达成布尔 `allowReupload`，下面所有 stage 判断都从它派生，避免漏检。
  const allowReupload = !isSelected && !isCancelled && !effectiveGenerating;

  // 同一时刻只出现一个 stage（partial select 语义）：
  // - PENDING / FAILED                       → UploadStep（首次上传 / 失败重传）
  // - CANDIDATES_READY + 还有未锁定位         → SelectStep（继续选）
  // - CANDIDATES_READY + 全锁定 + 还有余量    → UploadStep（传下一张）
  // - CANDIDATES_READY + 全锁定 + 已满        → 不会有（直接转 SELECTED）
  // - GENERATING / 正在重新生成              → GenerateStep（进度展示）
  // - SELECTED                               → ResultStep（终态，不再允许上传）
  // - CANCELLED                              → CancelledPanel（终态）
  //
  // pendingCount = uploadedCount - lockedCount：
  // - pendingCount > 0 时 SelectStep 接管（用户可以锁定当前 / 跳到下一张）
  // - pendingCount === 0 时如果还能上传更多 → UploadStep；否则已全锁定，
  //   服务端会在最近一次 partial submit 时已经转 SELECTED（仅 1 张订单时）
  //   或仍保持 CANDIDATES_READY 等待剩余原图上传（uploadCount > uploadedCount）
  const showSelectStep =
    allowReupload && isReady && uploadedCount > 0 && selection.pendingCount > 0;
  const showUploadStep =
    allowReupload &&
    (isPending ||
      isFailed ||
      (isReady && selection.pendingCount === 0 && uploadedCount < uploadCount));
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
                // 共享给 useOrder 的同一时间源，让假进度 RAF 起点 = /poll
                // 安静期起点；窗口内不打 /poll，只让假进度跑。
                quietEndsAt={quietEndsAt}
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
                // 2026-09-02：索引语义从 imageCount 改成 batchCount
                // （= ceil(uploadedCount / imagesPerUpload)）。
                batchCount={
                  imagesPerUpload > 1
                    ? Math.ceil(uploadedCount / imagesPerUpload)
                    : uploadedCount
                }
                imagesPerUpload={imagesPerUpload}
                uploadedImageCount={uploadedCount}
                candidateCount={candidateCount}
                // 2026-09-01：模板级候选输出模式分支
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
                regenerateLimit={order.regenerateLimit}
                regenerateUsedCount={order.regenerateUsedCount ?? 0}
                snapshots={history.history}
              />
            )}

            {isSelected && (
              <ResultStep
                token={token}
                orderNo={order.orderNo}
                updatedAt={order.updatedAt}
                // 2026-09-02：索引语义从 imageCount 改成 batchCount
                batchCount={
                  imagesPerUpload > 1
                    ? Math.ceil(uploadedCount / imagesPerUpload)
                    : uploadedCount
                }
                imagesPerUpload={imagesPerUpload}
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
              imagesPerUpload={imagesPerUpload}
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

        {/* ── 品牌脚注 ── 放在 main 内，确保 SelectStep/ResultStep 的 fixed CTA 不会盖住它 */}
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
          <span>提供定制服务</span>
        </div>
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

        {/* 右：取消按钮（效果图历史入口已从用户页面隐藏，admin 端需要时复用 history-drawer.tsx） */}
        <div className="flex shrink-0 items-center gap-1.5">
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
