"use client";

import {
  CheckCircle2,
  Clock,
  History,
  Loader2,
  Sparkles,
  Wand2,
  XCircle,
} from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ImageJob, ImageJobStatus } from "@/db/schema";
import { pollImageJobAction } from "@/features/image-gen/actions";
import { SafeImage } from "@/features/image-gen/components/safe-image";
import {
  IMAGE_MODEL_LIST,
  IMAGE_MODELS,
} from "@/features/image-gen/lib/image-models/types";
import { cn } from "@/lib/utils";

interface EffectsHistoryViewProps {
  initialJobs: ImageJob[];
}

const STATUS_CONFIG: Record<
  ImageJobStatus,
  { label: string; icon: typeof Clock; color: string; bg: string }
> = {
  pending: {
    label: "排队中",
    icon: Clock,
    color: "text-amber-600",
    bg: "bg-amber-500/10 border-amber-500/20",
  },
  processing: {
    label: "生成中",
    icon: Loader2,
    color: "text-sky-600",
    bg: "bg-sky-500/10 border-sky-500/20",
  },
  completed: {
    label: "已完成",
    icon: CheckCircle2,
    color: "text-emerald-600",
    bg: "bg-emerald-500/10 border-emerald-500/20",
  },
  failed: {
    label: "失败",
    icon: XCircle,
    color: "text-rose-600",
    bg: "bg-rose-500/10 border-rose-500/20",
  },
};

function formatDate(date: Date | string | null): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("zh-CN");
}

export function EffectsHistoryView({ initialJobs }: EffectsHistoryViewProps) {
  const [jobs, setJobs] = useState<ImageJob[]>(initialJobs);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [previewJob, setPreviewJob] = useState<ImageJob | null>(null);
  const [pollingId, setPollingId] = useState<string | null>(null);

  const { execute: pollJob } = useAction(pollImageJobAction, {
    onSuccess: ({ data }) => {
      if (data?.job) {
        setJobs((prev) =>
          prev.map((j) => (j.id === data.job.id ? data.job : j))
        );
        if (previewJob?.id === data.job.id) {
          setPreviewJob(data.job);
        }
        toast.success("状态已刷新");
      }
      setPollingId(null);
    },
    onError: ({ error }) => {
      toast.error(error.serverError ?? "轮询失败");
      setPollingId(null);
    },
  });

  const filtered =
    filterStatus === "all"
      ? jobs
      : jobs.filter((j) => j.status === filterStatus);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">状态筛选：</span>
        {["all", "pending", "processing", "completed", "failed"].map((s) => (
          <button
            type="button"
            key={s}
            onClick={() => setFilterStatus(s)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              filterStatus === s
                ? "bg-foreground text-background border-foreground"
                : "hover:bg-muted"
            )}
          >
            {s === "all" ? "全部" : STATUS_CONFIG[s as ImageJobStatus].label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          共 {filtered.length} 条记录
        </span>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground">
              <History className="h-10 w-10 mb-3" />
              <p className="font-medium">暂无效果图</p>
              <p className="text-sm">前往生图工作台开始你的第一次创作</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((job) => {
            const config = STATUS_CONFIG[job.status];
            const StatusIcon = config.icon;
            const model = IMAGE_MODEL_LIST.find((m) => m.id === job.model);
            return (
              <Card
                key={job.id}
                className="overflow-hidden hover:shadow-md transition-all"
              >
                <button
                  type="button"
                  className="aspect-video bg-muted relative cursor-pointer w-full text-left"
                  onClick={() => setPreviewJob(job)}
                  aria-label="查看任务详情"
                >
                  {job.status === "completed" && job.resultUrls.length > 0 ? (
                    <div className="grid grid-cols-3 h-full">
                      {job.resultUrls.slice(0, 3).map((url) => (
                        <SafeImage
                          key={url}
                          src={url}
                          alt="生成结果"
                          className="w-full h-full object-cover"
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-2">
                      <StatusIcon
                        className={cn(
                          "h-8 w-8",
                          config.color,
                          job.status === "processing" && "animate-spin"
                        )}
                      />
                      <p className="text-xs text-muted-foreground">
                        {config.label}
                      </p>
                    </div>
                  )}
                  <Badge
                    className={cn(
                      "absolute top-2 right-2 text-[10px]",
                      config.bg,
                      config.color,
                      "border"
                    )}
                  >
                    <StatusIcon
                      className={cn(
                        "h-3 w-3 mr-1",
                        job.status === "processing" && "animate-spin"
                      )}
                    />
                    {config.label}
                  </Badge>
                </button>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium truncate">
                      {job.maskId ?? "自定义"}
                    </p>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {job.id.slice(0, 12)}...
                    </span>
                  </div>
                  {model && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-white"
                        style={{
                          backgroundColor:
                            IMAGE_MODELS[model.id]?.color ?? "#64748b",
                        }}
                      >
                        <Wand2 className="h-2.5 w-2.5" />
                        {model.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {job.mode === "text_to_image" ? "文生图" : "图生图"}
                      </span>
                    </div>
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    消耗 {job.creditsConsumed} 积分 ·{" "}
                    {formatDate(job.createdAt)}
                  </p>
                  {job.status === "failed" && job.errorMsg && (
                    <p className="text-[10px] text-rose-600 bg-rose-500/5 rounded p-1.5">
                      {job.errorMsg}
                    </p>
                  )}
                  {job.status === "processing" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={pollingId === job.id}
                      onClick={() => {
                        setPollingId(job.id);
                        pollJob({ jobId: job.id });
                      }}
                    >
                      {pollingId === job.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      刷新状态
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={!!previewJob}
        onOpenChange={(open) => !open && setPreviewJob(null)}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              {previewJob?.maskId ?? "自定义生图"}
            </DialogTitle>
            <DialogDescription>
              {previewJob?.id} · 创建于{" "}
              {previewJob && formatDate(previewJob.createdAt)}
            </DialogDescription>
          </DialogHeader>
          {previewJob && (
            <div className="space-y-3">
              {previewJob.resultUrls.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {previewJob.resultUrls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="aspect-square rounded-lg overflow-hidden border bg-muted"
                    >
                      <SafeImage
                        src={url}
                        alt="生成结果"
                        className="w-full h-full object-cover hover:scale-105 transition-transform"
                      />
                    </a>
                  ))}
                </div>
              )}
              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground mb-1">Prompt</p>
                <p className="text-xs font-mono whitespace-pre-wrap">
                  {previewJob.prompt}
                </p>
              </div>
              {previewJob.revisedPrompt && (
                <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">模型重写</p>
                  <p className="text-xs italic text-violet-700 dark:text-violet-400">
                    {previewJob.revisedPrompt}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-4 gap-2 pt-1 border-t text-[10px]">
                <div>
                  <span className="text-muted-foreground">模型: </span>
                  {previewJob.model}
                </div>
                <div>
                  <span className="text-muted-foreground">模式: </span>
                  {previewJob.mode === "text_to_image" ? "文生图" : "图生图"}
                </div>
                <div>
                  <span className="text-muted-foreground">积分: </span>
                  {previewJob.creditsConsumed}
                </div>
                <div>
                  <span className="text-muted-foreground">尺寸: </span>
                  {previewJob.size}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
