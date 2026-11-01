"use client";

import { motion } from "framer-motion";
import { ArrowRight, Upload } from "lucide-react";
import { useStorefrontModal } from "@/features/storefront/hooks/use-storefront-modal";
import { Link } from "@/i18n/routing";
import { formatPriceCNY, WJP_SERIES } from "./wjp-store-data";

/**
 * WJP 作品集首页 Hero —— 移植自 atelier `store-hero.tsx`。
 *
 * 适配差异（最小改动）：
 *  - 移除 atelier 的 `useFormatPrice` (Zustand 货币切换) → 用本仓库的 formatPriceCNY
 *  - "How it works" 锚点保留 (#how)
 *  - featured 卡片默认指向 Q版手办 系列 (s_figure) 与 WJP_SERIES 对齐
 *  - 卡片上的箭头指向 #works(2026-10-31):首页原本还有一个 #all 段
 *    (FeaturedProducts 横向滚动条),重复展示同一批 12 件商品,已删。
 *  - 主 CTA 从 `<Link href="/image-gen">` 改成按钮 → 开品类选择层(2026-10-22):
 *    `/image-gen` 是登录后的 SaaS 工作台,`proxy.ts` 会把未登录访客弹到
 *    `/sign-in?callbackUrl=/image-gen`。Hero 是访客的第一入口,不该一上来就要登录
 *    —— 匿名本来就能跑 `/api/store/*` 的定制链路。
 */
export function StoreHero() {
  // 「上传照片开始」→ CustomizeEntry(选品类)→ CustomWorkshop
  const openCustomizePicker = useStorefrontModal((s) => s.openCustomizePicker);
  // Q版手办 —— WJP_SERIES 至少 3 项,index [1] 一定存在
  const figure = WJP_SERIES[1] as (typeof WJP_SERIES)[number];
  return (
    <section className="bg-background">
      {/* 顶部一道玫瑰细线 —— The Foggy Dog 的收边手法 */}
      <div
        className="h-px w-full"
        style={{ backgroundColor: "var(--accent)" }}
      />
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-0 lg:gap-12 py-12 lg:py-20 items-center">
          {/* Left: copy —— eyebrow + 大衬线标题 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="px-1 lg:px-2"
          >
            <p className="eyebrow text-[var(--accent)] mb-5">
              全彩 3D 定制礼品
            </p>
            {/* 三行硬断,不是两行:lg 栏宽约 584px,text-7xl(72px)下
                「变成一件真实的礼物.」是 10 个全角字 ≈ 720px,放不下,
                浏览器只能在「真实的礼 / 物.」处折行 —— 一个孤零零的
                「物.」挂第三行。改成 4 + 6 字的两行断,不再依赖自然折行。 */}
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-medium tracking-tight leading-[1.02] text-balance">
              一张照片,
              <br />
              变成一件
              <br />
              真实的礼物.
            </h1>
            <p className="mt-6 text-base text-muted-foreground max-w-md leading-relaxed text-pretty">
              上传一张照片,挑选 AI 风格,我们把它做成钥匙扣、Q 版手办或冰箱贴 ——
              每件全彩树脂打印,手工精修。
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={openCustomizePicker}
                className="inline-flex items-center gap-2 bg-[var(--primary)] text-[var(--primary-foreground)] px-7 py-3.5 text-sm font-medium rounded-md hover:opacity-90 transition-opacity group"
              >
                <Upload className="size-4" />
                上传照片开始
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <Link
                href="#how"
                className="inline-flex items-center gap-2 text-[var(--accent)] px-7 py-3.5 text-sm font-medium border border-[var(--accent)]/40 rounded-md hover:bg-[var(--accent)]/5 transition-colors"
              >
                工作流程
              </Link>
            </div>
          </motion.div>

          {/* Right: featured image —— 6s soft-float (atelier globals.css keyframe) */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="relative aspect-[4/3] lg:aspect-[5/4] overflow-hidden rounded-lg mt-10 lg:mt-0 animate-soft-float"
            // 主图落在浅薄荷色块上,呼应下面的「纪念日」色带。
            // 色值跟 occasion-data.ts 的 anniversary wash 保持一致 —— 改那边要同步改这里。
            style={{ backgroundColor: "oklch(0.930 0.048 160)" }}
          >
            <img
              src={figure.cover}
              alt={figure.name}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />
            <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-3">
              <div className="text-white">
                <p className="eyebrow text-white/80 mb-1.5">推荐系列</p>
                <p className="text-lg font-medium">{figure.name}</p>
                <p className="text-xs text-white/75">
                  起 {formatPriceCNY(figure.fromPriceCNY)} · 14 天工期
                </p>
              </div>
              <Link
                href="#works"
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
