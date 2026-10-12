"use client";

import { motion } from "framer-motion";
import { Wand2 } from "lucide-react";
import type { Product } from "@/features/products/lib/data";
import { Link } from "@/i18n/routing";
import { formatPriceCNY } from "./wjp-store-data";

const PRODUCT_CATEGORY_LABELS: Record<Product["category"], string> = {
  badge: "徽章",
  keychain: "钥匙扣",
  "fridge-magnet": "冰箱贴",
  figure: "Q版手办",
  standee: "立牌",
  gift: "礼品套装",
};

/**
 * WJP 作品集 ProductCard —— 1:1 移植自 atelier `product-card.tsx`。
 *
 * 适配差异:
 *  - product type 从 atelier Product 切换到 NextDevTpl `Product` (已有 schema)
 *  - 移除 atelier 的 useCartStore / useFormatPrice,改用 /image-gen 深链 + formatPriceCNY
 *  - 去掉 "Customize" 按钮(无 cart store),保留 hover 时原图/成品翻转 + before/after 标签
 *  - leadTimeDays 字段在现有 Product 类型不存在,改为按 category 给出经验值
 */
function leadTimeForCategory(category: Product["category"]): number {
  switch (category) {
    case "badge":
    case "keychain":
    case "fridge-magnet":
      return 14;
    case "figure":
    case "standee":
      return 21;
    case "gift":
      return 28;
  }
}

export function ProductCard({
  product,
  index = 0,
  locale,
}: {
  product: Product;
  index?: number;
  locale: "zh" | "en";
}) {
  const translation = product.translations[locale];
  const beforeImage = product.gallery[0] ?? product.cover;
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.24) }}
      className="group flex flex-col"
    >
      <Link
        href={`/marketing/products/${product.slug}`}
        className="relative aspect-square bg-muted overflow-hidden rounded-md block"
        aria-label={translation.name}
      >
        {/* After image (default) */}
        <img
          src={product.cover}
          alt={`${translation.name} — 成品`}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          loading="lazy"
        />
        {/* Before image (revealed on hover) */}
        <img
          src={beforeImage}
          alt={`${translation.name} — 原图`}
          className="absolute inset-0 w-full h-full object-cover opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          loading="lazy"
        />

        {/* Before/After indicator — subtle, top right */}
        <span className="absolute top-3 right-3 inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] rounded bg-background/85 backdrop-blur text-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="group-hover:hidden">成品</span>
          <span className="hidden group-hover:inline">原图</span>
        </span>

        {/* Category badge */}
        <span className="absolute top-3 left-3 inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] rounded bg-foreground text-background">
          {PRODUCT_CATEGORY_LABELS[product.category]}
        </span>

        {/* Hover CTA — link to /image-gen with this product line */}
        <div className="absolute inset-x-2 bottom-2 translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
          <Link
            href="/image-gen"
            className="w-full bg-background/95 backdrop-blur text-foreground py-2.5 text-xs font-medium rounded-md hover:bg-background transition-colors flex items-center justify-center gap-1.5"
          >
            <Wand2 className="size-3.5" />
            同款定制
          </Link>
        </div>
      </Link>

      {/* Info */}
      <div className="pt-3 flex flex-col gap-0.5">
        <Link
          href={`/marketing/products/${product.slug}`}
          className="text-sm font-medium hover:text-accent transition-colors line-clamp-2 text-pretty"
        >
          {translation.name}
        </Link>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">
              {formatPriceCNY(product.basePriceCNY)}
            </span>
            <span className="ml-1.5 text-xs">起</span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            {leadTimeForCategory(product.category)} 天工期
          </p>
        </div>
      </div>
    </motion.article>
  );
}
