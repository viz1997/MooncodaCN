"use client";

import { Check, Cloud, Heart, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";
import { ConfettiDots, Sparkle, Star } from "./decorations";

/**
 * ComparisonSection —— DIY vs Mooncoda 双卡对比（友好版）
 *
 * 视觉：
 * - 不用表格，改用两张大对比卡（左右）
 * - DIY 卡：浅灰底 + 云朵 emoji + X icon + 灰色字
 * - Mooncoda 卡：暖色底 + Heart emoji + Check icon + 主色字（卡片稍凸出）
 * - 每卡内含 5 行要点
 */

const ROW_KEYS = ["modeling", "color", "moq", "delivery", "revision"] as const;

export function ComparisonSection() {
  const t = useTranslations("Comparison");

  return (
    <section className="relative py-20 md:py-28">
      <ConfettiDots
        items={[
          { color: "var(--accent-coral)", top: "10%", left: "5%", size: 10 },
          { color: "var(--accent-amber)", top: "14%", left: "92%", size: 8 },
        ]}
      />
      <Sparkle
        size={22}
        className="text-coral absolute top-20 right-[8%] animate-float-slow"
      />
      <Star
        size={18}
        className="text-amber absolute bottom-24 left-[6%] animate-wobble"
      />

      <div className="container relative">
        <Reveal>
          <div className="mb-14 flex flex-col items-center gap-4 text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-1.5 shadow-sticker text-xs font-semibold">
              🆚 {t("label")}
            </span>
            <h2 className="text-balance text-3xl font-extrabold tracking-tight md:text-4xl">
              {t("title")}
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground md:text-base">
              {t("subtitle")}
            </p>
          </div>
        </Reveal>

        {/* 双卡对比 */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* DIY 卡（淡灰底） */}
          <Reveal delay={0.1}>
            <div className="bg-muted/40 relative overflow-hidden rounded-3xl border p-8 md:p-10">
              {/* 头部 emoji + 标题 */}
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-muted text-3xl">
                  😓
                </div>
                <div>
                  <div className="font-mono text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    DIY
                  </div>
                  <h3 className="mt-1 text-xl font-extrabold tracking-tight text-muted-foreground">
                    {t("header.diy")}
                  </h3>
                </div>
              </div>

              {/* 5 行要点 */}
              <ul className="mt-8 space-y-4">
                {ROW_KEYS.map((key) => (
                  <li
                    key={key}
                    className="flex items-start gap-3 border-b border-dashed border-muted-foreground/20 pb-3 last:border-b-0"
                  >
                    <X
                      className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground/50"
                      strokeWidth={2.5}
                    />
                    <div className="flex-1">
                      <div className="font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                        {t(`rows.${key}.aspect`)}
                      </div>
                      <div className="mt-0.5 text-sm text-muted-foreground">
                        {t(`rows.${key}.diy`)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* 底部装饰 */}
              <div className="mt-6 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Cloud size={14} />
                <span>累、自己来</span>
              </div>
            </div>
          </Reveal>

          {/* Mooncoda 卡（暖色底，凸出） */}
          <Reveal delay={0.18}>
            <div className="bg-coral-soft shadow-sticker-coral relative overflow-hidden rounded-3xl border-2 border-coral/30 p-8 md:p-10 md:scale-[1.03]">
              {/* 顶部小贴纸 */}
              <div className="absolute top-6 right-6">
                <span className="bg-coral inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide text-white uppercase shadow-sticker-coral">
                  <Sparkle size={10} /> RECOMMENDED
                </span>
              </div>

              {/* 散落装饰 */}
              <div
                aria-hidden
                className="bg-amber absolute top-20 left-6 h-3 w-3 rounded-full"
              />
              <div
                aria-hidden
                className="bg-coral absolute bottom-24 right-12 h-2 w-2 rounded-full"
              />

              {/* 头部 */}
              <div className="flex items-start gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white text-3xl shadow-sticker">
                  💖
                </div>
                <div>
                  <div className="font-mono text-xs font-semibold tracking-[0.14em] text-coral uppercase">
                    FOR YOU
                  </div>
                  <h3 className="mt-1 text-xl font-extrabold tracking-tight">
                    {t("header.us")}
                  </h3>
                </div>
              </div>

              {/* 5 行要点 */}
              <ul className="mt-8 space-y-4">
                {ROW_KEYS.map((key) => (
                  <li
                    key={key}
                    className="flex items-start gap-3 border-b border-dashed border-coral/30 pb-3 last:border-b-0"
                  >
                    <Check
                      className="mt-0.5 h-5 w-5 shrink-0 text-coral"
                      strokeWidth={3}
                    />
                    <div className="flex-1">
                      <div className="font-mono text-[10px] font-semibold tracking-[0.14em] text-coral uppercase">
                        {t(`rows.${key}.aspect`)}
                      </div>
                      <div className="mt-0.5 text-sm font-semibold text-foreground">
                        {t(`rows.${key}.us`)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>

              {/* 底部装饰 */}
              <div className="mt-6 flex items-center gap-2 text-xs font-semibold text-coral">
                <Heart size={14} fill="currentColor" />
                <span>省心、又好看</span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
