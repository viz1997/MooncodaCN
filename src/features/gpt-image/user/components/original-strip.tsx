"use client";

import { Check, Lock } from "lucide-react";
import { useEffect, useRef } from "react";

import { originalUrl } from "./image-urls";

interface OriginalStripProps {
  token: string;
  updatedAt: string;
  count: number;
  currentIdx: number;
  selections: (number | null)[];
  onChange: (idx: number) => void;
  /**
   * 判定某 index 是否已服务端锁定（CANDIDATES_READY 下 partial submit
   * 已写入）。已锁定位：永久 emerald 边框 + 锁定角标，仍可点击切换查看。
   */
  isLocked: (idx: number) => boolean;
}

export function OriginalStrip({
  token,
  updatedAt,
  count,
  currentIdx,
  selections,
  onChange,
  isLocked,
}: OriginalStripProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#orig-tab-${currentIdx}`)
      ?.scrollIntoView({
        block: "nearest",
        inline: "center",
        behavior: "smooth",
      });
  }, [currentIdx]);

  if (count <= 1) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (currentIdx + 1) % count;
    else if (e.key === "ArrowLeft") next = (currentIdx - 1 + count) % count;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#orig-tab-${next}`)
      ?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="切换要处理的照片"
      onKeyDown={onKeyDown}
      className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1"
    >
      {Array.from({ length: count }).map((_, i) => {
        const chosen = selections[i] !== null && selections[i] !== undefined;
        const locked = isLocked(i);
        const isCurrent = i === currentIdx;
        return (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: 顺序固定，与 imageIdx 一一对应
            key={i}
            id={`orig-tab-${i}`}
            type="button"
            role="tab"
            aria-selected={isCurrent}
            tabIndex={isCurrent ? 0 : -1}
            onClick={() => onChange(i)}
            aria-label={
              locked
                ? `第 ${i + 1} 张照片，已提交锁定`
                : chosen
                  ? `第 ${i + 1} 张照片，已选好`
                  : `第 ${i + 1} 张照片，还没选`
            }
            className={[
              "relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition-all sm:h-[72px] sm:w-[72px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
              // 四档语义严格分离：
              // - emerald-500 边框 = "选中"（current，正在浏览/选中原图切换显示
              //   对应的效果图）——**用户原话："不是选过而是选中"**。这条绿框
              //   跟着 currentIdx 走，跟下方 QuadrantGrid 展示哪张原图的候选
              //   组是同一回事
              // - emerald-300 边框 = "选过"（chosen，本地草稿已选候选但不是当前
              //   tab）——和 current 用同色相但降饱和度，"以前选过"但现在没在
              //   看。**用户原话："不是效果图选过"**——选过不要绿框（这里给
              //   浅绿是给个"已选记录"提示，避免完全 zinc-200 让用户以为没选）
              // - zinc-400 边框 = "已锁"（locked，partial submit 后不可改）——
              //   **用户原话："锁住不需要绿框"**。颜色让出来给"选中"
              // - zinc-200 边框 = plain
              //
              // 判断顺序：current > locked > chosen > plain。locked 和 chosen 都
              // 是"过去时"，但 locked 是终态视觉更重，zinc-400 比 emerald-300
              // 视觉上更"已结束"
              isCurrent
                ? "border-emerald-500 ring-2 ring-emerald-500/40"
                : locked
                  ? "border-zinc-400 ring-2 ring-zinc-400/30"
                  : chosen
                    ? "border-emerald-300 ring-2 ring-emerald-300/40"
                    : "border-zinc-200 opacity-70 hover:opacity-100",
            ].join(" ")}
          >
            {/* biome-ignore lint/performance/noImgElement: R2 远程 URL，next/image 域名白名单外 */}
            <img
              src={originalUrl(token, i, updatedAt)}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
            <span className="absolute top-1 left-1 rounded bg-black/55 px-1 text-xs text-white backdrop-blur-sm">
              {i + 1}
            </span>
            {locked ? (
              <span className="absolute right-1 bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-stone-700 text-white shadow-sm">
                <Lock className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : chosen ? (
              <span className="absolute right-1 bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400 text-white shadow-sm ring-2 ring-emerald-300/50">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            ) : isCurrent ? (
              // current 但未选：右下小圆点用 emerald 跟边框同色，最简的"正在操作"指示
              <span className="absolute right-1 bottom-1 h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm ring-2 ring-emerald-500/30" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
