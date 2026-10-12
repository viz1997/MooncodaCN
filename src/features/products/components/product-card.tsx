import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";

import type { Product } from "../lib/data";
import { PRODUCT_CATEGORY_LABELS } from "../lib/data";

interface ProductCardProps {
  product: Product;
  locale: "en" | "zh";
  /** 推荐徽标 */
  featured?: boolean | undefined;
}

/**
 * 作品集卡片 —— 列表用
 *
 * - 缩略图占位用产品 slug 的封面（当前用 .svg 占位，未上传实际图片）
 * - 中文 locale 显示 ¥，英文显示价格附带 "from"
 */
export function ProductCard({ product, locale, featured }: ProductCardProps) {
  const t = product.translations[locale];
  const categoryLabel = PRODUCT_CATEGORY_LABELS[product.category][locale];
  const priceDisplay =
    locale === "zh"
      ? `¥${product.basePriceCNY}`
      : `from $${Math.round(product.basePriceCNY / 7)}`;

  return (
    <Link
      href={`/products/${product.slug}` as `/products/${string}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border bg-card transition-colors",
        "hover:border-foreground/30 hover:bg-muted/40"
      )}
    >
      {/* 封面占位 */}
      <div className="relative aspect-[4/3] overflow-hidden bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900">
        {/* 真实图到位后改用 next/image：
            <Image src={product.cover} alt={t.name} fill className="object-cover" />
        */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-xs uppercase tracking-widest text-zinc-400">
            {product.dimensions.width}×{product.dimensions.depth}×
            {product.dimensions.height}mm
          </span>
        </div>
        {featured && (
          <span className="absolute top-3 left-3 rounded-full bg-foreground/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-background">
            {locale === "zh" ? "推荐" : "Featured"}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{categoryLabel}</span>
          <span className="font-mono tabular-nums">{priceDisplay}</span>
        </div>
        <h3 className="text-balance font-semibold tracking-tight">{t.name}</h3>
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {t.tagline}
        </p>
      </div>
    </Link>
  );
}
