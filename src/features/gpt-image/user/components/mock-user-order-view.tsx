"use client";

import { Ban, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import type { OrderView } from "@/features/gpt-image/lib/types";

import { CancelledPanel } from "./cancelled-panel";
import { FailureNotice } from "./failure-notice";
import { GenerateStep } from "./generate-step";
import { LoadingScreen } from "./loading-screen";
import { ResultStep } from "./result-step";
import { SelectStep } from "./select-step";
import { UploadStep } from "./upload-step";
import { useSelections } from "./use-selections";

interface MockUserOrderViewProps {
  order: OrderView;
}

/**
 * 预览专用 mock 视图 —— 跳过所有 hooks（useOrder / useOrderActions / useOrderHistory），
 * 直接渲染给定 mock 订单对应的 step 组件，action handler 仅弹 toast 不发请求。
 *
 * 与生产 UserOrderView 的视觉/交互一致，方便在 /order-preview 切换状态走查 UI。
 */
export function MockUserOrderView({ order }: MockUserOrderViewProps) {
  // 让初次挂载也有"加载"过渡，避免 toast 触发的瞬间 layout shift —— 一帧就够了
  const [booting, setBooting] = useState(true);
  if (booting) {
    queueMicrotask(() => setBooting(false));
    return <LoadingScreen />;
  }

  return <MockOrderContent order={order} />;
}

function MockOrderContent({ order }: { order: OrderView }) {
  const selection = useSelections(order);
  const [cancelOpen, setCancelOpen] = useState(false);

  const uploadedCount = order.uploadedImageCount ?? 0;
  const uploadCount = order.uploadCount ?? 1;
  const imagesPerUpload = order.imagesPerUpload ?? 3;
  const candidateCount = order.candidateCount ?? order.template.candidateCount;
  const readyGroups = order.candidateGroups ?? 0;

  const status = order.status;
  const isPending = status === "PENDING";
  const isGenerating = status === "GENERATING";
  const isReady = status === "CANDIDATES_READY";
  const isSelected = status === "SELECTED";
  const isCancelled = status === "CANCELLED";
  const isFailed = status === "FAILED";

  const allowReupload = !isSelected && !isCancelled && !isGenerating;

  // 同一时刻只出现一个 stage（partial select 语义，与生产 UserOrderView 对齐）：
  // - CANDIDATES_READY + 还有未锁定位         → SelectStep
  // - CANDIDATES_READY + 全锁定 + 还有余量    → UploadStep
  // - PENDING / FAILED                       → UploadStep
  // - SELECTED                               → ResultStep
  // - CANCELLED                              → CancelledPanel
  const showSelectStep =
    allowReupload && isReady && uploadedCount > 0 && selection.pendingCount > 0;
  const showUploadStep =
    allowReupload &&
    (isPending ||
      isFailed ||
      (isReady && selection.pendingCount === 0 && uploadedCount < uploadCount));
  const canCancel = !isCancelled && !isPending;
  const mainHasFixedCta = showSelectStep || isSelected;

  // ── mock action handlers（仅 toast，不发请求） ──
  const noopAction = (name: string) => () => {
    toast.info(`[mock] ${name}`, { description: "预览页不会真的发起请求" });
    return Promise.resolve(true);
  };
  const handleSubmit = () => {
    const payload = selection.toPayload();
    if (!payload) return;
    toast.info("[mock] submit", {
      description: `将提交 ${payload.length} 张增量锁定（partial select）`,
    });
  };
  const handleUpload = async (_files: File[]) => {
    toast.info("[mock] upload", { description: "预览页不会真的上传" });
    return true;
  };
  const handleRegenerate = async (idx: number) => {
    toast.info(`[mock] regenerate ${idx}`, {
      description: "预览页不会真的触发生成",
    });
    return true;
  };
  const handleCancel = () => {
    toast.info("[mock] cancel", { description: "预览页不会真的取消" });
    setCancelOpen(false);
  };
  const handleRetryAll = () => {
    toast.info("[mock] retryAll", { description: "预览页不会真的重试" });
  };
  const handleDownload = async (
    _orderNo: string,
    _imageIdx: number,
    _candIdx: number
  ) => {
    toast.info("[mock] download", { description: "预览页没有真实图片可下载" });
  };

  // 历史快照在 mock 下永远为空
  const mockHistory: never[] = [];

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa]">
      {/* TopBar（mock 版：复用同套视觉，但 status pill 颜色和按钮都打了 mock 标记） */}
      <header className="sticky top-0 z-30 border-b border-stone-100 bg-white/70 backdrop-blur-2xl">
        <div className="mx-auto flex h-14 max-w-md items-center gap-3 px-5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500 text-white shadow-sm">
              <Sparkles className="h-4 w-4" strokeWidth={2.25} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold tracking-tight text-stone-900">
                {order.template.name}
              </p>
              <p className="truncate text-xs text-stone-400">
                {order.orderNo}
                {order.recipientName && <span> · {order.recipientName}</span>}
                <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-700">
                  mock
                </span>
              </p>
            </div>
          </div>
          <span className="shrink-0 rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium tabular-nums text-stone-600">
            {status}
          </span>
          {canCancel && (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              aria-label="取消订单"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>

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
                onRetryAll={handleRetryAll}
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
                uploading={false}
                onUpload={handleUpload}
              />
            )}

            {isGenerating && (
              <GenerateStep
                token={order.token}
                updatedAt={order.updatedAt}
                uploadedImageCount={uploadedCount}
                readyGroups={readyGroups}
                // mock 没有 useOrder，安静期视为已结束（直接显示真实节奏）
                quietEndsAt={null}
                stopping={false}
                onStopClick={noopAction("stop-generation")}
              />
            )}

            {showSelectStep && (
              <SelectStep
                token={order.token}
                updatedAt={order.updatedAt}
                imageCount={uploadedCount}
                candidateCount={candidateCount}
                // 2026-09-01：mock 视图默认 grid（演示拼接图模式）
                outputMode={order.template.outputMode ?? "grid"}
                selections={selection.selections}
                selectedCount={selection.selectedCount}
                lockedCount={selection.lockedCount}
                isLocked={selection.isLocked}
                submitting={false}
                regenerating={false}
                onToggle={selection.toggle}
                onSubmit={handleSubmit}
                onRegenerate={handleRegenerate}
                regenerateLimit={order.regenerateLimit ?? 5}
                regenerateUsedCount={order.regenerateUsedCount ?? 0}
                // mock 不接 useOrderHistory（不打 /history 接口），传空 stub
                snapshots={mockHistory}
              />
            )}

            {isSelected && (
              <ResultStep
                token={order.token}
                orderNo={order.orderNo}
                updatedAt={order.updatedAt}
                imageCount={uploadedCount}
                candidateCount={candidateCount}
                selections={selection.selections}
                onDownload={handleDownload}
              />
            )}
          </div>
        )}

        {/* mock 页底部放个 status pill block 提示，避免 OrderTimeline 让 preview 太长 */}
        <div className="mt-6 rounded-2xl border border-amber-100 bg-amber-50/40 p-4 text-xs text-amber-800">
          <p className="font-medium">⚠️ Mock 预览模式</p>
          <p className="mt-1 leading-relaxed text-amber-700/80">
            所有 action handler 仅弹 toast 不会真的发起请求。
            历史快照按钮故意隐藏（mock 无数据）。底部"切换状态"按钮可切换 8 种
            mock 订单。
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-amber-100/40 p-2 text-[10px] text-amber-900/70">
            {`history.length=${mockHistory.length} status=${status}`}
          </pre>
        </div>
      </main>

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
            <AlertDialogCancel>再想想</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={(e) => {
                e.preventDefault();
                handleCancel();
              }}
            >
              <span className="inline-flex items-center gap-1.5">
                <Ban className="h-4 w-4" /> 确认取消（mock）
              </span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// 历史快照在 mock 下故意隐藏：useOrderHistory 会去打 API，preview 场景下不需要
// （按钮触发后 history=[] 自动不渲染，详见 history-drawer.tsx）。
