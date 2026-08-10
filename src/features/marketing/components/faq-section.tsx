"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ConfettiDots, Sparkle, Star } from "./decorations";

/**
 * FAQSection —— 常见问题（贴纸卡版）
 *
 * 视觉：
 * - Accordion 项用圆角贴纸卡风格 + 暖阴影
 * - 左侧 emoji + 加号 icon（hover 时旋转 45°）
 * - 散落装饰（coral / amber 圆点 + Sparkle）
 */

const FAQ_EMOJI = ["📦", "✏️", "🌏", "💖", "💬"];

export function FAQSection() {
  const t = useTranslations("FAQ");
  const items = [0, 1, 2, 3, 4].map((i) => ({
    question: t(`items.${i}.question`),
    answer: t(`items.${i}.answer`),
  }));

  return (
    <section className="relative py-20 md:py-28">
      <ConfettiDots
        items={[
          { color: "var(--accent-coral)", top: "8%", left: "6%", size: 10 },
          { color: "var(--accent-amber)", top: "12%", left: "94%", size: 8 },
          { color: "var(--primary)", top: "82%", left: "5%", size: 10 },
          { color: "var(--accent-coral)", top: "86%", left: "93%", size: 8 },
        ]}
      />
      <Sparkle
        size={22}
        className="text-coral absolute top-24 right-[7%] animate-float-slow"
      />
      <Star
        size={18}
        className="text-amber absolute bottom-24 left-[6%] animate-wobble"
      />

      <div className="container relative">
        <Reveal>
          <div className="mb-14 flex flex-col items-center gap-4 text-center">
            <span className="inline-flex items-center gap-2 rounded-full bg-card px-4 py-1.5 shadow-sticker text-xs font-semibold">
              💬 {t("label")}
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
          <div className="mx-auto max-w-3xl">
            <Accordion type="single" collapsible className="space-y-4">
              {items.map((item, idx) => (
                <AccordionItem
                  key={item.question}
                  value={`item-${idx}`}
                  className="bg-card shadow-sticker rounded-3xl border px-6 shadow-none transition-all data-[state=open]:shadow-sticker-coral"
                >
                  <AccordionTrigger className="group rounded-3xl py-5 text-left text-base font-bold hover:no-underline">
                    <span className="flex flex-1 items-center gap-3">
                      <span className="bg-coral-soft flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-base">
                        {FAQ_EMOJI[idx]}
                      </span>
                      <span>{item.question}</span>
                    </span>
                    <Plus className="text-coral h-5 w-5 shrink-0 transition-transform duration-300 group-data-[state=open]:rotate-45" />
                  </AccordionTrigger>
                  <AccordionContent className="pb-5 pl-12 text-sm leading-relaxed text-muted-foreground">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </Reveal>

        <Reveal delay={0.18}>
          <p className="mt-10 text-center text-sm text-muted-foreground">
            {t("morePrompt")}{" "}
            <a
              href="mailto:hi@mooncoda.com"
              className="text-coral font-bold underline-offset-4 hover:underline"
            >
              hi@mooncoda.com
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
