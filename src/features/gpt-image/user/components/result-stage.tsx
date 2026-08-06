"use client";

import { CheckCircle2, Download, Lock, Maximize2 } from "lucide-react";
import { useRef, useState } from "react";

import { candidateUrl, originalUrl } from "./image-urls";
import { Lightbox, type LightboxTarget } from "./lightbox";

interface ResultStageProps {
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

export function ResultStage({
  token,
  orderNo,
  updatedAt,
  imageCount,
  candidateCount,
  selections,
  onDownload,
}: ResultStageProps) {
  const [lightbox, setLightbox] = useState<LightboxTarget | null>(null);
  const lastTriggerRef = useRef<string | null>(null);

  const close = () => {
    setLightbox(null);
    const id = lastTriggerRef.current;
    lastTriggerRef.current = null;
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus());
  };

  return (
    <>
      <section className="rounded-2xl border border-emerald-200/80 bg-white">
        <div className="border-b border-emerald-100 bg-emerald-50/50 px-4 py-3.5 sm:px-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-emerald-800">
            <CheckCircle2 className="h-5 w-5" />
            最终效果图（共 {imageCount} 张）
          </h2>
          <p className="mt-1.5 text-xs text-emerald-700/80">
            点击图片可放大查看，下方按钮可分别下载每张成品。
          </p>
        </div>

        <ul className="space-y-4 px-4 py-4 sm:px-5">
          {Array.from({ length: imageCount }).map((_, i) => {
            const cand = selections[i] ?? 0;
            return (
              <li
                key={i}
                className="overflow-hidden rounded-xl border border-zinc-200"
              >
                <div className="grid grid-cols-2 gap-px bg-zinc-200">
                  <figure className="bg-white">
                    <figcaption className="px-2.5 py-1.5 text-xs text-zinc-500">
                      原图
                    </figcaption>
                    <div className="aspect-square bg-zinc-100">
                      <img
                        src={originalUrl(token, i, updatedAt)}
                        alt={`第 ${i + 1} 张原图`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </figure>
                  <figure className="bg-white">
                    <figcaption className="px-2.5 py-1.5 text-xs font-medium text-emerald-700">
                      成品 · 效果 #{cand + 1}
                    </figcaption>
                    <button
                      id={`result-${i}`}
                      type="button"
                      onClick={() => {
                        lastTriggerRef.current = `result-${i}`;
                        setLightbox({ imageIdx: i, candIdx: cand });
                      }}
                      aria-label={`放大查看第 ${i + 1} 张成品`}
                      className="relative block aspect-square w-full bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                    >
                      <img
                        src={candidateUrl(token, i, cand, updatedAt)}
                        alt={`第 ${i + 1} 张成品效果图`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm">
                        <Maximize2 className="h-4 w-4" />
                      </span>
                    </button>
                  </figure>
                </div>
                <button
                  type="button"
                  onClick={() => void onDownload(orderNo, i, cand)}
                  className="flex h-11 w-full items-center justify-center gap-2 border-t border-zinc-200 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                >
                  <Download className="h-4 w-4" /> 下载第 {i + 1} 张
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mx-4 mb-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 sm:mx-5 sm:mb-5">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
          <p className="text-xs leading-relaxed text-amber-800">
            已提交的结果不可修改。如需更换其他效果图，请取消订单后联系服务方重新创建。
          </p>
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
