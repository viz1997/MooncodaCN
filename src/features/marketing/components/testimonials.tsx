"use client";

import { Quote } from "lucide-react";
import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";
import { Section, SectionHeader } from "./section";

export function Testimonials() {
  const t = useTranslations("Testimonials");

  // 取前 3 条，保持页面紧凑
  const testimonialItems = [0, 1, 2].map((i) => ({
    content: t(`items.${i}.content`),
    author: t(`items.${i}.author`),
    role: t(`items.${i}.role`),
  }));

  return (
    <Section>
      <SectionHeader
        eyebrow={t("label")}
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <Reveal delay={0.08}>
        <div className="grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-3">
          {testimonialItems.map((testimonial) => (
            <figure
              key={testimonial.author}
              className="flex flex-col justify-between gap-6 bg-card p-7"
            >
              <blockquote>
                <Quote className="mb-3 h-5 w-5 text-primary" />
                <p className="text-sm leading-relaxed text-foreground/80">
                  {testimonial.content}
                </p>
              </blockquote>
              <figcaption className="border-t pt-4">
                <div className="text-sm font-semibold text-foreground">
                  {testimonial.author}
                </div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {testimonial.role}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </Reveal>
    </Section>
  );
}
