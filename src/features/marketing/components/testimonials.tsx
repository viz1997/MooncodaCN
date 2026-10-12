"use client";

import { Heart, Quote, Star } from "lucide-react";
import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";
import { ConfettiDots, Sparkle } from "./decorations";

/**
 * Testimonials —— 客户评价（聊天气泡版）
 *
 * 视觉：
 * - 不用 figure 引用，改用聊天气泡卡
 * - 每张卡：avatar 圆形（用作者名首字 + 暖色背景）+ 气泡内容 + 底部小爱心
 * - 散落装饰
 * - 6 张卡 3 列
 */

// 把作者名转成 emoji 头像（基于名字 hash）
const AVATAR_EMOJI = ["🐕", "🐱", "🦊", "🐰", "🐼", "🐯"];
const AVATAR_TONE = [
  "bg-coral-soft",
  "bg-amber-soft",
  "bg-blush-soft",
  "bg-coral-soft",
  "bg-amber-soft",
  "bg-blush-soft",
];

export function Testimonials() {
  const t = useTranslations("Testimonials");

  const testimonialItems = [0, 1, 2, 3, 4, 5].map((i) => ({
    content: t(`items.${i}.content`),
    author: t(`items.${i}.author`),
    role: t(`items.${i}.role`),
  }));

  return (
    <section className="relative py-20 md:py-28">
      <ConfettiDots
        items={[
          { color: "var(--accent-coral)", top: "8%", left: "5%", size: 10 },
          { color: "var(--accent-amber)", top: "14%", left: "94%", size: 8 },
          { color: "var(--primary)", top: "78%", left: "7%", size: 10 },
          { color: "var(--accent-coral)", top: "84%", left: "92%", size: 8 },
        ]}
      />
      <Sparkle
        size={22}
        className="text-coral absolute top-24 left-[5%] animate-float-slow"
      />

      <div className="container relative">
        <Reveal>
          <div className="mb-14 flex flex-col items-center gap-4 text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-1.5 shadow-sticker text-xs font-semibold">
              <Heart size={12} className="text-coral" fill="currentColor" />
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

        {/* 6 张气泡卡 */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {testimonialItems.map((item, idx) => (
            <Reveal key={item.author} delay={0.04 + idx * 0.08}>
              <div className="bg-card shadow-sticker group relative rounded-3xl border p-6 transition-all hover:-translate-y-1">
                {/* 5 星评分（用 Star icon） */}
                <div className="mb-4 flex items-center gap-1 text-amber">
                  {[0, 1, 2, 3, 4].map((s) => (
                    <Star
                      key={s}
                      size={14}
                      fill="currentColor"
                      className="text-amber"
                    />
                  ))}
                </div>

                {/* 引号 */}
                <Quote
                  className="text-coral-soft mb-2 h-8 w-8 -scale-x-100"
                  fill="currentColor"
                />

                {/* 评价内容 */}
                <p className="text-sm leading-relaxed text-foreground/85">
                  {item.content}
                </p>

                {/* 底部头像 + 信息 */}
                <div className="mt-5 flex items-center gap-3 border-t border-dashed pt-4">
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${AVATAR_TONE[idx]} text-xl shadow-sticker`}
                  >
                    {AVATAR_EMOJI[idx]}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-extrabold">{item.author}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.role}
                    </div>
                  </div>
                  <Heart
                    size={14}
                    className="text-coral opacity-50 transition-opacity group-hover:opacity-100"
                    fill="currentColor"
                  />
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
