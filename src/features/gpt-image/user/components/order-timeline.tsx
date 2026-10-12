"use client";

import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Package,
  Sparkles,
  Upload,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { sanitizeErrorMessage } from "@/features/gpt-image/lib/sanitize-error-message";
import { cn } from "@/lib/utils";

interface TimelineEvent {
  /** 事件唯一 id（避免 key 冲突） */
  id: string;
  /** 事件主图标 */
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** 事件简短标题 */
  title: string;
  /** 事件发生的时间（ISO 字符串） */
  at: string;
  /** 主色 token，决定左侧色点 + 图标颜色 */
  tone: "primary" | "blue" | "amber" | "emerald" | "destructive" | "muted";
  /** 详细描述（可选） */
  detail?: string;
}

interface OrderTimelineProps {
  createdAt: string;
  uploadedAt: string | null;
  uploadedImageCount: number;
  uploadCount: number;
  /** 每批上传的原图参考图数量（1-3）；总容量 = uploadCount × imagesPerUpload */
  imagesPerUpload: number;
  generatedAt: string | null;
  candidateGroups: number;
  candidateCount: number;
  selectedAt: string | null;
  selectedCount: number;
  cancelledAt: string | null;
  failed: boolean;
  status: string;
  /** 服务端 errorMessage —— 失败事件的 detail 用；展示前必须 sanitize */
  errorMessage?: string | null;
}

/** 把事件 tone 映射到 tailwind 配色 */
const TONE_STYLES: Record<
  TimelineEvent["tone"],
  { dot: string; icon: string; bg: string }
> = {
  primary: {
    dot: "bg-primary",
    icon: "text-primary",
    bg: "bg-primary/10",
  },
  blue: { dot: "bg-blue-500", icon: "text-blue-600", bg: "bg-blue-500/10" },
  amber: {
    dot: "bg-amber-500",
    icon: "text-amber-600",
    bg: "bg-amber-500/10",
  },
  emerald: {
    dot: "bg-emerald-500",
    icon: "text-emerald-600",
    bg: "bg-emerald-500/10",
  },
  destructive: {
    dot: "bg-destructive",
    icon: "text-destructive",
    bg: "bg-destructive/10",
  },
  muted: {
    dot: "bg-muted-foreground/40",
    icon: "text-muted-foreground",
    bg: "bg-muted",
  },
};

/** 计算"X 分钟前 / X 小时前 / X 天前" */
function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

/** 完整时间戳（title 提示用） */
function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 订单活动时间线
 *
 * 数据源：完全从现有 order 字段（createdAt / uploadedAt / generatedAt /
 * selectedAt / cancelledAt）推导，**不**改 schema、不加事件表。
 *
 * 设计要点：
 * - 默认折叠（只显示最新 1-2 条），避免在订单页头一眼看到一堆时间
 * - 折叠态显示事件总数 badge，给用户"还有内容"的提示
 * - 移动端仍可点击展开；时间精度分两级（短相对 + title 绝对）
 */
export function OrderTimeline({
  createdAt,
  uploadedAt,
  uploadedImageCount,
  uploadCount,
  imagesPerUpload,
  generatedAt,
  candidateGroups,
  candidateCount,
  selectedAt,
  selectedCount,
  cancelledAt,
  failed,
  status,
  errorMessage,
}: OrderTimelineProps) {
  // 推导事件列表（按时间顺序）
  const events = useMemo<TimelineEvent[]>(() => {
    const list: TimelineEvent[] = [];

    list.push({
      id: "created",
      icon: Package,
      title: "订单已创建",
      at: createdAt,
      tone: "muted",
    });

    if (uploadedAt) {
      const totalCapacity = uploadCount * imagesPerUpload;
      const remain = Math.max(0, totalCapacity - uploadedImageCount);
      // 2026-09-02：批次语义 —— N 张上传图合一次生图，文案从"原图"改为"参考图"。
      list.push({
        id: "uploaded",
        icon: Upload,
        title:
          uploadedImageCount >= totalCapacity
            ? `已上传全部 ${totalCapacity} 张参考图（${uploadCount} 批 × ${imagesPerUpload} 张/批）`
            : `已上传 ${uploadedImageCount} 张参考图${remain > 0 ? `（还差 ${remain} 张）` : ""}`,
        at: uploadedAt,
        tone: "primary",
      });
    }

    if (generatedAt) {
      list.push({
        id: "generated",
        icon: Sparkles,
        // candidateGroups 现在 = 已合成候选组数 = 已上传批次数（每批 N 张合一次生图）
        title: `已生成 ${candidateGroups} 批候选效果图（每批 ${imagesPerUpload} 张参考图合一次生成，每组 ${candidateCount} 张）`,
        at: generatedAt,
        tone: "blue",
      });
    }

    // 失败优先于 selected 显示。
    // detail 必须 sanitizeErrorMessage：上游 Lingting 失败时 errorMessage
    // 含 HTML / HTTP / Lingting 等技术噪音，对 ToC 用户毫无价值且吓人。
    if (failed) {
      const safeReason = sanitizeErrorMessage(errorMessage);
      list.push({
        id: "failed",
        icon: XCircle,
        title: "上次生成失败",
        at: fallbackAtForFailed(status, generatedAt, uploadedAt, createdAt),
        tone: "destructive",
        detail: safeReason ?? "可在下方重新上传图片再试一次",
      });
    }

    if (selectedAt) {
      list.push({
        id: "selected",
        icon: CheckCircle2,
        // selectedCount 现在 = 已锁定候选组数 = 批次数，不是张数
        title: `已为 ${selectedCount} 批候选选定效果并提交`,
        at: selectedAt,
        tone: "emerald",
      });
    }

    if (cancelledAt) {
      list.push({
        id: "cancelled",
        icon: XCircle,
        title: "订单已取消",
        at: cancelledAt,
        tone: "muted",
      });
    }

    // 最后追加"当前状态"作为未发生事项的占位（用 updatedAt）
    if (!cancelledAt && status === "GENERATING") {
      list.push({
        id: "current",
        icon: Loader2,
        title: "正在生成候选效果图…",
        at: uploadedAt ?? createdAt,
        tone: "amber",
        detail: "预计 5-60 秒内完成",
      });
    }

    return list;
  }, [
    createdAt,
    uploadedAt,
    uploadedImageCount,
    uploadCount,
    generatedAt,
    candidateGroups,
    candidateCount,
    selectedAt,
    selectedCount,
    cancelledAt,
    failed,
    status,
    errorMessage,
  ]);

  // 默认折叠——只显示最新一条
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? events : events.slice(-1);

  if (events.length === 0) return null;

  return (
    <section
      aria-label="订单动态"
      className="border-border bg-card text-card-foreground rounded-xl border"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="hover:bg-accent/40 flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5"
      >
        <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Clock className="text-muted-foreground h-4 w-4" strokeWidth={2.25} />
          订单动态
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
            {events.length}
          </span>
        </span>
        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs font-medium">
          {expanded ? "收起" : "展开"}
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {visible.length > 0 && (
        <ol
          className={cn(
            "border-border space-y-0 border-t px-4 py-3 sm:px-5",
            expanded ? "pb-4" : "pb-3"
          )}
        >
          {visible.map((ev, idx) => {
            const tone = TONE_STYLES[ev.tone];
            const Icon = ev.icon;
            const isLast = idx === visible.length - 1;
            return (
              <li
                key={ev.id}
                className="relative flex gap-3 pb-3 last:pb-0"
                title={`发生于 ${absoluteTime(ev.at)}`}
              >
                {/* 时间线竖线（除最后一条外显示） */}
                {!isLast && (
                  <span
                    aria-hidden
                    className="bg-border absolute top-7 left-[11px] h-[calc(100%-1.25rem)] w-px"
                  />
                )}
                {/* 左侧色点 + 图标 */}
                <span
                  className={cn(
                    "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                    tone.bg
                  )}
                >
                  <Icon
                    className={cn("h-3.5 w-3.5", tone.icon)}
                    strokeWidth={2.25}
                  />
                </span>
                {/* 右侧文字 */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <p className="text-foreground text-sm font-medium leading-snug">
                      {ev.title}
                    </p>
                    <span className="text-muted-foreground text-xs font-medium tabular-nums">
                      {relativeTime(ev.at)}
                    </span>
                  </div>
                  {ev.detail && (
                    <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                      {ev.detail}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** 失败事件的回退时间戳
 *
 * schema 没有独立的 failedAt 字段；用"最近一次活动时间"代替——
 * uploadedAt（上传后失败）/ generatedAt（生成失败）/ createdAt（首单失败）。
 */
function fallbackAtForFailed(
  status: string,
  generatedAt: string | null,
  uploadedAt: string | null,
  createdAt: string
): string {
  if (status === "FAILED") {
    return generatedAt ?? uploadedAt ?? createdAt;
  }
  return createdAt;
}
