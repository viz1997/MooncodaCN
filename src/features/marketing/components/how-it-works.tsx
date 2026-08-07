"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";
import { Section, SectionHeader } from "./section";

/**
 * HowItWorks —— 三步定制流程
 *
 * 用编号 01/02/03 是因为内容本身就是有序流程，
 * 编码承载信息，所以保留；非装饰性编号。
 */
const steps: {
  key: "upload" | "generate" | "export";
  n: string;
}[] = [
  { key: "upload", n: "01" },
  { key: "generate", n: "02" },
  { key: "export", n: "03" },
];

export function HowItWorks() {
  const t = useTranslations("HowItWorks");

  return (
    <Section id="how-it-works" frame="muted">
      <SectionHeader
        eyebrow={t("label")}
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <Reveal delay={0.08}>
        <div className="grid gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.key}>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold text-primary">
                  {s.n}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <h3 className="mt-5 text-xl font-bold tracking-tight text-foreground">
                {t(`steps.${s.key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {t(`steps.${s.key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal delay={0.16}>
        <div className="mt-10 flex items-center gap-4 rounded-xl border bg-card p-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
            <Check className="h-5 w-5" />
          </div>
          <div>
            <p className="font-semibold">{t("completion.title")}</p>
            <p className="text-sm text-muted-foreground">
              {t("completion.description")}
            </p>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
