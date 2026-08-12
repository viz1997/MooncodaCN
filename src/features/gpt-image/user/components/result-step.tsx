"use client";

import { CheckCircle2, Download, Lock, Maximize2 } from "lucide-react";
import { useState } from "react";
import { candidateUrl, originalUrl, preloadImages } from "./image-urls";
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
 * 完成步骤 —— mobile-first 单列布局。
 *
 * 设计要点：
 * - 顶部：大圆 ✓ + 标题"全部完成"+ 数量提示
 * - 锁定条：amber 单行，紧凑
 * - 下载全部：多图时作为主 CTA（gradient button）
 * - 每张结果卡（一张一张上下排）：
 *   - 上：成品效果大图（占主体，3:4），角落 emerald "已选用 #N" 角标 + 放大按钮
 *   - 下：原图缩略图 + "第 N 张" + 下载按钮（一行，metadata 区）
 * - 底部：完成提示条
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

  const closeLightbox = () => setLightbox(null);

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
      <section className="mx-auto flex w-full max-w-md flex-col items-stretch px-5 pt-8 pb-10 animate-[fadeIn_.3s_ease-out]">
        {/* ── Hero ── */}
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-4 ring-emerald-50/60">
            <CheckCircle2
              className="h-9 w-9 text-emerald-500"
              strokeWidth={2}
            />
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-stone-900">
            全部完成！
          </h2>
          <p className="mt-1.5 text-sm text-stone-500">
            共{" "}
            <span className="font-semibold text-stone-700">{imageCount}</span>{" "}
            张效果图已提交
          </p>
        </div>

        {/* ── 锁定提示条（紧凑单行） ── */}
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2">
          <Lock
            className="h-3.5 w-3.5 shrink-0 text-amber-500"
            strokeWidth={2.5}
          />
          <p className="text-xs leading-relaxed text-amber-700">
            结果已锁定 · 如需调整请联系服务方重新开启
          </p>
        </div>

        {/* ── 下载全部（多图时主 CTA） ── */}
        {imageCount > 1 && (
          <button
            type="button"
            onClick={handleDownloadAll}
            className="mb-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 to-blue-500 text-sm font-medium text-white shadow-lg shadow-indigo-200/50 transition-all hover:shadow-indigo-300/60 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <Download className="h-4 w-4" />
            下载全部 {imageCount} 张
          </button>
        )}

        {/* ── 每张结果卡 ── */}
        <div className="space-y-5">
          {Array.from({ length: imageCount }).map((_, i) => {
            const cand = selections[i] ?? 0;
            const candidateSrc = candidateUrl(token, i, cand, updatedAt);
            const originalSrc = originalUrl(token, i, updatedAt);

            return (
              <ResultCard
                // biome-ignore lint/suspicious/noArrayIndexKey: 结果项顺序固定只增不删
                key={i}
                index={i}
                candidateSrc={candidateSrc}
                originalSrc={originalSrc}
                candIdx={cand}
                onZoom={() => setLightbox({ imageIdx: i, candIdx: cand })}
                onDownload={() => void onDownload(orderNo, i, cand)}
              />
            );
          })}
        </div>

        {/* ── 底部完成提示 ── */}
        <div className="mt-7 flex items-center justify-center gap-2 rounded-xl bg-stone-50 px-4 py-3 text-xs text-stone-500">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span>已收到你的选择 · 会尽快安排打印</span>
        </div>
      </section>

      {lightbox && (
        <Lightbox
          open
          onClose={closeLightbox}
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

/**
 * 单张结果卡：上方大图（成品）+ 下方一行（元信息 + 下载）。
 * 拆出子组件便于排版更紧凑，也避免父级 JSX 过深。
 */
interface ResultCardProps {
  index: number;
  candidateSrc: string;
  originalSrc: string;
  candIdx: number;
  onZoom: () => void;
  onDownload: () => void;
}

function ResultCard({
  index,
  candidateSrc,
  originalSrc,
  candIdx,
  onZoom,
  onDownload,
}: ResultCardProps) {
  // 预热相邻两张，让用户连点 lightbox / 翻页不闪白
  preloadImages([candidateSrc, originalSrc]);

  return (
    <article className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
      {/* 上：成品大图（3:4） */}
      <div className="relative">
        <button
          type="button"
          onClick={onZoom}
          aria-label={`放大查看第 ${index + 1} 张成品`}
          className="group relative block aspect-[3/4] w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
          <img
            src={candidateSrc}
            alt={`第 ${index + 1} 张成品效果图`}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            loading="lazy"
          />
          {/* 已选用角标（左上） */}
          <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-1 text-[10px] font-semibold text-white shadow-sm backdrop-blur-sm">
            <CheckCircle2 className="h-3 w-3" strokeWidth={3} />
            选用 #{candIdx + 1}
          </span>
          {/* 放大按钮（右上，hover/focus 显形） */}
          <span className="absolute top-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-full bg-white/85 text-stone-700 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Maximize2 className="h-4 w-4" strokeWidth={2.25} />
          </span>
        </button>
      </div>

      {/* 下：原图缩略图 + 第 N 张 + 下载（一行） */}
      <div className="flex items-center gap-2.5 border-t border-stone-100 px-3 py-2.5">
        <button
          type="button"
          onClick={onZoom}
          aria-label={`放大查看第 ${index + 1} 张原图`}
          className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {/* biome-ignore lint/performance/noImgElement: R2 远程 URL */}
          <img
            src={originalSrc}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-stone-700">
            第 {index + 1} 张
          </p>
          <p className="text-[10px] text-stone-400">
            原图 · 已选 #{candIdx + 1}
          </p>
        </div>
        <button
          type="button"
          onClick={onDownload}
          aria-label={`下载第 ${index + 1} 张成品`}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-stone-100 px-2.5 text-xs font-medium text-stone-700 transition-colors hover:bg-indigo-50 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <Download className="h-3.5 w-3.5" />
          下载
        </button>
      </div>
    </article>
  );
}
