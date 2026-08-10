"use client";

import { Check } from "lucide-react";

/**
 * 横向小圆点 + 连接线进度条 —— mobile-first 多图订单的进度提示。
 *
 * - filled (i < done)：emerald 背景 + 白色 ✓
 * - current (i === current && !done)：indigo→blue 渐变背景 + 白色数字
 * - upcoming：stone-100 背景 + stone-400 数字
 * - 连接线：filled = emerald-400，upcoming = stone-200
 *
 * total <= 1 时不渲染（单图订单不需要进度小条）。
 */

interface ImageProgressProps {
  total: number;
  /** 0-based 当前正在选的原图索引 */
  current: number;
  /** 已经选完的原图数（filled 数） */
  done: number;
}

export function ImageProgress({ total, current, done }: ImageProgressProps) {
  if (total <= 1) return null;

  const isAllDone = done >= total;

  return (
    <div className="mx-auto w-full max-w-md px-5 pt-3 pb-1">
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="font-medium text-stone-500">原图进度</span>
        <span className="font-mono text-stone-400 tabular-nums">
          {done}/{total} 完成
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={`原图进度 ${done}/${total}`}
        className="flex items-center gap-1.5"
      >
        {Array.from({ length: total }, (_, i) => {
          const isCompleted = i < done;
          const isCurrent = !isAllDone && i === current;

          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: 固定顺序，进度点不会重排
            <div key={i} className="flex flex-1 items-center last:flex-none">
              <span
                className={[
                  "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all duration-300",
                  isCompleted
                    ? "bg-emerald-500 text-white shadow-sm shadow-emerald-200"
                    : isCurrent
                      ? "bg-gradient-to-br from-indigo-500 to-blue-500 text-white shadow-sm shadow-indigo-200"
                      : "bg-stone-100 text-stone-400",
                ].join(" ")}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isCompleted ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                ) : (
                  i + 1
                )}
              </span>
              {i < total - 1 && (
                <span
                  aria-hidden
                  className={[
                    "mx-1 h-[2px] flex-1 rounded-full transition-all duration-300",
                    isCompleted ? "bg-emerald-400" : "bg-stone-200",
                  ].join(" ")}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
