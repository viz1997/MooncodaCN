"use client";

import { motion } from "framer-motion";
import { ArrowRight, Upload } from "lucide-react";
import { Link } from "@/i18n/routing";
import { formatPriceCNY, WJP_SERIES } from "./wjp-store-data";

/**
 * WJP 作品集首页 Hero —— 1:1 移植自 atelier `store-hero.tsx`。
 *
 * 适配差异（最小改动）：
 *  - 移除 atelier 的 `useFormatPrice` (Zustand 货币切换) → 用本仓库的 formatPriceCNY
 *  - 主 CTA 链到 NextDevTpl 自家 `/image-gen` 工作台 (不是 atelier 的 `#new` 锚点)
 *  - "How it works" 锚点保留 (#how)
 *  - featured 卡片默认指向 Q版手办 系列 (s_figure) 与 WJP_SERIES 对齐
 */
export function StoreHero() {
  // Q版手办 —— WJP_SERIES 至少 3 项,index [1] 一定存在
  const figure = WJP_SERIES[1] as (typeof WJP_SERIES)[number];
  return (
    <section className="bg-background border-b">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-0 lg:gap-8 py-10 lg:py-16 items-center">
          {/* eyebrow + h1 + body + CTAs */}
          {/* (左半) */}
          {/* Atelier-style: 浅 eyebrow + 大 h1 editorial */}
          {/* Left: copy */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="px-1 lg:px-2"
          >
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground mb-4">
              全彩 3D 定制礼品
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.05] text-balance">
              一张照片,
              <br />
              变成一件真实的礼物.
            </h1>
            <p className="mt-6 text-base text-muted-foreground max-w-md leading-relaxed text-pretty">
              上传一张照片,挑选 AI 风格,我们把它做成钥匙扣、Q 版手办或冰箱贴 ——
              每件全彩树脂打印,手工精修。
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/image-gen"
                className="inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 text-sm font-medium rounded-md hover:bg-foreground/90 transition-colors group"
              >
                <Upload className="size-4" />
                上传照片开始
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="#how"
                className="inline-flex items-center gap-2 text-foreground px-6 py-3 text-sm font-medium border border-border rounded-md hover:bg-muted transition-colors"
              >
                工作流程
              </Link>
            </div>
          </motion.div>

          {/* Right: featured image */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="relative aspect-[4/3] lg:aspect-[5/4] overflow-hidden rounded-lg bg-muted mt-8 lg:mt-0"
          >
            <img
              src={figure.cover}
              alt={figure.name}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
              <div className="text-white">
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/80 mb-1">
                  推荐系列
                </p>
                <p className="text-lg font-semibold">{figure.name}</p>
                <p className="text-xs text-white/75">
                  起 {formatPriceCNY(figure.fromPriceCNY)} · 14 天工期
                </p>
              </div>
              <Link
                href="#series"
                className="size-9 rounded-full bg-white/15 backdrop-blur flex items-center justify-center text-white hover:bg-white/25 transition-colors shrink-0"
                aria-label={`查看 ${figure.name}`}
              >
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
