"use client";

import { Camera, Check, ImageDown, Truck } from "lucide-react";
import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";
import { ConfettiDots, Flower, Paw, Sparkle } from "./decorations";

/**
 * HowItWorks —— 三步定制旅程（手作卡片版）
 *
 * 视觉：
 * - 不用 Section 框架，自己手写
 * - 3 张大卡：暖色 blob 形 + 大号 icon + 编号圆形 badge + 标题 + 描述
 * - 卡片之间用虚线 / 箭头连接（mobile 单列隐藏）
 * - 底部完成提示：暖色横幅 + 大对勾
 */

const STEPS: {
  key: "upload" | "generate" | "export";
  n: string;
  emoji: string;
  icon: typeof Camera;
  tone: string;
}[] = [
  { key: "upload", n: "01", emoji: "📸", icon: Camera, tone: "bg-coral-soft" },
  {
    key: "generate",
    n: "02",
    emoji: "🎨",
    icon: ImageDown,
    tone: "bg-amber-soft",
  },
  { key: "export", n: "03", emoji: "📦", icon: Truck, tone: "bg-blush-soft" },
];

export function HowItWorks() {
  const t = useTranslations("HowItWorks");

  return (
    <section className="relative py-20 md:py-28">
      <ConfettiDots
        items={[
          { color: "var(--accent-coral)", top: "10%", left: "8%", size: 10 },
          { color: "var(--accent-amber)", top: "20%", left: "94%", size: 8 },
          { color: "var(--accent-coral)", top: "75%", left: "6%", size: 12 },
          { color: "var(--accent-amber)", top: "85%", left: "92%", size: 10 },
        ]}
      />

      <Sparkle
        size={22}
        className="text-coral absolute top-16 left-[6%] animate-float-slow"
      />
      <Flower
        size={20}
        className="text-amber absolute right-[8%] top-20 animate-wobble"
      />
      <Paw
        size={26}
        className="text-coral absolute bottom-24 left-[5%] animate-float-slow"
      />

      <div className="container relative">
        <Reveal>
          <div className="mb-16 flex flex-col items-center gap-4 text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-1.5 shadow-sticker text-xs font-semibold">
              ✨ {t("label")}
            </span>
            <h2 className="text-balance text-3xl font-extrabold tracking-tight md:text-4xl">
              {t("title")}
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground md:text-base">
              {t("subtitle")}
            </p>
          </div>
        </Reveal>

        {/* 3 步卡片 */}
        <div className="relative grid gap-8 md:grid-cols-3">
          {/* 连线（md+ 才显示，2 条虚线箭头） */}
          <div
            aria-hidden
            className="hidden md:block absolute top-1/2 left-[16.6%] w-[16.6%] -translate-y-1/2 border-t-2 border-dashed border-coral/40"
          />
          <div
            aria-hidden
            className="hidden md:block absolute top-1/2 left-[50%] w-[16.6%] -translate-y-1/2 border-t-2 border-dashed border-coral/40"
          />

          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            return (
              <Reveal key={step.key} delay={0.06 + idx * 0.1}>
                <div className="bg-card shadow-sticker group relative overflow-hidden rounded-3xl border p-8 transition-transform hover:-translate-y-1">
                  {/* 散落装饰 */}
                  <div
                    aria-hidden
                    className={`absolute top-4 right-4 h-2 w-2 rounded-full ${step.tone}`}
                  />

                  {/* 编号圆形 badge */}
                  <div className="relative">
                    <div
                      className={`inline-flex h-20 w-20 items-center justify-center rounded-2xl ${step.tone} text-3xl shadow-sticker`}
                    >
                      {step.emoji}
                    </div>
                    <span className="absolute -top-2 -right-2 flex h-9 w-9 items-center justify-center rounded-full bg-coral text-xs font-extrabold text-white shadow-sticker-coral">
                      {step.n}
                    </span>
                  </div>

                  {/* 标题 */}
                  <h3 className="mt-6 text-xl font-extrabold tracking-tight">
                    {t(`steps.${step.key}.title`)}
                  </h3>

                  {/* 描述 */}
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {t(`steps.${step.key}.description`)}
                  </p>

                  {/* 底部小 icon */}
                  <div className="mt-6 flex items-center gap-2 text-xs font-semibold text-primary">
                    <Icon size={14} />
                    <span>step {step.n}</span>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>

        {/* 完成提示卡（暖色横幅） */}
        <Reveal delay={0.4}>
          <div className="bg-coral-soft shadow-sticker-coral mt-12 flex items-center gap-5 overflow-hidden rounded-3xl border p-6 md:p-8">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-coral shadow-sticker">
              <Check className="h-7 w-7" strokeWidth={3} />
            </div>
            <div className="flex-1">
              <p className="text-base font-extrabold md:text-lg">
                {t("completion.title")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("completion.description")}
              </p>
            </div>
            <div className="hidden text-4xl md:block">🎉</div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
