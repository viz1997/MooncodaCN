"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { Section, SectionHeader } from "./section";

export function CTASection() {
  const t = useTranslations("CTA");

  return (
    <Section>
      <Reveal>
        {/* spec-sheet 风格盒子：卡片底 + 顶部主色光晕 + 网格 + 颗粒 */}
        <div className="aura grain relative overflow-hidden rounded-2xl border bg-card px-6 py-16 text-center shadow-soft md:px-16 md:py-20">
          <div
            aria-hidden
            className="bg-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(60%_60%_at_50%_0%,black,transparent)]"
          />
          <div className="relative mx-auto max-w-2xl">
            <SectionHeader
              eyebrow={t("badge")}
              title={t("title")}
              subtitle={t("subtitle")}
              align="card"
            />

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button size="lg" asChild className="group">
                <Link href="/sign-up">
                  {t("getStarted")}
                  <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/dashboard/generate">{t("seeDemo")}</Link>
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
