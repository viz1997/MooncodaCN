"use client";

import { Award, Box, KeyRound, Package } from "lucide-react";
import { useTranslations } from "next-intl";
import { Reveal } from "@/components/motion/reveal";
import { Card, CardContent } from "@/components/ui/card";
import { ConfettiDots, Sparkle } from "./decorations";

/**
 * UseCasesSection —— 4 大产品系列（手作卡片版）
 *
 * 视觉：emoji + 暖色背景圆 + 大号 lucide icon + 标题 + 描述 + chip 标签
 */

const useCaseConfig = [
  {
    key: "badge" as const,
    icon: Award,
    emoji: "🏅",
    tone: "bg-coral-soft",
  },
  {
    key: "keychain" as const,
    icon: KeyRound,
    emoji: "🔑",
    tone: "bg-amber-soft",
  },
  {
    key: "figure" as const,
    icon: Box,
    emoji: "🗿",
    tone: "bg-blush-soft",
  },
  {
    key: "gift" as const,
    icon: Package,
    emoji: "🎁",
    tone: "bg-coral-soft",
  },
];

export function UseCasesSection() {
  const t = useTranslations("UseCases");

  return (
    <section id="use-cases" className="relative py-20 md:py-28">
      <ConfettiDots
        items={[
          { color: "var(--accent-coral)", top: "10%", left: "5%", size: 10 },
          { color: "var(--accent-amber)", top: "14%", left: "94%", size: 8 },
          { color: "var(--accent-coral)", top: "78%", left: "6%", size: 12 },
          { color: "var(--accent-amber)", top: "84%", left: "92%", size: 10 },
        ]}
      />
      <Sparkle
        size={22}
        className="text-coral absolute top-20 right-[8%] animate-float-slow"
      />

      <div className="container relative">
        <Reveal>
          <div className="mb-14 flex flex-col items-center gap-4 text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-1.5 shadow-sticker text-xs font-semibold">
              ✦ {t("label")}
            </span>
            <h2 className="text-balance text-3xl font-extrabold tracking-tight md:text-4xl">
              {t("title")}
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground md:text-base">
              {t("subtitle")}
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="grid gap-5 md:grid-cols-2">
            {useCaseConfig.map((uc) => {
              const Icon = uc.icon;
              const examples = t.raw(`items.${uc.key}.examples`) as string[];
              return (
                <Card
                  key={uc.key}
                  className="bg-card shadow-sticker group relative overflow-hidden rounded-3xl border shadow-none transition-all hover:-translate-y-1"
                >
                  <CardContent className="p-7">
                    {/* 顶部 emoji + lucide icon */}
                    <div className="mb-5 flex items-center gap-3">
                      <div
                        className={`flex h-14 w-14 items-center justify-center rounded-2xl ${uc.tone} text-3xl shadow-sticker`}
                      >
                        {uc.emoji}
                      </div>
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon className="h-5 w-5" />
                      </div>
                    </div>

                    <h3 className="text-xl font-extrabold tracking-tight">
                      {t(`items.${uc.key}.title`)}
                    </h3>
                    <p className="mt-1 text-sm font-medium text-coral">
                      {t(`items.${uc.key}.subtitle`)}
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {t(`items.${uc.key}.description`)}
                    </p>

                    {/* chip 标签 */}
                    <div className="mt-5 flex flex-wrap gap-2">
                      {examples.map((example) => (
                        <span
                          key={example}
                          className="inline-flex rounded-full bg-warm px-3 py-1 text-xs font-medium text-foreground/80"
                        >
                          {example}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
