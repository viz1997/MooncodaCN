"use client";

/**
 * QuadrantGridPicker —— 共享宫格图 cell 选择器（2026-09-11 从 /p/[token] 抽出）
 *
 * 用法：渲染一张 N 宫格 composite PNG 背景 + N 个透明 hotzone 按钮覆盖在上层，
 * 点击 cell → 触发 onSelect(cellIdx)。选中态用 emerald 实色边框 + 内描边视觉。
 *
 * 起源：`src/features/gpt-image/user/components/quadrant-grid.tsx` 是 /p/[token]
 * 订单页用的 cell-picker，但 props 强耦合 token-based URL 生成（`candidateUrl(token,
 * imageIdx, 0, updatedAt)`）。/image-gen demo 流（src/features/image-gen/components/
 * public-image-gen-view.tsx）也用同一套 composite-over-hotzone 模式但 URL 已经是
 * R2 公开域，没有 token。把核心热区逻辑抽到本组件，让两个调用点共享。
 *
 * 复用：
 * - /p/[token]：quadrant-grid.tsx 包成 wrapper，外部签名不变（保持向后兼容）
 * - /image-gen demo：直接调用本组件，compositeUrl = result.url
 * - /image-gen/orders 详情：disabled 模式渲染"已锁定"视觉
 * - /dashboard/prompt-orders admin：仍走 CSS background-position 切 cell（更轻）
 *
 * a11y：
 * - radiogroup + radio 语义（与 quadrant-grid.tsx 保持一致）
 * - 键盘 1..9 选 cell 由调用方实现（QuadrantGrid 不在 picker 层强加数字键行为）
 * - 选中 / 未选 cell 的 aria-label 区分
 */

import { useRef } from "react";

interface QuadrantGridPickerProps {
  /** Composite 宫格图 URL（R2 公开域或 token-based proxy 都可） */
  compositeUrl: string;
  /** 1 = 1x1，2 = 1x2，4 = 2x2，9 = 3x3 */
  candidateCount: 1 | 2 | 4 | 9;
  /** 已选 cell 索引 0..N-1，未选为 null */
  selectedCell: number | null;
  /** 点击 cell 回调（disabled 时不触发） */
  onSelect: (cellIdx: number) => void;
  /** 整组禁用（用于 /image-gen/orders 详情只读展示） */
  disabled?: boolean;
  /** DOM id 前缀（多 picker 同页时避免冲突）。/p/[token] 传 "quad-{imageIdx}" */
  idPrefix?: string;
  /** 整组 a11y label（默认 "效果分镜"） */
  ariaLabel?: string;
  /** 单 cell aria-label 模板；传入 (cellIdx, total) → string；默认 "分镜 N" */
  cellLabel?: (cellIdx: number, total: number) => string;
  className?: string;
}

/** 根据 candidateCount 计算 (cols, rows) */
function layoutOf(count: number): { cols: number; rows: number } {
  if (count === 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count === 4) return { cols: 2, rows: 2 };
  return { cols: 3, rows: 3 };
}

/** 把 0..N-1 转成 (row, col)，row-major */
function posOf(idx: number, cols: number): { row: number; col: number } {
  return { row: Math.floor(idx / cols), col: idx % cols };
}

const DEFAULT_CELL_LABEL = (idx: number): string => `分镜 ${idx + 1}`;

export function QuadrantGridPicker({
  compositeUrl,
  candidateCount,
  selectedCell,
  onSelect,
  disabled = false,
  idPrefix = "quad",
  ariaLabel = "效果分镜",
  cellLabel = DEFAULT_CELL_LABEL,
  className,
}: QuadrantGridPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { cols, rows } = layoutOf(candidateCount);
  const cells = Array.from({ length: candidateCount }, (_, i) =>
    posOf(i, cols)
  );

  // 方向键导航（与原 quadrant-grid.tsx 一致：左右上下移动焦点）
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
      ?.querySelector<HTMLButtonElement>(`#${idPrefix}-${next}`)
      ?.focus();
  };

  return (
    <div ref={containerRef} className={className ?? "relative"}>
      {/* 2026-09-12：加 h-full + flex 让 1:1 父容器高度传递下来
          - 之前内部 div 没 h-full，<img h-full> 退化，img 按 ratio 算自然高度，
            远小于外层 aspect-square 1:1 emerald ring 容器
          - 视觉：emerald ring 1:1 框，里面 QuadrantGridPicker 只占左上角一小块
          - 修：内部 div h-full + flex 居中，img max-h-full/max-w-full
            撑满父容器同时保持 ratio（不裁剪） */}
      <div className="relative h-full w-full overflow-hidden rounded-xl border-2 border-zinc-200 bg-zinc-100 flex items-center justify-center">
        {/* 底层拼接图（完整显示，不裁剪 —— 2026-09-12 修「订单详情效果图被遮挡」）
            - w-full h-full object-contain: 容器固定 1:1（OrderDetailView aspect-square），
              composite 任意 ratio 都按 contain 居中完整显示（留白不裁剪）
            - 之前的 w-full 不限高，composite 高度按 ratio 撑开，被外层 overflow-hidden 切掉
            - 老版本（生成时）也无 h-full：依赖外层 container 的 aspect-square 撑开 img
            - 现在强制 h-full 让 img 撑满容器高度，object-contain 居中保持 ratio */}
        {/* biome-ignore lint/performance/noImgElement: 外部 R2 公开域，next/image 无法优化 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={compositeUrl}
          alt={ariaLabel}
          className="block max-h-full max-w-full object-contain select-none"
          draggable={false}
        />

        {/* 4 / 9 个可点击的热区，覆盖在拼接图上 */}
        <div
          role="radiogroup"
          aria-label={ariaLabel}
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, 1fr)`,
          }}
        >
          {cells.map((_cell, idx) => {
            const isSel = selectedCell === idx;
            return (
              <button
                key={idx}
                id={`${idPrefix}-${idx}`}
                type="button"
                role="radio"
                aria-checked={isSel}
                aria-label={`${cellLabel(idx, candidateCount)}${isSel ? "，已选择" : ""}`}
                tabIndex={
                  isSel || (selectedCell === null && idx === 0) ? 0 : -1
                }
                disabled={disabled}
                onClick={() => !disabled && onSelect(idx)}
                onKeyDown={(e) => onKeyDown(e, idx)}
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
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
