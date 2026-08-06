"use client";

import { Check, Maximize2 } from "lucide-react";
import { useRef } from "react";

import { candidateUrl } from "./image-urls";

interface CandidateGridProps {
  token: string;
  updatedAt: string;
  imageIdx: number;
  candidateCount: number;
  selectedCand: number | null;
  disabled?: boolean;
  onSelect: (candIdx: number) => void;
  onZoom: (candIdx: number) => void;
}

function gridColsFor(count: number) {
  if (count <= 1) return "grid-cols-1";
  if (count <= 4) return "grid-cols-2";
  return "grid-cols-2 sm:grid-cols-3";
}

export function CandidateGrid({
  token,
  updatedAt,
  imageIdx,
  candidateCount,
  selectedCand,
  disabled = false,
  onSelect,
  onZoom,
}: CandidateGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const map: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: 1,
      ArrowLeft: -1,
      ArrowUp: -1,
    };
    const delta = map[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    const next = (idx + delta + candidateCount) % candidateCount;
    containerRef.current
      ?.querySelector<HTMLButtonElement>(`#cand-${imageIdx}-${next}`)
      ?.focus();
  };

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={`第 ${imageIdx + 1} 张照片的效果图`}
      className={`grid gap-3 ${gridColsFor(candidateCount)}`}
    >
      {Array.from({ length: candidateCount }).map((_, c) => {
        const isSel = selectedCand === c;
        return (
          <div key={c} className="relative">
            <button
              id={`cand-${imageIdx}-${c}`}
              type="button"
              role="radio"
              aria-checked={isSel}
              aria-label={`效果图 ${c + 1}${isSel ? "，已选择" : ""}`}
              tabIndex={isSel || (selectedCand === null && c === 0) ? 0 : -1}
              disabled={disabled}
              onClick={() => !disabled && onSelect(c)}
              onKeyDown={(e) => onKeyDown(e, c)}
              className={[
                "block w-full overflow-hidden rounded-xl border-2 bg-zinc-100 transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
                disabled
                  ? "cursor-default border-zinc-200"
                  : isSel
                    ? "border-emerald-500 ring-2 ring-emerald-500/20"
                    : "border-zinc-200 hover:border-emerald-400",
              ].join(" ")}
            >
              <span className="relative block aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {/* biome-ignore lint/performance/noImgElement: 外部 R2 公开域 */}
                <img
                  src={candidateUrl(token, imageIdx, c, updatedAt)}
                  alt={`第 ${imageIdx + 1} 张照片的效果图 ${c + 1}`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <span className="absolute top-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                  #{c + 1}
                </span>
                {isSel && (
                  <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-emerald-500 py-1.5 text-xs font-medium text-white">
                    <Check className="h-3.5 w-3.5" /> 已选择
                  </span>
                )}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onZoom(c)}
              aria-label={`放大查看效果 ${c + 1}`}
              className="absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
