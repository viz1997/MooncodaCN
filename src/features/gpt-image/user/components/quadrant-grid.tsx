"use client";

import { Maximize2 } from "lucide-react";
import { useRef } from "react";

import { candidateUrl } from "./image-urls";

interface QuadrantGridProps {
  token: string;
  updatedAt: string;
  imageIdx: number;
  /** 实际拼成宫格的 URL，存放在 candidates[imageIdx][0] */
  compositeUrl: string;
  /** 1 = 1x1，2 = 1x2，4 = 2x2，9 = 3x3 */
  quadrantCount: 1 | 2 | 4 | 9;
  /** 已选宫格索引 0..N-1，未选为 null */
  selectedQuadrant: number | null;
  disabled?: boolean;
  onSelect: (qIdx: number) => void;
  onZoom: () => void;
}

/** 根据 quadrantCount 计算 (cols, rows) */
function layoutOf(quadrantCount: number): { cols: number; rows: number } {
  if (quadrantCount === 1) return { cols: 1, rows: 1 };
  if (quadrantCount === 2) return { cols: 2, rows: 1 };
  if (quadrantCount === 4) return { cols: 2, rows: 2 };
  return { cols: 3, rows: 3 };
}

/** 把 0..N-1 转成 (row, col)，row-major */
function posOf(qIdx: number, cols: number): { row: number; col: number } {
  return { row: Math.floor(qIdx / cols), col: qIdx % cols };
}

export function QuadrantGrid({
  token,
  updatedAt,
  imageIdx,
  compositeUrl,
  quadrantCount,
  selectedQuadrant,
  disabled = false,
  onSelect,
  onZoom,
}: QuadrantGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { cols, rows } = layoutOf(quadrantCount);
  // 每格的百分比起止点
  const cells = Array.from({ length: quadrantCount }, (_, i) => posOf(i, cols));

  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const map: Record<string, [number, number]> = {
      ArrowRight: [0, 1],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowUp: [-1, 0],
    };
    const delta = map[e.key];
    if (!delta) return;
    e.preventDefault();
    const { row, col } = cells[idx] ?? { row: 0, col: 0 };
    const nextRow = Math.min(Math.max(row + delta[0], 0), rows - 1);
    const nextCol = Math.min(Math.max(col + delta[1], 0), cols - 1);
    const next = nextRow * cols + nextCol;
    containerRef.current
      ?.querySelector<HTMLButtonElement>(`#quad-${imageIdx}-${next}`)
      ?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      {/* 底层拼接图（不裁剪，给用户看完整 2x2 / 3x3 区域） */}
      <div className="relative overflow-hidden rounded-xl border-2 border-zinc-200 bg-zinc-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {/* biome-ignore lint/performance/noImgElement: 外部 R2 公开域，next/image 无法优化 */}
        <img
          src={compositeUrl || candidateUrl(token, imageIdx, 0, updatedAt)}
          alt={`第 ${imageIdx + 1} 张照片的 ${quadrantCount} 个效果分镜`}
          className="block w-full select-none"
          draggable={false}
        />

        {/* 4 / 9 个可点击的热区，覆盖在拼接图上 */}
        <div
          role="radiogroup"
          aria-label={`第 ${imageIdx + 1} 张照片的 ${quadrantCount} 个效果分镜`}
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}
        >
          {cells.map((_cell, qIdx) => {
            const isSel = selectedQuadrant === qIdx;
            return (
              <button
                key={qIdx}
                id={`quad-${imageIdx}-${qIdx}`}
                type="button"
                role="radio"
                aria-checked={isSel}
                aria-label={`分镜 ${qIdx + 1}${isSel ? "，已选择" : ""}`}
                tabIndex={
                  isSel || (selectedQuadrant === null && qIdx === 0) ? 0 : -1
                }
                disabled={disabled}
                onClick={() => !disabled && onSelect(qIdx)}
                onKeyDown={(e) => onKeyDown(e, qIdx)}
                className={[
                  "group/quad relative transition-all focus-visible:outline-none",
                  "focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
                  disabled
                    ? "cursor-default"
                    : isSel
                      ? "cursor-pointer"
                      : "cursor-pointer hover:bg-emerald-400/10",
                ].join(" ")}
              >
                {/* 选中态：实色边框 + 内阴影描边 */}
                {isSel && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-1 rounded-md ring-[3px] ring-emerald-500 ring-offset-0"
                  />
                )}
                {/* 未选态：hover 时显示半透明边框，便于提示可点 */}
                {!isSel && !disabled && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-1 rounded-md ring-1 ring-transparent transition-colors group-hover/quad:ring-emerald-400/60"
                  />
                )}
                {/* 编号小标 + 已选标记 */}
                <span className="pointer-events-none absolute top-2 left-2 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                  #{qIdx + 1}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 放大查看按钮（常驻可见，tap target 44px） */}
      <button
        type="button"
        onClick={onZoom}
        aria-label="放大查看拼接图"
        className="absolute top-2 right-2 flex h-11 w-11 items-center justify-center rounded-lg bg-black/65 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <Maximize2 className="h-5 w-5" />
      </button>
    </div>
  );
}
