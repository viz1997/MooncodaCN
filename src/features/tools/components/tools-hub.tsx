"use client";

/**
 * 工具中心 —— 全站公开工具的入口页。
 *
 * ## 为什么要有这一层
 *
 * 原来克重计算器直接挂在导航上(「克重」一项),看起来像商城的一个品类。
 * 但它其实是**工具**,不是商品 —— 而且工具会越来越多(模型检查、摆盘计算、
 * 图片尺寸换算……)。每个工具各占一个导航位,导航就会变成工具清单。
 *
 * 所以:导航只留一个「工具」入口,具体有哪些工具在这一页里列。
 *
 * ## 工具本身的性质
 *
 * 所有工具都在浏览器本地跑 —— 模型不上传,结果不入库,不需要登录。
 * 这一点在每一张工具卡片上都写明了,因为访客对「把我的模型传到你们服务器」
 * 是有戒心的。
 */

import { ArrowRight, type LucideIcon, Scale, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

type ToolEntry = {
  id: "weight" | "modelCheck";
  href: string;
  icon: LucideIcon;
  /** i18n key 后缀 */
  key: string;
};

const TOOLS: ToolEntry[] = [
  { id: "weight", href: "/tools/weight", icon: Scale, key: "weight" },
  {
    id: "modelCheck",
    href: "/tools/model-check",
    icon: ShieldCheck,
    key: "modelCheck",
  },
];

export function ToolsHub() {
  const t = useTranslations("ToolsCenter");

  return (
    <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
      <header className="max-w-2xl">
        <p className="eyebrow text-[var(--accent)] mb-4">{t("eyebrow")}</p>
        <h1 className="text-4xl sm:text-5xl font-medium tracking-tight leading-[1.05] text-balance">
          {t("title")}
        </h1>
        <p className="mt-4 text-base text-foreground/65 leading-relaxed text-pretty">
          {t("subtitle")}
        </p>
      </header>

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        {TOOLS.map((tool) => (
          <Link
            key={tool.id}
            href={tool.href}
            className="group flex flex-col rounded-xl border border-border/70 bg-card p-6 transition-colors hover:border-[var(--accent)]/50"
          >
            <span className="inline-flex size-10 items-center justify-center rounded-lg bg-secondary text-[var(--primary)]">
              <tool.icon className="size-5" />
            </span>
            <h2 className="mt-4 text-xl font-medium tracking-tight">
              {t(`tools.${tool.key}.title`)}
            </h2>
            <p className="mt-2 flex-1 text-sm text-muted-foreground leading-relaxed text-pretty">
              {t(`tools.${tool.key}.description`)}
            </p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {(["tag1", "tag2", "tag3", "tag4"] as const).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-secondary/70 px-2.5 py-1 text-[11px] text-muted-foreground"
                >
                  {t(`tools.${tool.key}.${tag}`)}
                </span>
              ))}
            </div>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent)]">
              {t("open")}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>

      <p className="mt-10 rounded-lg border border-border/60 bg-secondary/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        {t("privacy")}
      </p>
    </div>
  );
}
