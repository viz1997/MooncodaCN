import type { ReactNode } from "react";

import { Reveal } from "@/components/motion/reveal";
import { cn } from "@/lib/utils";

/**
 * 全站统一的营销 section 框架（视觉打磨抽象）
 *
 * 把 `border-t py-24 + .container` 的样板集中到一个组件里，
 * 避免新加 section 时漏掉 hairline 或用错 padding。
 *
 * 设计原则：
 * - `.container` 一律放在内层 `<div>`，避免 section 自身的 padding 与
 *   container 的 padding 叠加异常
 * - `frame="default"` = border-t py-24（最常用）
 * - `frame="muted"`  = border-t bg-muted/30 py-24（HowItWorks）
 * - `frame="none"`   = 裸横层，无 hairline（保留给 Hero 等异型 section）
 * - `padding="hero"` = py-20 md:py-28（Hero 用，不进 SectionHeader）
 * - `container="narrow"` = container max-w-3xl（FAQ 阅读节奏）
 * - `container="wide"`   = container（默认就是 1280px）
 */

interface SectionProps {
  id?: string;
  children: ReactNode;
  /** 外框形态。默认 `default` = border-t py-24 */
  frame?: "default" | "muted" | "none";
  /** 背景色覆盖（如 "bg-muted/30"）。优先级高于 frame 内置的背景 */
  tone?: string;
  /** 内层容器宽度 */
  container?: "default" | "narrow" | "wide";
  /** 垂直节奏覆盖（"hero" = py-20 md:py-28） */
  padding?: "default" | "hero";
  className?: string;
}

export function Section({
  id,
  children,
  frame = "default",
  tone,
  container = "default",
  padding = "default",
  className,
}: SectionProps) {
  const frameClass = {
    default: "border-t",
    muted: "border-t bg-muted/30",
    none: "",
  }[frame];

  const paddingClass = {
    default: "py-20 md:py-24",
    hero: "py-20 md:py-28",
  }[padding];

  const containerClass = {
    default: "container",
    narrow: "container max-w-3xl",
    wide: "container",
  }[container];

  return (
    <section id={id} className={cn(frameClass, tone, paddingClass, className)}>
      <div className={containerClass}>{children}</div>
    </section>
  );
}

/**
 * SectionHeader — section 顶部的 eyebrow + h2 + subtitle 模板
 *
 * 抽取动机：
 * - 6 个 section 手写完全相同的 `eyebrow + h2 + subtitle` 链
 * - lock 住标题层级（text-3xl md:text-4xl font-extrabold tracking-tight）
 *   和 eyebrow 类名（带方点伪元素），避免再出现 `font-bold` 这种 outlier
 *
 * 变体：
 * - `align="left"`   (默认) = eyebrow + title 左对齐，subtitle 在其下
 * - `align="center"` = 整块居中，FAQ/Pricing/UseCases 用
 * - `align="card"`   = 居中 + eyebrow justify-center（CTA 内嵌卡片）
 * - `split`         = true 时，eyebrow+title 左、subtitle 右对齐（FeatureGrid）
 *
 * 入场动画：内部自带一个 Reveal；如需分段（如 header + grid 各一个 Reveal），
 * 由调用方在外层再用 Reveal 包 grid。
 */
interface SectionHeaderProps {
  eyebrow: string;
  title: string;
  /** 支持字符串或富文本（如 t.rich 返回值） */
  subtitle?: ReactNode;
  align?: "left" | "center" | "card";
  /** FeatureGrid 专用：eyebrow+title 左、subtitle 右侧（md+） */
  split?: boolean;
  /** 标题层级。"h1" 仅 Hero 用 */
  as?: "h2" | "h1";
  className?: string;
}

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  align = "left",
  split = false,
  as = "h2",
  className,
}: SectionHeaderProps) {
  const TitleTag = as;

  const eyebrowClass = cn("eyebrow", align === "center" && "justify-center");

  const titleClass =
    "text-balance text-3xl font-extrabold tracking-tight text-foreground md:text-4xl";

  // split 模式：eyebrow+title 左、subtitle 右（FeatureGrid）
  if (split) {
    return (
      <Reveal>
        <div
          className={cn(
            "mb-12 flex flex-col gap-5 md:flex-row md:items-end md:justify-between md:mb-14",
            className
          )}
        >
          <div>
            <span className={eyebrowClass}>{eyebrow}</span>
            <TitleTag className={cn("mt-4", titleClass)}>{title}</TitleTag>
          </div>
          {subtitle ? (
            <p className="max-w-md text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </Reveal>
    );
  }

  // center / card 模式
  if (align !== "left") {
    return (
      <Reveal>
        <div
          className={cn(
            "mb-12 text-center",
            align === "card" && "mt-5",
            className
          )}
        >
          <span className={eyebrowClass}>{eyebrow}</span>
          <TitleTag
            className={cn(align === "card" ? "mt-5" : "mt-4", titleClass)}
          >
            {title}
          </TitleTag>
          {subtitle ? (
            <p
              className={cn(
                "mx-auto mt-4 max-w-xl text-muted-foreground",
                align === "card" && "max-w-2xl"
              )}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
      </Reveal>
    );
  }

  // default: left-aligned（max-w-2xl 限制阅读宽度）
  return (
    <Reveal>
      <div className={cn("mb-14 max-w-2xl", className)}>
        <span className={eyebrowClass}>{eyebrow}</span>
        <TitleTag className="mt-4">{title}</TitleTag>
        {subtitle ? (
          <p className="mt-4 text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
    </Reveal>
  );
}
