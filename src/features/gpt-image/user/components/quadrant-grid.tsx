"use client";

/**
 * 2026-09-11：slim wrapper，转发到共享 QuadrantGridPicker。
 *
 * 原本 QuadrantGrid 直接渲染 hotzone + token-based URL 兜底。/image-gen demo 也
 * 用同一套热区模式但 compositeUrl 已经是 R2 公开域没有 token —— 把核心逻辑抽到
 * src/components/quadrant-grid-picker.tsx，本文件保留向后兼容的 props 签名（外部
 * 调用方 select-step.tsx 等不动）。
 */

import { QuadrantGridPicker } from "@/components/quadrant-grid-picker";

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
}: QuadrantGridProps) {
  // 兜底 URL：compositeUrl 缺失时用 token-based candidateUrl 生成（保留旧行为）
  const resolvedCompositeUrl =
    compositeUrl || candidateUrl(token, imageIdx, 0, updatedAt);

  return (
    <QuadrantGridPicker
      compositeUrl={resolvedCompositeUrl}
      candidateCount={quadrantCount}
      selectedCell={selectedQuadrant}
      disabled={disabled}
      onSelect={onSelect}
      idPrefix={`quad-${imageIdx}`}
      ariaLabel={`第 ${imageIdx + 1} 张照片的 ${quadrantCount} 个效果分镜`}
    />
  );
}
