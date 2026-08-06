"use client";

import { Clock, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { originalUrl } from "./image-urls";

interface GeneratingStageProps {
  token: string;
  updatedAt: string;
  uploadedImageCount: number;
  /** 服务端已写入的效果组数 —— 真实进度，不是估算 */
  readyGroups: number;
  candidateCount: number;
  uploadedAt: string | null;
}

function useElapsed(since: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!since) return null;
  const start = new Date(since).getTime();
  if (Number.isNaN(start)) return null;
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/**
 * 生图进度阶段
 *
 * 视觉聚焦在"这张原图正在被处理"——中间一张原图卡片，
 * 上面叠加 shimmer 扫光 + 圆形进度。下方显示 N 张效果中已完成几组，
 * 角落显示已等待时间。
 */
export function GeneratingStage({
  token,
  updatedAt,
  uploadedImageCount,
  readyGroups,
  candidateCount,
  uploadedAt,
}: GeneratingStageProps) {
  const elapsed = useElapsed(uploadedAt);
  const done = Math.min(readyGroups, uploadedImageCount);
  const percent =
    uploadedImageCount > 0 ? (done / uploadedImageCount) * 100 : 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white">
      {/* 顶部状态条 */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2 text-sm text-zinc-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400 motion-reduce:animate-none" />
          <span className="font-medium">正在生成效果图</span>
        </div>
        {elapsed && (
          <span className="flex items-center gap-1 font-mono text-xs tabular-nums text-zinc-400">
            <Clock className="h-3 w-3" />
            {elapsed}
          </span>
        )}
      </div>

      {/* 原图主体 + shimmer */}
      <div className="mx-auto max-w-md px-4 pb-4 sm:px-5">
        <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-zinc-50">
        <img
          src={originalUrl(token, 0, updatedAt)}
          alt="正在处理第 1 张原图"
          className="h-full w-full object-cover"
        />
        {/* 扫光动画层 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%)",
            backgroundSize: "200% 100%",
            animation: "gpt-shimmer 2.4s linear infinite",
          }}
        />
        {/* 角落小卡片：当前进度 */}
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3">
          <div className="rounded-lg bg-white/85 px-2.5 py-1.5 text-xs text-zinc-700 shadow-sm backdrop-blur-md">
            <span className="font-medium tabular-nums">{done}</span>
            <span className="text-zinc-400"> / {uploadedImageCount} 张完成</span>
          </div>
          {uploadedImageCount > 1 && (
            <div className="rounded-lg bg-white/85 px-2.5 py-1.5 text-xs text-zinc-500 shadow-sm backdrop-blur-md">
              {candidateCount} 宫格 × {uploadedImageCount} 张
            </div>
          )}
        </div>
        </div>
      </div>

      {/* 细进度条 */}
      <div className="px-4 py-3 sm:px-5">
        <div className="h-1 overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-zinc-700 to-zinc-900 transition-[width] duration-700 motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 text-center text-xs text-zinc-400">
          {done === 0
            ? "正在准备生成环境…"
            : done < uploadedImageCount
              ? `已生成第 ${done + 1} 张的效果中…`
              : "全部完成，准备进入选择…"}
        </p>
        <p aria-live="polite" className="sr-only">
          已完成 {done} 张，共 {uploadedImageCount} 张
        </p>
      </div>

      {/* shimmer keyframes —— 通过内联 style + global CSS 注入 */}
      <style>{`
        @keyframes gpt-shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </section>
  );
}