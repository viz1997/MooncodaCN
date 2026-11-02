"use client";

/**
 * atelier 商品卡 —— 首页 / 场合色带 / 相关推荐共用。
 *
 * 2026-10-21 换数据源:从 `@/features/products/lib/data` 的 `Product[]`
 * 换成 `mock-catalog` 的 `StorefrontProduct[]`。
 *
 * 换的原因(不是重构洁癖,是有 bug):
 *  1. 旧版卡片链到 `/marketing/products/${slug}` —— **该路由不存在**,
 *     首页每张卡的图和标题都 404。
 *  2. `/product/${handle}`(atelier 详情页)读的是 `StorefrontProduct`,
 *     旧卡片的 slug 与 handle 没有映射表,两边对不上。
 *  换成同一份数据后链接是 `/product/${handle}`,真实存在,且与详情页一致。
 *
 * ⚠️ 同名不同物:`@/features/products/components/product-card.tsx` 是
 * /products 画廊用的另一个卡片,本次没动。改的时候核对 import 路径。
 *
 * 版式(The Foggy Dog 手法):
 *  - 图在 --muted 的方格里,hover 轻微放大
 *  - hover 时右上角浮出原图/成品切换(双图 crossfade)
 *  - 「同款定制」CTA 放在信息区的独立按钮,不再用绝对定位盖在图片链接上
 *    —— 旧版是 <Link> 套 <Link>(非法嵌套),而且 hover 才出现,触屏根本够不到
 *    2026-10-22:它从链 `/image-gen` 改成 setCustomize(本商品)直接开工作台
 */

import { motion } from "framer-motion";
import { Wand2 } from "lucide-react";
import { useRequireSignIn } from "@/features/storefront/hooks/use-require-sign-in";
import { useStorefrontModal } from "@/features/storefront/hooks/use-storefront-modal";
import type { StorefrontProduct } from "@/features/storefront/types";
import { Link } from "@/i18n/routing";

import { formatPriceCNY } from "./wjp-store-data";

/**
 * 图片框比例。
 *
 * `fill` —— 不设比例,撑满父容器高度。场合色带「左大右二」里大卡跨两行、
 * 小卡各占一行,全靠它(2026-10-31:色带统一版式后,首页只剩这一种用法)。
 * `square` —— 默认方图,作品集页的横向滚动条用。
 */
export type CardAspect = "square" | "fill";

const ASPECT_CLASS: Record<CardAspect, string> = {
  square: "aspect-square",
  fill: "h-full",
};

export function ProductCard({
  product,
  index = 0,
  locale = "zh",
  wash,
  priority = false,
  aspect = "square",
  dense = false,
}: {
  product: StorefrontProduct;
  index?: number;
  locale?: "zh" | "en";
  /** 该卡片所在色带;不传则用 --muted(首页 / 全部网格) */
  wash?: string;
  /** 首屏卡片传 true(不 lazy),其余懒加载 */
  priority?: boolean;
  /** 图片框比例,默认方图 */
  aspect?: CardAspect;
  /** 紧凑模式:去掉副标题 / 工期 / 同款定制,只留形态 + 名称 + 价格。
   *  给「左大右二」里右侧的小卡用 —— 那两张卡只有 1/4 屏宽,堆满信息会挤爆。 */
  dense?: boolean;
}) {
  const isZh = locale === "zh";
  const title = isZh ? product.title : product.titleEn;
  // 「同款定制」直接开 CustomWorkshop(带当前商品),不跳 /image-gen
  const setCustomize = useStorefrontModal((s) => s.setCustomize);
  // 2026-11-02:生图要登录,未登录点了「同款定制」先去登录页
  const requireSignIn = useRequireSignIn();
  // 成品图是主图,原图 hover 才露出 —— 跟 atelier 的 before/after 叙事一致
  const beforeImage =
    product.originalPhoto || product.images[0] || product.thumbnail;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.24) }}
      className={`group flex flex-col ${aspect === "fill" ? "h-full" : ""}`}
    >
      <Link
        href={`/product/${product.handle}`}
        className={`relative ${ASPECT_CLASS[aspect]} bg-muted overflow-hidden rounded-lg block ${
          aspect === "fill" ? "flex-1 min-h-[280px]" : ""
        }`}
        style={wash ? { backgroundColor: wash } : undefined}
        aria-label={title}
      >
        {/* 成品(默认) */}
        <img
          src={product.thumbnail}
          alt={`${title} — ${isZh ? "成品" : "finished"}`}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          loading={priority ? "eager" : "lazy"}
        />
        {/* 原图(hover 露出) */}
        <img
          src={beforeImage}
          alt={`${title} — ${isZh ? "原图" : "original"}`}
          className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          loading="lazy"
        />

        {/* Badge —— Limited / New / Best Seller */}
        {product.badge ? (
          <span className="absolute top-3 left-3 inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] rounded bg-background/85 backdrop-blur text-foreground/80">
            {product.badge}
          </span>
        ) : null}

        {/* 原图/成品指示 —— hover 才出现 */}
        <span className="absolute top-3 right-3 inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] rounded bg-background/85 backdrop-blur text-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="group-hover:hidden">
            {isZh ? "成品" : "Finished"}
          </span>
          <span className="hidden group-hover:inline">
            {isZh ? "原图" : "Original"}
          </span>
        </span>
      </Link>

      {/* Info */}
      <div className="pt-3 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            className="size-1.5 rounded-full shrink-0"
            style={{ backgroundColor: product.accent }}
          />
          <span className="text-[11px] text-muted-foreground truncate">
            {isZh ? product.seriesName : product.seriesNameEn}
          </span>
        </div>
        <Link
          href={`/product/${product.handle}`}
          className="text-sm font-medium hover:text-[var(--accent)] transition-colors line-clamp-2 text-pretty"
        >
          {title}
        </Link>
        {dense ? null : (
          <p className="text-xs text-muted-foreground line-clamp-1">
            {isZh ? product.subtitle : product.subtitleEn}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-0.5">
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">
              {formatPriceCNY(
                product.basePriceCents / 100,
                isZh ? "zh-CN" : "en"
              )}
            </span>
            <span className="ml-1.5 text-xs">{isZh ? "起" : "from"}</span>
          </p>
          {dense ? null : (
            <p className="text-[11px] text-muted-foreground">
              {isZh
                ? `${product.leadTimeDays} 天工期`
                : `${product.leadTimeDays}d lead`}
            </p>
          )}
        </div>

        {/* 同款定制 —— 独立按钮,不叠在图片链接上(旧版是嵌套 <Link>)
            2026-10-22:从链 `/image-gen` 改成直接开 CustomWorkshop。卡片本身就
            带着商品,商品作用域天然成立,不用先过品类选择层。`/image-gen` 是登录后
            的 SaaS 工作台,游客点它会被 proxy 弹去登录页。
            2026-11-02:生图要登录 —— 未登录点击先去 /sign-in,登录后回本页。 */}
        {dense ? null : (
          <button
            type="button"
            onClick={() => requireSignIn(() => setCustomize(product))}
            className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)] hover:text-[var(--accent)] transition-colors"
          >
            <Wand2 className="size-3.5" />
            {isZh ? "同款定制" : "Make your own"}
          </button>
        )}
      </div>
    </motion.article>
  );
}
