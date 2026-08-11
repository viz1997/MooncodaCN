"use client";

import { AlertTriangle, ImageIcon, Pause, StopCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { originalUrl } from "./image-urls";
import { formatEta } from "./order-lib";

interface GenerateStepProps {
  token: string;
  updatedAt: string;
  uploadedImageCount: number;
  /** 服务端已写入的效果组数 —— 真实进度，不是估算 */
  readyGroups: number;
  candidateCount: number;
  uploadedAt: string | null;
  /** 停止中——禁用按钮防止重复点击 */
  stopping?: boolean;
  /** "停止生成"是协作式打断当前 in-flight 的生成任务，订单保留 */
  onStopClick?: () => void;
}

/**
 * ETA fallback 单张耗时估值：90s。
 *
 * 旧值 30s/张在 GPT-Image-2 上游真实 60-180s 下会早早归零显示成 0，
 * 与 ORDER_DEADLINE_MS 10min 配合后 ETA 会显示 "0s" 误导用户。
 * 仅在没有任何 readyGroups 真实数据时作为兜底。
 */
const DEFAULT_PER_IMAGE_MS = 90_000;

/**
 * 停滞提示阈值：5 分钟。
 *
 * 超过这个时间没收到服务端更新（updatedAt 与上次快照相同）→ 提示用户
 * 主动点「停止生成」，避免干等。仅展示提示，不改 status——状态收敛
 * 由 advance-generation.ts 的硬超时独占，避免用户还在等时被前端抢先判死。
 */
const STALL_HINT_MS = 5 * 60_000;

/**
 * 估算剩余时间（秒）
 * 优先用真实数据：elapsed / readyGroups = 单张耗时均值；没有 readyGroups 时退到默认 30s/张。
 */
function estimateEtaSec(
  uploadedAt: string | null,
  uploadedImageCount: number,
  readyGroups: number
): number {
  const remaining =
    uploadedImageCount - Math.min(readyGroups, uploadedImageCount);
  if (remaining <= 0) return 0;
  const perImageMs =
    uploadedAt && readyGroups > 0
      ? (Date.now() - new Date(uploadedAt).getTime()) / readyGroups
      : DEFAULT_PER_IMAGE_MS;
  return Math.max(1, Math.ceil((remaining * perImageMs) / 1000));
}

/**
 * 生成步骤 —— mobile-first 单列布局 + 圆形进度环。
 *
 * 设计参考 generate-step.tsx：
 * - 第 2 步徽章 + 标题 + ETA 副标题
 * - 原图缩略图（卡片圆角）
 * - SVG 圆形进度环（百分比）
 * - 3 个跳动圆点
 * - "停止生成" outline 按钮
 *
 * 注意：这里的"停止"是协作式打断当前 in-flight 的生成任务，订单保留；
 * 不等于"取消订单"——后者会置订单为 CANCELLED（终态），由 TopBar 的取消按钮触发。
 */
export function GenerateStep({
  token,
  updatedAt,
  uploadedImageCount,
  readyGroups,
  candidateCount,
  uploadedAt,
  stopping = false,
  onStopClick,
}: GenerateStepProps) {
  const done = Math.min(readyGroups, uploadedImageCount);
  const percent =
    uploadedImageCount > 0 ? (done / uploadedImageCount) * 100 : 0;
  const remaining = Math.max(0, uploadedImageCount - done);

  // ETA 每秒刷新一次
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [remaining]);

  const etaSec = estimateEtaSec(uploadedAt, uploadedImageCount, readyGroups);

  // 停滞提示：updatedAt 超过 STALL_HINT_MS 未刷新 + 还有未完成张图
  // → amber 内联提示 + 一次性 toast.warning（latch 防重复弹）。
  // 仅展示，不改 status：状态收敛由服务端前置硬超时独占。
  const stalledMs = Date.now() - new Date(updatedAt).getTime();
  const stalled = remaining > 0 && stalledMs > STALL_HINT_MS;
  const stalledToastShownRef = useRef(false);
  useEffect(() => {
    if (!stalled || stalledToastShownRef.current) return;
    stalledToastShownRef.current = true;
    toast.warning(
      "已等待较长时间。若长时间无进展，可点「停止生成」取消本次重试",
      { duration: 6000 }
    );
  }, [stalled]);

  return (
    <section className="flex flex-col items-center px-5 pt-6 pb-8 animate-[fadeIn_.3s_ease-out]">
      {/* 标题 */}
      <div className="mb-6 text-center">
        <h2 className="text-xl font-bold text-stone-900">正在生成效果图</h2>
        <p className="mt-1 text-sm text-stone-400">
          第 {done + 1} 张原图
          {etaSec > 0 && (
            <span className="text-stone-300"> · {formatEta(etaSec)}</span>
          )}
        </p>
      </div>

      {/* 原图缩略图 */}
      <div className="mb-6 h-28 w-28 overflow-hidden rounded-xl bg-stone-100 shadow-sm ring-2 ring-stone-200">
        {uploadedImageCount > 0 ? (
          /* biome-ignore lint/performance/noImgElement: R2 远程 URL */
          <img
            src={originalUrl(token, done, updatedAt)}
            alt={`正在处理第 ${done + 1} 张原图`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-stone-300">
            <ImageIcon className="h-8 w-8" />
          </div>
        )}
      </div>

      {/* 圆形进度环 */}
      <div className="relative mb-5 h-24 w-24">
        <svg
          className="-rotate-90 h-full w-full"
          viewBox="0 0 100 100"
          role="img"
          aria-label={`生成进度 ${Math.round(percent)}%`}
        >
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="#f5f5f4"
            strokeWidth={6}
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="url(#gradient)"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={`${(percent / 100) * 264} 264`}
            className="transition-all duration-500"
          />
          <defs>
            <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#6366f1" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold tabular-nums text-stone-700">
            {Math.round(percent)}%
          </span>
        </div>
      </div>

      {/* 跳动圆点 */}
      <div className="mb-5 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-2 w-2 animate-bounce rounded-full bg-indigo-400"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>

      {/* 进度明细 */}
      <p className="mb-4 text-center text-xs text-stone-500 tabular-nums">
        {done}/{uploadedImageCount} 张已完成
        {uploadedImageCount > 1 && (
          <span className="ml-1 text-stone-400">
            · {candidateCount} 宫格 × {uploadedImageCount} 张
          </span>
        )}
      </p>

      {/* 停止按钮 */}
      {onStopClick && (
        <>
          {stalled && (
            <output className="mb-3 inline-flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-left text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                已等待超过 5 分钟。如长时间无进展，可点「停止生成」取消本次重试
              </span>
            </output>
          )}
          <button
            type="button"
            onClick={onStopClick}
            disabled={stopping}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300 disabled:opacity-60"
          >
            <StopCircle className="h-3.5 w-3.5" />
            {stopping ? "停止中…" : "停止生成"}
          </button>
          <p className="mt-2 flex items-center gap-1 text-[10px] text-stone-400">
            <Pause className="h-2.5 w-2.5" />
            停止不会取消订单，可在下一步重新发起
          </p>
        </>
      )}

      <p aria-live="polite" className="sr-only">
        已完成 {done} 张，共 {uploadedImageCount} 张
      </p>
    </section>
  );
}
