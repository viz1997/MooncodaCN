"use client";

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
import { GeneratingStage } from "./generating-stage";
import { OrderHeader } from "./order-header";
import { ResultStage } from "./result-stage";
import { SelectStage } from "./select-stage";
import {
  CancelledPanel,
  FailureNotice,
  InvalidLinkScreen,
  LoadingScreen,
} from "./status-screens";
import { StepRail } from "./step-rail";
import { UploadStage } from "./upload-stage";
import { useOrder } from "./use-order";
import { useOrderActions } from "./use-order-actions";
import { useSelections } from "./use-selections";

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

  const status = order.status;
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

  // 同一时刻只出现一个 stage：
  // - PENDING / FAILED                       → UploadStage（首次上传）
  // - CANDIDATES_READY + 未选完              → SelectStage（继续选）
  // - CANDIDATES_READY + 全部选完 + 还有余量  → UploadStage（传下一张）
  // - CANDIDATES_READY + 全部选完 + 已满      → SelectStage（确认提交）
  const showSelectStage =
    isReady &&
    uploadedCount > 0 &&
    (!selection.allSelected || uploadedCount >= uploadCount);
  const showUploadStage =
    isPending ||
    isFailed ||
    (isReady && selection.allSelected && uploadedCount < uploadCount);
  const canCancel = !isCancelled && !isPending;

  const handleSubmit = () => {
    const payload = selection.toPayload();
    if (!payload) return;
    void actions.submit(payload);
  };

  return (
    <div className="min-h-dvh bg-white">
      <OrderHeader
        templateName={order.template.name}
        orderNo={order.orderNo}
        recipientName={order.recipientName}
        canCancel={canCancel}
        cancelling={actions.cancelling}
        onCancelClick={() => setCancelOpen(true)}
      />

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6">
        {isCancelled ? (
          <CancelledPanel cancelledAt={order.cancelledAt} />
        ) : (
          <>
            <StepRail status={status} />

            {isFailed && (
              <FailureNotice
                message={order.errorMessage}
                canRetry={showUploadStage}
                onRetryAll={() => void actions.retryAll()}
                retrying={actions.retryingAll}
              />
            )}

            {showUploadStage && (
              <UploadStage
                uploadCount={uploadCount}
                uploadedImageCount={uploadedCount}
                candidateCount={candidateCount}
                isAppending={isReady && uploadedCount > 0}
                uploading={actions.uploading}
                onUpload={actions.upload}
              />
            )}

            {isGenerating && (
              <GeneratingStage
                token={token}
                updatedAt={order.updatedAt}
                uploadedImageCount={uploadedCount}
                readyGroups={readyGroups}
                candidateCount={candidateCount}
                uploadedAt={order.uploadedAt}
              />
            )}

            {showSelectStage && (
              <SelectStage
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
                onRegenerate={actions.regenerate}
              />
            )}

            {isSelected && (
              <ResultStage
                token={token}
                orderNo={order.orderNo}
                updatedAt={order.updatedAt}
                imageCount={uploadedCount}
                candidateCount={candidateCount}
                selections={selection.selections}
                onDownload={actions.download}
              />
            )}
          </>
        )}
      </main>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认取消这个订单？</AlertDialogTitle>
            <AlertDialogDescription>
              {isSelected
                ? "已提交的结果将作废。取消后无法恢复，如需重新生图请联系服务方创建新订单。"
                : "取消后将终止当前流程，此操作不可撤销。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actions.cancelling}>
              再想想
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={actions.cancelling}
              onClick={(e) => {
                e.preventDefault();
                void actions.cancel().then((ok) => ok && setCancelOpen(false));
              }}
            >
              确认取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
