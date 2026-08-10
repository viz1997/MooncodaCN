"use client";

import { motion } from "framer-motion";
import { ArrowRight, Award, Heart, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  heroContainerVariants,
  heroItemVariants,
} from "@/components/motion/variants";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";
import { ConfettiDots, Flower, Paw, Sparkle, Star } from "./decorations";

/**
 * Hero Section —— 手作潮玩风首页主视觉
 *
 * 视觉锚点：
 * - 散落的 sparkle / heart / paw / flower / star SVG 装饰
 * - blob 形暖色背景（coral + amber）
 * - 大号 display 字号、display font-extrabold + text-balance
 * - 右侧"精选宠物徽章"卡变成软软的有机 blob 形状（不再是 spec-sheet）
 */
export function HeroSection() {
  const t = useTranslations("Hero");

  return (
    <section className="relative overflow-hidden">
      {/* 暖色 blob 背景 —— 两团有机色斑 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 h-[28rem] w-[28rem] blob-1 bg-coral-soft opacity-70 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-32 h-[32rem] w-[32rem] blob-2 bg-amber-soft opacity-70 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/3 right-1/3 h-72 w-72 blob-3 bg-blush-soft opacity-50 blur-3xl"
      />

      {/* 散落装饰（顶部 + 两侧） */}
      <ConfettiDots
        items={[
          { color: "var(--accent-coral)", top: "12%", left: "8%", size: 10 },
          { color: "var(--accent-amber)", top: "22%", left: "92%", size: 8 },
          { color: "var(--primary)", top: "60%", left: "4%", size: 12 },
          { color: "var(--accent-coral)", top: "70%", left: "95%", size: 10 },
          { color: "var(--accent-amber)", top: "85%", left: "12%", size: 8 },
          { color: "var(--primary)", top: "40%", left: "88%", size: 6 },
        ]}
      />

      {/* 浮动装饰 SVG */}
      <Sparkle
        size={28}
        className="text-coral absolute top-24 left-[10%] animate-float-slow"
      />
      <Heart
        size={20}
        className="text-coral absolute top-40 right-[18%] animate-wobble"
      />
      <Star
        size={22}
        className="text-amber absolute bottom-32 left-[6%] animate-float-slow"
      />
      <Flower
        size={24}
        className="text-coral absolute right-[8%] bottom-40 animate-wobble"
      />
      <Paw
        size={28}
        className="text-amber absolute top-[55%] left-[3%] animate-float-slow"
      />

      <motion.div
        variants={heroContainerVariants}
        initial="hidden"
        animate="show"
        className="container relative grid items-center gap-12 py-20 md:py-32 lg:grid-cols-[1.1fr_1fr] lg:gap-16"
      >
        {/* 左列：文案 + CTA */}
        <motion.div
          variants={heroItemVariants}
          className="flex flex-col items-start"
        >
          {/* 顶部小贴纸徽章（不是 mono eyebrow，是友好的"你好"贴纸） */}
          <motion.div
            variants={heroItemVariants}
            className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-2 shadow-sticker"
          >
            <Sparkles size={14} className="text-coral" />
            <span className="text-xs font-semibold tracking-wide">
              {t("badge")}
            </span>
            <Heart size={12} className="text-coral" />
          </motion.div>

          <motion.h1
            variants={heroItemVariants}
            className="mt-8 font-extrabold tracking-tight text-balance text-foreground text-[clamp(2.75rem,7vw,5.5rem)] leading-[1.02]"
          >
            <span className="block">{t("title1")}</span>
            <span className="block">
              <span className="relative inline-block text-primary">
                {t("titleHighlight")}
                {/* 手绘下划线（用 SVG，不是 mono bg） */}
                <svg
                  aria-hidden
                  role="presentation"
                  viewBox="0 0 200 12"
                  className="text-coral absolute -bottom-2 left-0 h-3 w-full"
                  fill="none"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M2 8 C 50 2, 100 10, 198 5"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </span>
          </motion.h1>

          <motion.p
            variants={heroItemVariants}
            className="mt-8 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            {t("subtitle")}
          </motion.p>

          <motion.div
            variants={heroItemVariants}
            className="mt-10 flex w-full flex-col gap-3 sm:w-auto sm:flex-row"
          >
            <Button
              size="lg"
              asChild
              className="shadow-sticker-coral group h-14 rounded-full px-8 text-base"
            >
              <Link href="/sign-up">
                {t("getStarted")}
                <ArrowRight className="ml-1 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              asChild
              className="h-14 rounded-full px-8 text-base"
            >
              <Link href="/#use-cases">{t("seeDemo")}</Link>
            </Button>
          </motion.div>

          {/* 一句话承诺 */}
          <motion.p
            variants={heroItemVariants}
            className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Heart size={14} className="text-coral" />
            {t("trustPromise")}
          </motion.p>
        </motion.div>

        {/* 右列：精选产品大卡 —— 友好 blob 形状 */}
        <motion.div variants={heroItemVariants} className="relative">
          {/* 装饰圆点围绕 */}
          <Sparkle
            size={20}
            className="text-coral absolute -top-4 -left-4 animate-wobble"
          />
          <Flower
            size={18}
            className="text-amber absolute -right-2 -bottom-2 animate-float-slow"
          />
          <Star
            size={14}
            className="text-coral absolute top-8 -right-6 animate-float-slow"
          />

          <FeaturedProductCard
            icon={Award}
            label={t("featuredLabel")}
            name={t("products.badge.name")}
            size={t("products.badge.size")}
            price={t("products.badge.price")}
          />
        </motion.div>
      </motion.div>

      {/* 底部小型品类 chip 行 */}
      <motion.div
        variants={heroItemVariants}
        initial="hidden"
        animate="show"
        className="container relative pb-16"
      >
        <div className="flex flex-wrap items-center justify-center gap-3 md:justify-start">
          <span className="text-xs font-medium text-muted-foreground">
            ✦ 现做品类
          </span>
          <span className="rounded-full bg-card px-4 py-1.5 text-xs font-semibold shadow-sticker">
            宠物徽章
          </span>
          <span className="rounded-full bg-card px-4 py-1.5 text-xs font-semibold shadow-sticker">
            钥匙扣
          </span>
          <span className="rounded-full bg-card px-4 py-1.5 text-xs font-semibold shadow-sticker">
            冰箱贴
          </span>
          <span className="rounded-full bg-card px-4 py-1.5 text-xs font-semibold shadow-sticker">
            手办 / 立牌
          </span>
          <span className="rounded-full bg-card px-4 py-1.5 text-xs font-semibold shadow-sticker">
            礼品套装
          </span>
        </div>
      </motion.div>
    </section>
  );
}

/**
 * 精选产品大卡 —— 手作 blob 形状
 *
 * 视觉：不再是 spec-sheet 工程图，是软软的有机卡片
 * - 卡片整体用 blob-1（不规则圆角）
 * - 中央是 Award 图标（宠物徽章）
 * - 顶部"bestseller"贴纸
 * - 散落小装饰点
 */
function FeaturedProductCard({
  icon: Icon,
  label,
  name,
  size,
  price,
}: {
  icon: typeof Award;
  label: string;
  name: string;
  size: string;
  price: string;
}) {
  return (
    <div className="bg-card blob-2 shadow-sticker relative overflow-hidden border p-8 md:p-10">
      {/* 散落小装饰点 */}
      <div
        aria-hidden
        className="bg-coral-soft absolute top-6 right-6 h-3 w-3 rounded-full"
      />
      <div
        aria-hidden
        className="bg-amber-soft absolute bottom-12 left-8 h-2 w-2 rounded-full"
      />
      <div
        aria-hidden
        className="bg-blush absolute top-1/3 right-10 h-2 w-2 rounded-full"
      />

      {/* 顶部 bestseller 贴纸 */}
      <div className="relative">
        <span className="bg-coral text-white inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase">
          <Sparkle size={12} /> {label}
        </span>
      </div>

      {/* 中央 icon */}
      <div className="relative mt-8 flex aspect-square items-center justify-center">
        <div className="bg-warm blob-3 flex h-44 w-44 items-center justify-center md:h-56 md:w-56">
          <div className="bg-coral-soft blob-1 flex h-28 w-28 items-center justify-center md:h-36 md:w-36">
            <Icon
              className="h-14 w-14 text-primary md:h-20 md:w-20"
              strokeWidth={1.5}
            />
          </div>
        </div>
      </div>

      {/* 底部信息 */}
      <div className="relative mt-8 flex items-end justify-between border-t border-dashed pt-5">
        <div>
          <div className="text-2xl font-extrabold tracking-tight md:text-3xl">
            {name}
          </div>
          <div className="mt-1 text-xs font-medium text-muted-foreground">
            {size} · WJP 全彩
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold text-muted-foreground">
            起售价
          </div>
          <div className="mono-data text-xl font-extrabold text-primary tabular-nums md:text-2xl">
            {price}
          </div>
        </div>
      </div>
    </div>
  );
}
