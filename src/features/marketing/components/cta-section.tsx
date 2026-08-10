"use client";

import { ArrowRight, Heart, Sparkles } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { ConfettiDots, Flower, Sparkle, Star } from "./decorations";

/**
 * CTASection —— 底部大 CTA（手作邀请版）
 *
 * 视觉：
 * - 暖色大幅渐变背景（coral → amber → blush）
 * - 大幅 emoji 主角 + 散落装饰
 * - 大号圆角按钮
 * - 完全丢掉 spec-sheet 风格
 */
export function CTASection() {
  const t = useTranslations("CTA");

  return (
    <section className="relative py-20 md:py-28">
      <div className="container">
        <Reveal>
          {/* 暖色渐变邀请卡 */}
          <div className="bg-coral-soft relative overflow-hidden rounded-[2rem] border-2 border-coral/30 p-8 shadow-sticker-coral md:p-16">
            {/* 渐变叠加（伪 ::before） */}
            <div
              aria-hidden
              className="bg-amber-soft pointer-events-none absolute inset-0 opacity-60"
              style={{
                background:
                  "linear-gradient(135deg, var(--accent-coral-soft) 0%, var(--accent-amber-soft) 50%, var(--accent-blush-soft) 100%)",
              }}
            />

            {/* 散落装饰 */}
            <ConfettiDots
              items={[
                {
                  color: "var(--accent-coral)",
                  top: "10%",
                  left: "8%",
                  size: 12,
                },
                {
                  color: "var(--accent-amber)",
                  top: "16%",
                  left: "85%",
                  size: 10,
                },
                { color: "var(--primary)", top: "60%", left: "5%", size: 14 },
                {
                  color: "var(--accent-coral)",
                  top: "75%",
                  left: "92%",
                  size: 10,
                },
                {
                  color: "var(--accent-amber)",
                  top: "85%",
                  left: "20%",
                  size: 8,
                },
                { color: "var(--primary)", top: "40%", left: "92%", size: 8 },
              ]}
            />

            {/* 大 SVG 装饰 */}
            <Sparkle
              size={32}
              className="text-coral absolute top-12 left-[8%] animate-float-slow"
            />
            <Flower
              size={28}
              className="text-amber absolute top-16 right-[12%] animate-wobble"
            />
            <Star
              size={24}
              className="text-coral absolute bottom-16 left-[10%] animate-float-slow"
            />
            <Sparkle
              size={20}
              className="text-amber absolute bottom-24 right-[8%] animate-wobble"
            />

            <div className="relative mx-auto max-w-2xl text-center">
              {/* 顶部小贴纸 */}
              <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-xs font-extrabold shadow-sticker-coral">
                <Sparkles size={14} className="text-coral" />
                {t("badge")}
              </div>

              {/* 大号 emoji */}
              <div className="my-6 text-7xl md:text-8xl">🎁</div>

              {/* 标题 */}
              <h2 className="text-balance text-3xl font-extrabold tracking-tight md:text-5xl">
                {t("title")}
              </h2>

              {/* 副标题 */}
              <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-foreground/75 md:text-lg">
                {t("subtitle")}
              </p>

              {/* 双按钮 */}
              <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button
                  size="lg"
                  asChild
                  className="shadow-sticker-coral group h-14 rounded-full bg-coral px-8 text-base text-white hover:bg-coral/90"
                >
                  <Link href="/dashboard/generate">
                    {t("getStarted")}
                    <ArrowRight className="ml-1 transition-transform group-hover:translate-x-1" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  asChild
                  className="h-14 rounded-full border-2 bg-white px-8 text-base hover:bg-white/80"
                >
                  <Link href="/#use-cases">{t("seeDemo")}</Link>
                </Button>
              </div>

              {/* 底部小提示 */}
              <p className="mt-6 inline-flex items-center gap-2 text-xs font-medium text-foreground/70">
                <Heart size={12} className="text-coral" fill="currentColor" />7
                天到家 · 不满意免费重做
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
