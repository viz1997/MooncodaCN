"use client";

import { Check } from "lucide-react";
import { useEffect, useRef } from "react";

import { originalUrl } from "./image-urls";

interface OriginalStripProps {
  token: string;
  updatedAt: string;
  count: number;
  currentIdx: number;
  selections: (number | null)[];
  onChange: (idx: number) => void;
}

export function OriginalStrip({
  token,
  updatedAt,
  count,
  currentIdx,
  selections,
  onChange,
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
            aria-label={`第 ${i + 1} 张照片${chosen ? "，已选好" : "，还没选"}`}
            className={[
              "relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 transition-all sm:h-[72px] sm:w-[72px]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2",
              isCurrent
                ? "border-emerald-500 ring-2 ring-emerald-500/20"
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
            {chosen ? (
              <span className="absolute right-1 bottom-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                <Check className="h-3 w-3" />
              </span>
            ) : (
              <span className="absolute right-1 bottom-1 h-5 w-5 rounded-full border-2 border-dashed border-white/80 bg-black/25" />
            )}
          </button>
        );
      })}
    </div>
  );
}
