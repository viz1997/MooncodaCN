"use client";

/**
 * 单个**真实案例**的渲染 —— 图 + 图下说明,无卡片外框
 *
 * ## 这一份是**前台唯一的案例渲染**
 *
 * 首页(`CraftGallery`)和作品集页(`CommunityWall`)摆的是同一批案例 ⇒
 * 渲染也必须是同一份。两处各画一个 ⇒ 改一处忘了另一处,两边就不一样了。
 *
 * ## 数据是**投影好的**,不是一个原始引用
 *
 * `ShowcaseCase.coverSrc` / `beforeSrc` 已经是**能直接用的地址**(服务端
 * 解析过了):配了 CDN 公开域名就是 CDN 地址,没配就是签名跳转路由。
 *
 * ⚠️ 客户端组件**不能**自己解析 —— 解析那一层(`case-image.ts`)import 了 R2。
 *
 * ## 没有原图怎么办
 *
 * **不摆 before/after 指示器,也不摆第二张图** —— 只有成品图的时候摆一个
 * 「移到图上看翻转」的提示,用户移过去什么也不会发生,那是骗人。
 */

import { motion } from "framer-motion";
import { ArrowLeftRight, Heart } from "lucide-react";

import { PRODUCT_TYPES } from "@/features/gpt-image/lib/product-catalog";
import type { ShowcaseCase } from "@/features/showcase/lib/case-types";

/**
 * code → 面向顾客的品类名。从 `PRODUCT_TYPES` 派生(不手抄一份),但**要去掉
 * unit 前缀**。
 *
 * `PRODUCT_TYPES[].name` 是内部规格名,`unit: "cm"` 被拼在前面 —— R 的 name 实际
 * 是 "CM 钥匙扣"、M 是 "CM 手办"。那是给规格表 / SKU 用的,直接印在顾客看的
 * 案例徽章上会读成"CM 钥匙扣"这种莫名其妙的东西(2026-10-21 修)。
 */
const TYPE_NAMES: Record<string, string> = PRODUCT_TYPES.reduce(
  (acc, t) => {
    const prefix = `${t.unit.toUpperCase()} `;
    acc[t.code] = t.name.startsWith(prefix)
      ? t.name.slice(prefix.length)
      : t.name;
    return acc;
  },
  {} as Record<string, string>
);

export function ShowcaseCaseCell({
  item,
  className = "",
  imgClassName = "aspect-square",
  priority = false,
}: {
  item: ShowcaseCase;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
}) {
  const typeLabel = item.productTypeCode
    ? (TYPE_NAMES[item.productTypeCode] ?? item.productTypeCode)
    : null;

  const hasBefore = Boolean(item.beforeSrc);
  const authorInitial = item.authorName.slice(0, 1);

  /** 点了跳到那件商品 —— 没有关联商品就不跳 */
  const image = (
    <div
      className={`relative overflow-hidden rounded-lg bg-muted ${imgClassName}`}
    >
      {/* 成品(默认) */}
      {/* biome-ignore lint/performance/noImgElement: 地址是运行时解析的(R2 签名跳转 / CDN),next/image 的 loader 不认 */}
      <img
        src={item.coverSrc}
        alt={item.title}
        className={`absolute inset-0 w-full h-full object-cover ${
          hasBefore
            ? "transition-opacity duration-500 group-hover:opacity-0"
            : ""
        }`}
        loading={priority ? "eager" : "lazy"}
      />

      {/* 原图(hover 露出)—— 没有原图就不画这一层 */}
      {item.beforeSrc ? (
        // biome-ignore lint/performance/noImgElement: 同上
        <img
          src={item.beforeSrc}
          alt={`${item.title} —— 原图`}
          className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          loading="lazy"
        />
      ) : null}

      {/* 型号徽标 */}
      {typeLabel ? (
        <span className="absolute top-3 left-3 inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] rounded bg-background/85 backdrop-blur text-foreground/80">
          {typeLabel}
        </span>
      ) : null}

      {/* before/after 指示器常驻 —— 只有真能翻的时候才摆 */}
      {hasBefore ? (
        <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] rounded bg-background/85 backdrop-blur text-foreground/70">
          <ArrowLeftRight className="size-2.5" />
          <span className="group-hover:hidden">成品</span>
          <span className="hidden group-hover:inline">原图</span>
        </span>
      ) : null}
    </div>
  );

  return (
    <motion.figure
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className={`group flex flex-col min-w-0 ${className}`}
    >
      {item.productHandle ? (
        <a href={`/products/${item.productHandle}`} className="block">
          {image}
        </a>
      ) : (
        image
      )}

      {/* 说明 —— 直接排在图下,不再包在卡片底色里 */}
      <figcaption className="pt-3 flex flex-col gap-1">
        {item.authorName ? (
          <div className="flex items-center gap-2">
            {/* 头像用作者名首字 —— 零网络依赖 */}
            <span
              aria-hidden
              className="size-6 rounded-full bg-[var(--primary)]/12 text-[var(--primary)] text-[10px] font-medium flex items-center justify-center shrink-0"
            >
              {authorInitial}
            </span>
            <p className="text-xs font-medium truncate">{item.authorName}</p>
          </div>
        ) : null}

        {item.title ? (
          <p className="text-xs font-medium text-foreground leading-relaxed text-pretty line-clamp-2">
            {item.title}
          </p>
        ) : null}

        {item.description ? (
          <p className="text-xs text-foreground/80 leading-relaxed text-pretty line-clamp-2">
            {item.description}
          </p>
        ) : null}

        {item.likes > 0 ? (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Heart className="size-3 fill-accent text-accent" />
            <span>{item.likes.toLocaleString()}</span>
          </p>
        ) : null}
      </figcaption>
    </motion.figure>
  );
}
