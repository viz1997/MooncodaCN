"use client";

import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";
import { ConfettiDots, Sparkle } from "./decorations";

/**
 * LogoCloud —— 平台 / 品牌占位墙（手作贴纸版）
 *
 * 视觉：
 * - 8 个 logo 占位槽轻微旋转（贴纸散落感）
 * - 每张贴纸卡有暖色阴影
 * - hover 时归正 + 放大
 */

const LOGO_KEYS = [
  "taobao",
  "xiaohongshu",
  "douyin",
  "weibo",
  "bilibili",
  "pdd",
  "jd",
  "tmall",
] as const;

const ROTATIONS = [
  "-rotate-2",
  "rotate-1",
  "-rotate-1",
  "rotate-2",
  "-rotate-1",
  "rotate-1",
  "-rotate-2",
  "rotate-2",
];

const TONES = [
  "bg-coral-soft",
  "bg-amber-soft",
  "bg-blush-soft",
  "bg-coral-soft",
  "bg-amber-soft",
  "bg-blush-soft",
  "bg-coral-soft",
  "bg-amber-soft",
];

export function LogoCloud() {
  const t = useTranslations("LogoCloud");

  return (
    <section className="relative py-16 md:py-20">
      <ConfettiDots
        items={[
          { color: "var(--accent-coral)", top: "20%", left: "5%", size: 8 },
          { color: "var(--accent-amber)", top: "70%", left: "95%", size: 10 },
        ]}
      />

      <div className="container relative">
        <Reveal>
          <div className="mb-10 flex flex-col items-center gap-3 text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-1.5 shadow-sticker text-xs font-semibold">
              <Sparkle size={12} className="text-coral" />
              {t("label")}
            </span>
            <h2 className="text-balance text-2xl font-extrabold tracking-tight md:text-3xl">
              {t("title")}
            </h2>
            <p className="max-w-xl text-xs text-muted-foreground md:text-sm">
              {t("subtitle")}
            </p>
          </div>
        </Reveal>

        {/* 8 张贴纸 logo 卡 */}
        <Reveal delay={0.08}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-8">
            {LOGO_KEYS.map((key, idx) => (
              <div
                key={key}
                className={`bg-card shadow-sticker ${TONES[idx]} flex h-20 items-center justify-center rounded-2xl border transition-all hover:rotate-0 hover:scale-105 ${ROTATIONS[idx]}`}
              >
                <span className="text-base font-extrabold tracking-tight text-foreground/80">
                  {t(`items.${key}.name`)}
                </span>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
