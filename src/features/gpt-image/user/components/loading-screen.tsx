/**
 * 首次加载骨架屏 —— 顶栏 + 内容区，避免纯白闪屏让用户以为"没加载出来"。
 */

import { Loader2 } from "lucide-react";

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      role="presentation"
      aria-label="加载中"
      className={`animate-pulse rounded-md bg-stone-200/70 ${className ?? ""}`}
    />
  );
}

export function LoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa]">
      {/* TopBar skeleton */}
      <header className="sticky top-0 z-30 border-b border-stone-100 bg-white/70 backdrop-blur-2xl">
        <div className="mx-auto flex h-14 max-w-md items-center justify-between gap-3 px-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 space-y-5 px-5 py-6">
        {/* 进度小条 skeleton */}
        <div className="flex items-center justify-center gap-1.5 px-5 py-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton
              // biome-ignore lint/suspicious/noArrayIndexKey: 固定 4 格
              key={i}
              className="h-7 w-7 shrink-0 rounded-full"
            />
          ))}
        </div>

        {/* 卡片内容 skeleton */}
        <div className="space-y-4 rounded-2xl border border-stone-100 bg-white p-5">
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-5 w-44" />
          </div>
          <Skeleton className="h-44 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>

        <p className="flex items-center justify-center gap-2 pt-2 text-xs text-stone-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在加载订单...
        </p>
      </main>
    </div>
  );
}
