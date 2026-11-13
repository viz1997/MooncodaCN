"use client";

/**
 * 场合促销行(锚点 #birthday / #graduation / #anniversary / #seasonal)
 *
 * ## 2026-11-01:从「陈列商品」改成「导购入口」
 *
 * 原来这四段每段摆 3 件商品卡(左大右二的 FeatureSplit),首页因此有两份目录:
 * 四段色带里的 12 件 + 底部一条横向滚动条里的 12 件。
 *
 * 现在商品目录只有一个 —— `ShopGrid`(#works)的 12 件网格,首屏就能看到
 * 价格和「同款定制」。这四段退成商场的**促销位**:一张海报图 + 场合名 +
 * 一句文案 + 一个 CTA,点 CTA 设场合筛选并滚回商品网格。
 *
 * 场合仍然是首页的一条真实信息轴 —— 「送什么场合」是定制礼品最常见的
 * 入口 —— 只是不再用它重复陈列商品。
 *
 * ## 版式
 *
 * 四段统一:左海报右文案,两列 12 栅格。海报占 5 列,文案 7 列。
 * 底色仍然一屏一换(wash 来自 occasion-data.ts),节奏靠颜色走。
 */

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

import { useShopFilter } from "@/features/storefront/hooks/use-shop-filter";

import type { Occasion } from "./occasion-data";
import { OCCASIONS } from "./occasion-data";

/** 商品网格的锚点 —— 场合筛选完滚回去 */
const SHOP_ANCHOR = "works";

/** 滚动入场 —— 与页面其余 section 同一套配方 */
const reveal = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  // ease 必须是 tuple,不能是 number[] —— framer-motion 的 Easing 类型
  transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const },
});

export function OccasionShelf({ locale }: { locale: "zh" | "en" }) {
  const isZh = locale === "zh";
  const selectOccasion = useShopFilter((s) => s.selectOccasion);

  const goToShop = (occasion: Occasion) => {
    selectOccasion(occasion.id);
    document
      .getElementById(SHOP_ANCHOR)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div id="occasions">
      {OCCASIONS.map((occasion, bandIndex) => (
        <motion.section
          key={occasion.id}
          id={occasion.id}
          // scroll-mt-16 = sticky header 高度,锚点跳转不被遮
          className="scroll-mt-16 py-16 lg:py-24"
          style={{ backgroundColor: occasion.wash }}
          {...reveal(bandIndex * 0.02)}
        >
          <div className="atelier-container grid items-center gap-8 lg:grid-cols-12 lg:gap-10">
            {/* 海报 */}
            <div className="lg:col-span-5">
              <div className="overflow-hidden rounded-lg bg-muted/40">
                <img
                  src={occasion.poster}
                  alt={isZh ? occasion.label : occasion.labelEn}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
              </div>
            </div>

            {/* 文案 + CTA */}
            <div className="lg:col-span-7 lg:pl-4">
              <p className="eyebrow text-foreground/50 mb-4">
                {isZh ? occasion.eyebrow : `Gifts for ${occasion.labelEn}`}
              </p>
              <h2 className="text-4xl sm:text-5xl font-medium tracking-tight leading-[1.05] text-balance">
                {isZh ? occasion.label : occasion.labelEn}
              </h2>
              <p className="mt-4 text-base text-foreground/65 leading-relaxed text-pretty max-w-xl">
                {isZh ? occasion.tagline : occasion.taglineEn}
              </p>
              <button
                type="button"
                onClick={() => goToShop(occasion)}
                className="mt-7 inline-flex items-center gap-2 text-sm font-medium text-[var(--accent)] hover:opacity-80 transition-opacity group"
              >
                {isZh
                  ? `看${occasion.label}的 ${occasion.handles.length} 款`
                  : `See the ${occasion.handles.length} ${occasion.labelEn.toLowerCase()} pieces`}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        </motion.section>
      ))}
    </div>
  );
}
