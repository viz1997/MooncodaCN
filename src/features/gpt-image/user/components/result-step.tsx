"use client";

import { CheckCircle2, Download, Lock, Maximize2, Package } from "lucide-react";
import { useRef, useState } from "react";
import { candidateUrl, originalUrl } from "./image-urls";
import { Lightbox, type LightboxTarget } from "./lightbox";

interface ResultStepProps {
  token: string;
  orderNo: string;
  updatedAt: string;
  imageCount: number;
  candidateCount: number;
  selections: (number | null)[];
  onDownload: (
    orderNo: string,
    imageIdx: number,
    candIdx: number
  ) => Promise<void>;
}

/**
 * 完成步骤 —— mobile-first 单列布局 + 30%/70% 横排卡片。
 *
 * 设计参考 result-summary.tsx：
 * - 第 4 步徽章 + emerald check 大圆 + "全部完成！"
 * - 锁定提示条（amber 背景 + Lock icon）
 * - 每张效果：横向卡（原图 30% + 效果 70%），下方"第 N 张 · 下载"
 * - "下载全部" 按钮（顺序 +400ms 间隔触发各张下载）
 */
export function ResultStep({
  token,
  orderNo,
  updatedAt,
  imageCount,
  candidateCount,
  selections,
  onDownload,
}: ResultStepProps) {
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null);
  const lastTriggerRef = useRef<string | null>(null);

  const close = () => {
    setLightbox(null);
    const id = lastTriggerRef.current;
    lastTriggerRef.current = null;
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus());
  };

  const handleDownloadAll = () => {
    // 浏览器对多文件下载有限制，按顺序带小延迟触发，多数浏览器可接受
    selections.forEach((cand, i) => {
      const idx = cand ?? 0;
      setTimeout(() => {
        void onDownload(orderNo, i, idx);
      }, i * 400);
    });
  };

  return (
    <>
      <section className="mx-auto flex w-full max-w-md flex-col items-stretch px-5 pt-6 pb-10 animate-[fadeIn_.3s_ease-out]">
        {/* 第 4 步徽章 + 大圆 + 标题 */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2
              className="h-7 w-7 text-emerald-500"
              strokeWidth={2}
            />
          </div>
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-medium text-emerald-600">
            <CheckCircle2 className="h-3 w-3" />第 4 步
          </div>
          <h2 className="text-xl font-bold text-stone-900">全部完成！</h2>
          <p className="mt-1 text-sm text-stone-400">
            共 {imageCount} 张效果图已提交
          </p>
        </div>

        {/* 锁定提示条 */}
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-100 bg-amber-50/80 p-3">
          <Lock
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
            strokeWidth={2}
          />
          <p className="text-xs leading-relaxed text-amber-700">
            结果已锁定，不可修改。如需调整，请联系服务方重新开启。
          </p>
        </div>

        {/* 下载全部（多图时） */}
        {imageCount > 1 && (
          <button
            type="button"
            onClick={handleDownloadAll}
            className="mb-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-blue-500 text-sm font-medium text-white shadow-lg shadow-indigo-200/50 transition-shadow hover:shadow-indigo-300/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Download className="h-4 w-4" />
            下载全部 {imageCount} 张
          </button>
        )}

        {/* 每张结果卡 */}
        <div className="w-full max-w-xs space-y-3 self-center">
          {Array.from({ length: imageCount }).map((_, i) => {
            const cand = selections[i] ?? 0;
            const candidateSrc = candidateUrl(token, i, cand, updatedAt);
            const originalSrc = originalUrl(token, i, updatedAt);

            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: 结果项顺序固定只增不删
                key={i}
                className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm"
              >
                {/* 横排：原图 30% + 效果 70% */}
                <div className="flex">
                  {/* 原图 */}
                  <div className="relative w-[30%] bg-stone-50">
                    {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
                    <img
                      src={originalSrc}
                      alt={`第 ${i + 1} 张原图`}
                      className="aspect-[3/4] w-full object-cover"
                      loading="lazy"
                    />
                    <span className="absolute bottom-1 left-1 rounded bg-black/40 px-1.5 py-0.5 text-[9px] text-white/80 backdrop-blur-sm">
                      原图
                    </span>
                  </div>
                  {/* 效果 */}
                  <div className="relative flex-1">
                    <button
                      id={`result-${i}`}
                      type="button"
                      onClick={() => {
                        lastTriggerRef.current = `result-${i}`;
                        setLightbox({ imageIdx: i, candIdx: cand });
                      }}
                      aria-label={`放大查看第 ${i + 1} 张成品`}
                      className="group relative block aspect-[3/4] w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    >
                      {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
                      <img
                        src={candidateSrc}
                        alt={`第 ${i + 1} 张成品效果图`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute top-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-white/90 text-stone-700 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                        <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
                      </span>
                      <span className="absolute right-1 bottom-1 inline-flex items-center gap-0.5 rounded-md bg-emerald-500/80 px-1.5 py-0.5 text-[9px] text-white backdrop-blur-sm">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        选用
                      </span>
                    </button>
                  </div>
                </div>
                {/* 底部：第 N 张 · 下载 */}
                <div className="flex items-center justify-between border-t border-stone-50 px-3 py-2">
                  <span className="text-[11px] text-stone-500">
                    第 {i + 1} 张 · 效果 #{cand + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => void onDownload(orderNo, i, cand)}
                    className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-300"
                  >
                    <Download className="h-3 w-3" />
                    下载
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* 全部完成尾巴提示 */}
        <div className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/40 px-4 py-2.5 text-xs text-stone-700">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <Package className="hidden h-3.5 w-3.5 text-stone-400 sm:inline" />
          全部完成！我们已收到你的选择，会尽快安排打印。
        </div>
      </section>

      {lightbox && (
        <Lightbox
          open
          onClose={close}
          token={token}
          updatedAt={updatedAt}
          target={lightbox}
          onTargetChange={setLightbox}
          imageCount={imageCount}
          candidateCount={candidateCount}
          selectedCand={selections[lightbox.imageIdx] ?? null}
          readOnly
          onSelect={() => {}}
        />
      )}
    </>
  );
}
