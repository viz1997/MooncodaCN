"use client";

/**
 * 场合色带(锚点 #birthday / #graduation / #anniversary / #seasonal)
 *
 * 这是整站信息架构的主轴:用户先问「送什么场合」,再看到钥匙扣 / 手办 /
 * 冰箱贴混排。
 *
 * 配色手法(The Foggy Dog 的招牌):每一段**整屏铺自己的柔和底色** `wash`
 * (粉彩 / 天蓝 / 薄荷 / 麦色),滚动一屏换一个颜色。
 *
 * ## 四段用同一种版式(2026-10-31)
 *
 * 原来四段各用一种栅格(feature-left / triptych / wide-rows / feature-right),
 * 加上页尾还有一条「全部作品」横向滚动条 —— 整页五套并排栅格在打架,
 * 12 件 unique 商品被摊成 24 次展示,读起来就是「商品列表堆了 5 遍」。
 *
 * 现在:**四段一律用 FeatureSplit**(左大图 + 右侧两张小卡上下叠),节奏只靠
 * 一屏一换的底色走,不再靠换栅格。四段的 handles 互不重复,12 件商品每件
 * 只出现一次 —— 首页不再有第二份目录。
 */

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

import { findProductByHandle } from "@/features/storefront/lib/mock-catalog";
import type { StorefrontProduct } from "@/features/storefront/types";
import { Link } from "@/i18n/routing";

import type { Occasion } from "./occasion-data";
import { OCCASIONS } from "./occasion-data";
import { ProductCard } from "./product-card";

/** 卡片方格底色 —— 比色带再浅一档,让图从色带上「浮」起来 */
const CARD_WASH = "oklch(0.985 0.008 85)";

/** 滚动入场 —— 与页面其余 section 同一套配方 */
const reveal = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  // ease 必须是 tuple,不能是 number[] —— framer-motion 的 Easing 类型
  transition: { duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] as const },
});

/** 段头 —— 四段共用:eyebrow + 衬线大标题 + tagline,右侧「看全部」 */
function BandHeader({ occasion, isZh }: { occasion: Occasion; isZh: boolean }) {
  return (
    <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5 lg:gap-10 mb-10 lg:mb-14">
      <div className="max-w-2xl">
        <p className="eyebrow text-foreground/50 mb-4">
          {isZh ? occasion.eyebrow : `Gifts for ${occasion.labelEn}`}
        </p>
        <h2 className="text-4xl sm:text-5xl lg:text-6xl font-medium tracking-tight leading-[1.05] text-balance">
          {isZh ? occasion.label : occasion.labelEn}
        </h2>
        <p className="mt-4 text-base text-foreground/65 leading-relaxed text-pretty max-w-xl">
          {isZh ? occasion.tagline : occasion.taglineEn}
        </p>
      </div>
      {/* 首页不再有第二份目录(横向滚动条已删),「看全部」指向作品集页 ——
          那里才有全部 12 件 + 品类筛选。 */}
      <Link
        href="/marketing/products"
        className="inline-flex items-center gap-2 shrink-0 text-sm font-medium text-foreground/70 hover:text-[var(--accent)] transition-colors group"
      >
        {isZh ? "看全部作品" : "See all"}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

/**
 * FeatureSplit —— 四段唯一的版式:一张横幅大卡 + 两张紧凑小卡(右侧上下叠)。
 *
 * ## 为什么是 `lg:grid-rows-2` 而不是自然高度(2026-10-21 修正)
 *
 * 第一版大卡用 `aspect-[4/3]` 定高、右侧两张方形卡自然堆叠,结果右侧
 * (2 × 方形 ≈ 1000px)比左侧(横幅 ≈ 540px)高出近一倍,而容器是
 * `items-start`,于是大卡底下空出半个版位 —— 整段看着是「没排完」,
 * 不是设计出来的留白。
 *
 * 现在父栅格显式分两行:大卡 `row-span-2` + `aspect="fill"` 撑满两行,
 * 右侧容器也 `grid-rows-2` 各占一行。两列高度由同一组行高决定,
 * 数学上必然相等,不存在空洞。
 */
function FeatureSplit({
  products,
  isZh,
}: {
  products: StorefrontProduct[];
  isZh: boolean;
}) {
  const [hero, ...rest] = products;
  // occasion-data.ts 保证每段 3 件,但解构出来仍是 T | undefined
  if (!hero) return null;
  return (
    <div className="grid lg:grid-cols-12 lg:grid-rows-2 gap-5 lg:gap-7">
      <div className="lg:col-span-7 lg:row-span-2">
        <ProductCard
          product={hero}
          locale={isZh ? "zh" : "en"}
          wash={CARD_WASH}
          aspect="fill"
          priority
        />
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-1 lg:grid-rows-2 gap-5 lg:gap-7 lg:col-span-5 lg:row-span-2">
        {rest.map((p, i) => (
          <ProductCard
            key={p.handle}
            product={p}
            index={i + 1}
            locale={isZh ? "zh" : "en"}
            wash={CARD_WASH}
            aspect="fill"
            dense
          />
        ))}
      </div>
    </div>
  );
}

export function OccasionShelf({ locale }: { locale: "zh" | "en" }) {
  const isZh = locale === "zh";

  return (
    // id="works" —— 顶部导航「作品」的落点:四段色带的整体入口。
    // scroll-mt-16 = sticky header 高度,锚点跳转不被遮。
    <div id="works" className="scroll-mt-16">
      {OCCASIONS.map((occasion, bandIndex) => {
        const products = occasion.handles
          .map((h) => findProductByHandle(h))
          .filter((p) => p !== null);

        return (
          <motion.section
            key={occasion.id}
            id={occasion.id}
            // scroll-mt-16 = sticky header 高度,锚点跳转不被遮
            // min-h-[88vh] = 整屏色块:滚动一屏换一个颜色
            className="scroll-mt-16 min-h-[88vh] flex flex-col justify-center py-20 lg:py-28"
            style={{ backgroundColor: occasion.wash }}
            {...reveal(bandIndex * 0.02)}
          >
            <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8">
              <BandHeader occasion={occasion} isZh={isZh} />
              <FeatureSplit products={products} isZh={isZh} />
            </div>
          </motion.section>
        );
      })}
    </div>
  );
}
