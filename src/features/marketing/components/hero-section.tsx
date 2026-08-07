"use client";

import { motion } from "framer-motion";
import { ArrowRight, Award, Box, KeyRound, Magnet } from "lucide-react";
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
 * 居中单列：eyebrow + 大标题（主色高亮下划线）+ 副标题 + CTA + 产品系列卡片行。
 * 用 max-w-4xl 约束阅读宽度，避免大屏上文字被拉得过长；保持左对齐以契合
 * "工程图纸"的视觉语言。
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

      <div className="container grid items-center gap-14 py-20 md:py-28">
        {/* 左列 */}
        <motion.div
          variants={heroContainerVariants}
          initial="hidden"
          animate="show"
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

          <motion.div
            variants={heroItemVariants}
            className="mt-10 border-t pt-7"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                {t("products.label")}
              </span>
              <Link
                href="/products"
                className="font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase hover:text-foreground"
              >
                {t("products.allLink")} →
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ProductCard
                icon={KeyRound}
                name={t("products.keychain.name")}
                size={t("products.keychain.size")}
                price={t("products.keychain.price")}
                href="/products"
              />
              <ProductCard
                icon={Award}
                name={t("products.badge.name")}
                size={t("products.badge.size")}
                price={t("products.badge.price")}
                href="/products"
              />
              <ProductCard
                icon={Magnet}
                name={t("products.magnet.name")}
                size={t("products.magnet.size")}
                price={t("products.magnet.price")}
                href="/products"
              />
              <ProductCard
                icon={Box}
                name={t("products.figure.name")}
                size={t("products.figure.size")}
                price={t("products.figure.price")}
                href="/products"
              />
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

/** 产品系列卡片（hero 左下角 4 张） */
function ProductCard({
  icon: Icon,
  name,
  size,
  price,
  href,
}: {
  icon: typeof Award;
  name: string;
  size: string;
  price: string;
  href: "/products" | `/${string}`;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-lg border bg-card p-3.5 transition-colors hover:border-foreground/30 hover:bg-muted/40"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/20 transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold tracking-tight">
          {name}
        </div>
        <div className="mt-0.5 flex items-baseline justify-between gap-1 font-mono text-[10px] text-muted-foreground">
          <span className="truncate">{size}</span>
          <span className="shrink-0 font-semibold text-foreground tabular-nums">
            {price}
          </span>
        </div>
      </div>
    </Link>
  );
}
