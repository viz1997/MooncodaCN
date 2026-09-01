"use client";

/**
 * 2026-09-01：候选输出模式 = "separate" 时使用的横向候选列表。
 *
 * 与 QuadrantGrid 的区别：
 * - QuadrantGrid 渲染 1 张拼接图 + CSS 网格切格子（grid 模式）
 * - CandidateStrip 渲染 N 张独立候选，每张可单独点击 / 键盘导航 /
 *   灯箱放大。点击触发 onSelect(candIdx)。
 *
 * 视觉/交互与 QuadrantGrid 对齐：
 * - 已选：emerald 边框 + 角标 "已选 #N"
 * - disabled：整张图变灰、不可点
 * - 键盘 1..N 选候选由父 SelectStep 处理（不重复实现）
 */

import { useRef } from "react";
import { cn } from "@/lib/utils";
import { candidateUrl } from "./image-urls";

interface CandidateStripProps {
  token: string;
  updatedAt: string;
  imageIdx: number;
  candidateCount: number;
  /** 已选候选索引 0..N-1，未选为 null */
  selectedCand: number | null;
  disabled?: boolean;
  onSelect: (candIdx: number) => void;
}

export function CandidateStrip({
  token,
  updatedAt,
  imageIdx,
  candidateCount,
  selectedCand,
  disabled = false,
  onSelect,
}: CandidateStripProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const deltaMap: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: 2,
      ArrowUp: -2,
    };
    const delta = deltaMap[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    const next = Math.min(Math.max(idx + delta, 0), candidateCount - 1);
    containerRef.current
      ?.querySelector<HTMLButtonElement>(`#cand-${imageIdx}-${next}`)
      ?.focus();
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "grid gap-1.5",
        // N 张候选自适应列数：1 张全宽、2/4 用 2 列、9 用 3 列
        candidateCount === 1
          ? "grid-cols-1"
          : candidateCount === 9
            ? "grid-cols-3"
            : "grid-cols-2",
        disabled && "opacity-60"
      )}
    >
      {Array.from({ length: candidateCount }).map((_, candIdx) => {
        const isSel = selectedCand === candIdx;
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: 顺序即索引
            key={candIdx}
            id={`cand-${imageIdx}-${candIdx}`}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onSelect(candIdx)}
            onKeyDown={(e) => onKeyDown(e, candIdx)}
            aria-pressed={isSel}
            aria-label={`候选 ${candIdx + 1}`}
            className={cn(
              "group/cand relative aspect-square overflow-hidden rounded-lg border-2 bg-zinc-100 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
              isSel
                ? "border-emerald-400 ring-2 ring-emerald-300"
                : "border-zinc-200 hover:border-zinc-300",
              disabled && "cursor-not-allowed"
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/* biome-ignore lint/performance/noImgElement: 外部 R2 公开域，next/image 无法优化 */}
            <img
              src={candidateUrl(token, imageIdx, candIdx, updatedAt)}
              alt={`候选 ${candIdx + 1}`}
              className="h-full w-full object-cover select-none"
              draggable={false}
              loading="lazy"
            />
            <span
              className={cn(
                "pointer-events-none absolute top-1 left-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-white",
                isSel ? "bg-emerald-600" : "bg-zinc-800/70"
              )}
            >
              候选 #{candIdx + 1}
            </span>
            {isSel && (
              <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-medium text-white">
                已选
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
