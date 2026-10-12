"use client";

import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";
import { ConfettiDots, Heart, Sparkle, Star } from "./decorations";

/**
 * StatsSection —— 数据信任条（手作贴纸版）
 *
 * 视觉语言：
 * - 不用 Section/SectionHeader 框架，自己手写
 * - 4 张大贴纸卡：blob 形圆角 + 暖色阴影 + 顶部 emoji + 大数字
 * - 卡片轻微 wobble 动效（CSS keyframes 已在 globals.css）
 * - 散落的小装饰点缀
 */

type StatKey = "units" | "rating" | "shipping" | "countries";
const STAT_KEYS: StatKey[] = ["units", "rating", "shipping", "countries"];

// 每个 stat 配 emoji + 暖色主调
const STAT_EMOJI: Record<StatKey, { emoji: string; tone: string }> = {
  units: { emoji: "🎁", tone: "bg-coral-soft" },
  rating: { emoji: "⭐", tone: "bg-amber-soft" },
  shipping: { emoji: "📦", tone: "bg-blush-soft" },
  countries: { emoji: "🌏", tone: "bg-coral-soft" },
};

export function StatsSection() {
  const t = useTranslations("Stats");

  return (
    <section className="relative py-20 md:py-28">
      {/* 散落装饰点 */}
      <ConfettiDots
        items={[
          { color: "var(--accent-coral)", top: "8%", left: "5%", size: 10 },
          { color: "var(--accent-amber)", top: "12%", left: "90%", size: 8 },
          { color: "var(--primary)", top: "85%", left: "8%", size: 12 },
          { color: "var(--accent-coral)", top: "80%", left: "92%", size: 10 },
        ]}
      />

      <div className="container relative">
        {/* 顶部小标题 */}
        <Reveal>
          <div className="mb-12 flex flex-col items-center gap-4 text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-1.5 shadow-sticker text-xs font-semibold">
              <Heart size={12} className="text-coral" />
              {t("label")}
            </span>
            <h2 className="text-balance text-3xl font-extrabold tracking-tight md:text-4xl">
              {t("title")}
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground md:text-base">
              {t("subtitle")}
            </p>
          </div>
        </Reveal>

        {/* 4 张贴纸卡 */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STAT_KEYS.map((key, idx) => {
            const meta = STAT_EMOJI[key];
            const rotations = [
              "-rotate-1",
              "rotate-1",
              "-rotate-1",
              "rotate-1",
            ];
            return (
              <Reveal key={key} delay={0.04 + idx * 0.08}>
                <div
                  className={`bg-card shadow-sticker group relative overflow-hidden rounded-3xl border p-6 text-center md:p-8 ${rotations[idx]} transition-transform hover:rotate-0 hover:scale-[1.03]`}
                >
                  {/* 顶部 emoji + 暖色背景圆 */}
                  <div
                    className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${meta.tone} text-2xl`}
                  >
                    {meta.emoji}
                  </div>

                  {/* 大数字 */}
                  <div className="mono-data text-4xl font-extrabold tracking-tight text-primary md:text-5xl">
                    {t(`items.${key}.value`)}
                    {t.has(`items.${key}.suffix`) && (
                      <span className="ml-1 text-2xl text-primary/60 md:text-3xl">
                        {t(`items.${key}.suffix`)}
                      </span>
                    )}
                  </div>

                  {/* 标签 */}
                  {t.has(`items.${key}.label`) && (
                    <div className="mt-3 text-xs font-medium text-muted-foreground">
                      {t(`items.${key}.label`)}
                    </div>
                  )}

                  {/* 角落装饰（每张卡一种） */}
                  <div className="absolute top-3 right-3 opacity-40 transition-opacity group-hover:opacity-100">
                    {idx === 0 && <Sparkle size={12} className="text-coral" />}
                    {idx === 1 && <Star size={12} className="text-amber" />}
                    {idx === 2 && <Heart size={10} className="text-coral" />}
                    {idx === 3 && <Sparkle size={12} className="text-amber" />}
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
