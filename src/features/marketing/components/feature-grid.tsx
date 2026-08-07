"use client";

import {
  Camera,
  Gift,
  Layers,
  Palette,
  Printer,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Reveal } from "@/components/motion/reveal";

/**
 * 卖点配置 —— WJP 全彩 3D 打印业务
 * - icon 与卡片内容匹配（全彩工艺 / 一件定制 / 一件发货 / 多材质 / 建模 / 包装）
 * - path 是展示用的"工艺代号"风格标签，不需要翻译
 */
const featureConfig = [
  { key: "ai" as const, icon: Palette, path: "WJP / full-color" },
  { key: "multiSource" as const, icon: Camera, path: "1 piece MOQ" },
  { key: "outline" as const, icon: Gift, path: "single shipping" },
  { key: "export" as const, icon: Layers, path: "multi material" },
  { key: "batch" as const, icon: Wrench, path: "pro modeling" },
  { key: "multilingual" as const, icon: Printer, path: "gift pack" },
];

export function FeatureGrid() {
  const t = useTranslations("Features");

  return (
    <section id="features" className="border-t py-24">
      <div className="container">
        <Reveal>
          <div className="mb-14 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <span className="eyebrow">{t("label")}</span>
              <h2 className="mt-4 text-balance text-3xl font-extrabold tracking-tight text-foreground md:text-4xl">
                {t("title")}
              </h2>
            </div>
            <p className="max-w-md text-muted-foreground">{t("subtitle")}</p>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <div className="grid gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-2 lg:grid-cols-3">
            {featureConfig.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.key}
                  className="group relative bg-card p-7 transition-colors hover:bg-muted/40"
                >
                  {/* 右上角代码路径索引 */}
                  <span className="absolute top-6 right-6 font-mono text-[10px] font-semibold tracking-[0.14em] text-muted-foreground/60 uppercase">
                    {feature.path}
                  </span>

                  {/* 图标：hover 时反色填充 */}
                  <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/20 transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                    <Icon className="h-5 w-5" />
                  </div>

                  <h3 className="mb-2 font-semibold tracking-tight">
                    {t(`items.${feature.key}.title`)}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {t(`items.${feature.key}.description`)}
                  </p>
                </div>
              );
            })}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
