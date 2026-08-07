"use client";

import { motion } from "framer-motion";
import { ArrowRight, Box } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  heroContainerVariants,
  heroItemVariants,
} from "@/components/motion/variants";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";

/**
 * 入场动画变体（与全站 Reveal 共享 EASE 曲线，见 src/components/motion/variants.ts）。
 * Hero 用一次性 mount stagger（不依赖滚动），区别于 Reveal 的 useInView 触发。
 */

/**
 * Hero Section —— 工程图纸风首页主视觉
 *
 * 桌面端双列（左 = 文案 + CTA，右 = 精选产品大卡），移动端单列堆叠。
 * 左列文案：eyebrow + 大标题（主色高亮下划线）+ 副标题 + CTA。
 * 右列精选：spec-sheet 风格大卡，蓝色光晕 + 网格 + 大号产品图标 + 尺寸标尺。
 */
export function HeroSection() {
  const t = useTranslations("Hero");

  return (
    <section className="relative overflow-hidden">
      {/* 氛围层：双色光晕 + 极淡网格（顶部渐隐） */}
      <div
        aria-hidden
        className="aura pointer-events-none absolute inset-0 -z-10"
      />
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-0 -z-10 opacity-70 [mask-image:radial-gradient(72%_60%_at_50%_0%,black,transparent)]"
      />

      <motion.div
        variants={heroContainerVariants}
        initial="hidden"
        animate="show"
        className="container grid items-center gap-10 py-20 md:py-28 lg:grid-cols-[1.05fr_1fr] lg:gap-14"
      >
        {/* 左列：文案 + CTA */}
        <motion.div
          variants={heroItemVariants}
          className="flex flex-col items-start"
        >
          <motion.span variants={heroItemVariants} className="eyebrow">
            {t("eyebrow")}
          </motion.span>

          <motion.h1
            variants={heroItemVariants}
            className="mt-6 text-4xl font-extrabold tracking-tight text-balance text-foreground text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.02]"
          >
            <span className="block">{t("title1")}</span>
            <span className="block">
              <span className="relative inline-block text-primary">
                {t("titleHighlight")}
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-1 h-[6px] rounded-sm bg-primary/20"
                />
              </span>
            </span>
          </motion.h1>

          <motion.p
            variants={heroItemVariants}
            className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            {t("subtitle")}
          </motion.p>

          <motion.div
            variants={heroItemVariants}
            className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row"
          >
            <Button size="lg" asChild className="group">
              <Link href="/sign-up">
                {t("getStarted")}
                <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/#features">{t("seeDemo")}</Link>
            </Button>
          </motion.div>

          <motion.div variants={heroItemVariants} className="mt-8">
            <Link
              href="/products"
              className="font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase hover:text-foreground"
            >
              {t("products.label")} — {t("products.allLink")} →
            </Link>
          </motion.div>
        </motion.div>

        {/* 右列：精选产品大卡（手办 / figure） */}
        <motion.div variants={heroItemVariants} className="relative">
          <FeaturedProductCard
            icon={Box}
            label={t("featuredLabel")}
            name={t("products.figure.name")}
            size={t("products.figure.size")}
            price={t("products.figure.price")}
          />
        </motion.div>
      </motion.div>
    </section>
  );
}

/**
 * 精选产品大卡 —— spec-sheet 风格
 *
 * 设计语言：背景 = aura 主色光晕 + grain 颗粒 + bg-grid 网格；
 * 顶部小号 mono "FEATURED" 标签；中央大号产品图标；
 * 底部产品名 + 尺寸 + 价格；三处尺寸标注线（左、右、下）模拟工程图。
 */
function FeaturedProductCard({
  icon: Icon,
  label,
  name,
  size,
  price,
}: {
  icon: typeof Box;
  label: string;
  name: string;
  size: string;
  price: string;
}) {
  return (
    <div className="aura grain relative overflow-hidden rounded-2xl border bg-card p-6 shadow-soft md:p-8">
      {/* 网格纹理 */}
      <div
        aria-hidden
        className="bg-grid pointer-events-none absolute inset-0 opacity-50 [mask-image:radial-gradient(80%_70%_at_50%_50%,black,transparent)]"
      />

      {/* 顶部 FEATURED 标签 */}
      <div className="relative flex items-center justify-between font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        <span>
          {label} / {name}
        </span>
        <span className="text-primary">★ ★ ★</span>
      </div>

      {/* 中央大号图标 + 尺寸标尺 */}
      <div className="relative mt-6 flex aspect-square items-center justify-center md:mt-8">
        {/* 左侧尺寸标注 */}
        <div
          aria-hidden
          className="absolute top-0 bottom-0 left-0 flex w-4 flex-col justify-between font-mono text-[10px] tracking-[0.14em] text-muted-foreground/60 uppercase"
        >
          <span className="-translate-x-1 -rotate-90">100mm</span>
          <span className="-translate-x-1 translate-y-2 -rotate-90">200mm</span>
        </div>

        {/* 右侧尺寸标注 */}
        <div
          aria-hidden
          className="absolute top-0 right-0 bottom-0 flex w-4 flex-col items-end justify-between font-mono text-[10px] tracking-[0.14em] text-muted-foreground/60 uppercase"
        >
          <span>WJP</span>
          <span>FULL-COLOR</span>
        </div>

        {/* 中央光圈 + 图标 */}
        <div className="flex h-32 w-32 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20 md:h-44 md:w-44">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground md:h-28 md:w-28">
            <Icon className="h-10 w-10 md:h-14 md:w-14" strokeWidth={1.5} />
          </div>
        </div>
      </div>

      {/* 底部产品信息 */}
      <div className="relative mt-6 flex items-end justify-between border-t pt-5 md:mt-8 md:pt-6">
        <div>
          <div className="text-xl font-bold tracking-tight md:text-2xl">
            {name}
          </div>
          <div className="mt-1 font-mono text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
            {size}
          </div>
        </div>
        <div className="font-mono text-base font-semibold tabular-nums md:text-lg">
          {price}
        </div>
      </div>
    </div>
  );
}
