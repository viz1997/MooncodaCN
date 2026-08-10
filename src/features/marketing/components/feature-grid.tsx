"use client";

import { Eye, Globe, Package, Palette, Truck, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";
import { ConfettiDots, Sparkle } from "./decorations";

/**
 * FeatureGrid —— 6 项核心能力（手作卡片版）
 *
 * 视觉：
 * - 不用 Section 框架，自己写
 * - 6 张卡片 3 列布局，每张含 emoji + 暖色背景圆 + 大号 lucide icon + 标题 + 描述
 * - 顶部小贴纸 "为什么选我们"
 * - 卡片 hover 微微抬起 + 阴影加深
 * - 散落装饰
 */

type FeatureItem = {
  key: "ai" | "multiSource" | "outline" | "export" | "batch" | "multilingual";
  icon: typeof Wand2;
  emoji: string;
  tone: string;
};

const FEATURES: FeatureItem[] = [
  { key: "ai", icon: Wand2, emoji: "✨", tone: "bg-coral-soft" },
  { key: "multiSource", icon: Eye, emoji: "👀", tone: "bg-amber-soft" },
  { key: "outline", icon: Palette, emoji: "🎨", tone: "bg-blush-soft" },
  { key: "export", icon: Package, emoji: "📦", tone: "bg-coral-soft" },
  { key: "batch", icon: Truck, emoji: "🚚", tone: "bg-amber-soft" },
  { key: "multilingual", icon: Globe, emoji: "🌏", tone: "bg-blush-soft" },
];

export function FeatureGrid() {
  const t = useTranslations("Features");

  return (
    <section id="features" className="relative py-20 md:py-28">
      <ConfettiDots
        items={[
          { color: "var(--accent-coral)", top: "8%", left: "5%", size: 10 },
          { color: "var(--accent-amber)", top: "12%", left: "92%", size: 8 },
          { color: "var(--primary)", top: "78%", left: "8%", size: 10 },
        ]}
      />

      <div className="container relative">
        <Reveal>
          <div className="mb-14 flex flex-col items-center gap-4 text-center md:items-start md:text-left">
            <span className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-1.5 shadow-sticker text-xs font-semibold">
              <Sparkle size={12} className="text-coral" />
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

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, idx) => {
            const Icon = f.icon;
            return (
              <Reveal key={f.key} delay={0.04 + idx * 0.06}>
                <div className="bg-card shadow-sticker group relative overflow-hidden rounded-3xl border p-7 transition-all hover:-translate-y-1 hover:shadow-sticker-coral">
                  {/* 顶部 emoji 圆 + lucide icon */}
                  <div className="mb-5 flex items-center gap-3">
                    <div
                      className={`flex h-14 w-14 items-center justify-center rounded-2xl ${f.tone} text-2xl shadow-sticker`}
                    >
                      {f.emoji}
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>

                  <h3 className="text-lg font-extrabold tracking-tight">
                    {t(`items.${f.key}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(`items.${f.key}.description`)}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
