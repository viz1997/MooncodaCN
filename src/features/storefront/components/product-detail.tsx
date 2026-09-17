/**
 * ProductDetail —— 1:1 移植自 atelier product-detail.tsx
 *
 * 视觉保留:
 *  - Breadcrumb (Home / Series / Title)
 *  - 大图 + 缩略图导航 + 前后翻页按钮 + 计数
 *  - 右侧信息:系列标签 + 标题 + 副标题 + 评分 + 基础价
 *  - "Customization included" 卡片
 *  - Lead time + Perks + Tabs(描述/详情/配送)
 *  - 主 CTA "Customize this product" → 跳回 / 打开 CustomWorkshop
 *  - Related products(同系列其他作品)
 *
 * 适配差异:
 *  - useCartStore.setCustomize → useStorefrontModal.setCustomize
 *  - useFormatPrice → formatPriceCNY
 *  - next/link Link → @/i18n/routing Link
 *  - framer-motion → 静态 img(同 key 重渲 = 浏览器自身过渡)
 *  - product.series → product.seriesName(我们的类型用 seriesId/seriesName)
 *  - product.basePrice (元) → product.basePriceCents (分)
 *  - product.reviewCount → product.ratingCount
 *  - 相关产品卡片内联(StorefrontProduct 不同于现有 Product 类型,不复用 ProductCard)
 *  - 文案中文化
 */

"use client";

import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  RotateCcw,
  ShieldCheck,
  Star,
  Truck,
  Wand2,
} from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPriceCNY } from "@/features/marketing/components/storefront/wjp-store-data";
import { useToast } from "@/hooks/use-toast";
import { Link } from "@/i18n/routing";

import { useStorefrontModal } from "../hooks/use-storefront-modal";
import type { StorefrontProduct } from "../types";

const perks = [
  { icon: Truck, label: "¥99 以上免运费" },
  { icon: RotateCcw, label: "工艺问题免费重做" },
  { icon: ShieldCheck, label: "工作室手工精修" },
];

interface ProductDetailProps {
  product: StorefrontProduct;
  related: StorefrontProduct[];
}

export function ProductDetail({ product, related }: ProductDetailProps) {
  const { toast } = useToast();
  const setCustomize = useStorefrontModal((s) => s.setCustomize);

  const [activeImage, setActiveImage] = React.useState(0);

  // gallery:成图 → 原图 → 其他图
  const gallery = React.useMemo(() => {
    const imgs = [
      product.finishedPhoto,
      product.originalPhoto,
      ...product.images,
    ];
    return Array.from(new Set(imgs));
  }, [product]);

  const handleCustomize = () => {
    setCustomize(product);
    toast({
      title: "已为你打开定制工作台",
      description: "在弹窗里上传照片、选风格、选规格,加入购物袋。",
    });
  };

  return (
    <div className="bg-background">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 py-6 lg:py-10">
        {/* Breadcrumb */}
        <nav
          className="flex items-center gap-2 text-xs text-muted-foreground mb-6"
          aria-label="面包屑"
        >
          <Link href="/" className="hover:text-foreground transition-colors">
            首页
          </Link>
          <span>/</span>
          <span className="text-foreground/80">{product.seriesName}</span>
          <span>/</span>
          <span className="text-foreground truncate">{product.title}</span>
        </nav>

        {/* Main grid */}
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Gallery */}
          <div className="flex flex-col-reverse sm:flex-row gap-3">
            {/* 缩略图 */}
            <div className="flex sm:flex-col gap-2 sm:w-20 overflow-x-auto sm:overflow-x-visible">
              {gallery.map((img, i) => {
                const isActive = activeImage === i;
                const isBefore = i === 1;
                const isAfter = i === 0;
                return (
                  <button
                    key={img}
                    type="button"
                    onClick={() => setActiveImage(i)}
                    className={`relative size-16 sm:size-20 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                      isActive
                        ? "border-foreground"
                        : "border-transparent opacity-70 hover:opacity-100"
                    }`}
                  >
                    <img
                      src={img}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    {(isBefore || isAfter) && (
                      <span className="absolute bottom-0.5 left-0.5 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] rounded bg-background/90 backdrop-blur">
                        {isAfter ? "After" : "Before"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Main image */}
            <div className="relative flex-1 aspect-square overflow-hidden rounded-lg bg-muted">
              <img
                key={gallery[activeImage]}
                src={gallery[activeImage]}
                alt={`${product.title} — 第 ${activeImage + 1} 张`}
                className="w-full h-full object-cover transition-opacity duration-300"
              />
              {gallery.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveImage(
                        (i) => (i - 1 + gallery.length) % gallery.length
                      )
                    }
                    className="absolute left-3 top-1/2 -translate-y-1/2 size-9 rounded-full bg-background/85 backdrop-blur flex items-center justify-center hover:bg-background transition-colors"
                    aria-label="上一张"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setActiveImage((i) => (i + 1) % gallery.length)
                    }
                    className="absolute right-3 top-1/2 -translate-y-1/2 size-9 rounded-full bg-background/85 backdrop-blur flex items-center justify-center hover:bg-background transition-colors"
                    aria-label="下一张"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                  <span className="absolute bottom-3 left-1/2 -translate-x-1/2 px-2.5 py-1 text-[11px] font-medium rounded-full bg-background/85 backdrop-blur">
                    {activeImage + 1} / {gallery.length}
                  </span>
                </>
              )}
              {product.badge && (
                <span className="absolute top-3 left-3 inline-flex items-center px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] rounded bg-foreground text-background">
                  {product.badge}
                </span>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="flex flex-col">
            <p
              className="text-xs uppercase tracking-[0.18em] font-medium mb-2"
              style={{ color: product.accent }}
            >
              {product.seriesName}
            </p>
            <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">
              {product.title}
            </h1>
            <p className="text-sm text-muted-foreground mt-2 text-pretty">
              {product.subtitle}
            </p>

            <div className="flex items-center gap-3 mt-3">
              <div className="flex items-center gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    // biome-ignore lint/suspicious/noArrayIndexKey: 固定 5 颗星
                    key={i}
                    className={`size-4 ${
                      i < Math.floor(product.rating)
                        ? "fill-foreground text-foreground"
                        : "text-border"
                    }`}
                  />
                ))}
              </div>
              <span className="text-sm text-muted-foreground">
                {product.rating.toFixed(1)} ·{" "}
                {product.ratingCount.toLocaleString()} 条评价
              </span>
            </div>

            <div className="flex items-baseline gap-2 mt-5">
              <span className="text-3xl font-semibold">
                {formatPriceCNY(product.basePriceCents / 100)}
              </span>
              <span className="text-xs text-muted-foreground uppercase tracking-[0.12em]">
                起
              </span>
            </div>

            {/* Custom options summary */}
            <div className="mt-6 p-4 bg-muted/50 rounded-md border border-border/60">
              <div className="flex items-center gap-2 mb-3">
                <Wand2 className="size-4 text-accent" />
                <p className="text-xs uppercase tracking-[0.16em] font-medium">
                  自定义能力
                </p>
              </div>
              <ul className="space-y-2 text-sm text-pretty">
                <li className="flex items-start gap-2">
                  <span className="size-1 rounded-full bg-accent mt-1.5 shrink-0" />
                  <span>
                    <span className="font-medium">5 种 AI 风格</span> — 原图 / Q
                    版 / 日漫 / 水彩 / 线稿
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="size-1 rounded-full bg-accent mt-1.5 shrink-0" />
                  <span>
                    <span className="font-medium">
                      {product.materials.length} 种材质
                    </span>{" "}
                    — {product.materials.map((m) => m.name).join("、")}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="size-1 rounded-full bg-accent mt-1.5 shrink-0" />
                  <span>
                    <span className="font-medium">
                      {product.sizes.length} 种尺寸
                    </span>{" "}
                    — {product.sizes.map((s) => `${s.cm}cm`).join("、")}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="size-1 rounded-full bg-accent mt-1.5 shrink-0" />
                  <span>可选背面刻字(+{formatPriceCNY(3)})</span>
                </li>
              </ul>
            </div>

            {/* Lead time */}
            <div className="flex items-center gap-2 mt-4 text-sm">
              <Clock className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">制作周期:</span>
              <span className="font-medium">{product.leadTimeDays} 天</span>
            </div>

            <div className="border-t my-5" />

            {/* CTA */}
            <Button
              onClick={handleCustomize}
              size="lg"
              className="w-full h-12 rounded-md text-sm font-medium group"
              type="button"
            >
              <Wand2 className="size-4 mr-2" />
              开始定制此产品
              <ArrowRight className="size-4 ml-2 transition-transform group-hover:translate-x-0.5" />
            </Button>

            {/* Perks */}
            <ul className="mt-6 space-y-2.5">
              {perks.map((p) => (
                <li
                  key={p.label}
                  className="flex items-center gap-2.5 text-sm text-muted-foreground"
                >
                  <p.icon className="size-4 text-foreground/70 shrink-0" />
                  <span>{p.label}</span>
                </li>
              ))}
            </ul>

            {/* Tabs */}
            <Tabs defaultValue="description" className="mt-8">
              <TabsList className="w-full justify-start h-auto p-0 bg-transparent gap-5">
                <TabsTrigger
                  value="description"
                  className="text-xs uppercase tracking-[0.14em] data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none border-b-2 border-transparent data-[state=active]:border-foreground px-0 pb-2"
                >
                  描述
                </TabsTrigger>
                <TabsTrigger
                  value="details"
                  className="text-xs uppercase tracking-[0.14em] data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none border-b-2 border-transparent data-[state=active]:border-foreground px-0 pb-2"
                >
                  详情
                </TabsTrigger>
                <TabsTrigger
                  value="shipping"
                  className="text-xs uppercase tracking-[0.14em] data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none border-b-2 border-transparent data-[state=active]:border-foreground px-0 pb-2"
                >
                  配送
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="description"
                className="text-sm leading-relaxed text-muted-foreground mt-4 text-pretty"
              >
                {product.description}
              </TabsContent>
              <TabsContent
                value="details"
                className="text-sm leading-relaxed text-muted-foreground mt-4"
              >
                <ul className="space-y-1.5">
                  {product.tags.map((t) => (
                    <li key={t} className="flex items-center gap-2">
                      <span className="size-1 rounded-full bg-accent" />
                      {t}
                    </li>
                  ))}
                  <li className="flex items-center gap-2">
                    <span className="size-1 rounded-full bg-accent" />
                    类型:{product.typeLabel}
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="size-1 rounded-full bg-accent" />
                    起售价:{formatPriceCNY(product.basePriceCents / 100)}
                  </li>
                </ul>
              </TabsContent>
              <TabsContent
                value="shipping"
                className="text-sm leading-relaxed text-muted-foreground mt-4 text-pretty"
              >
                工作室手工精修,{product.leadTimeDays} 天内发货。¥99 以上免运费。
                定制商品不支持退货,但工艺问题免费重做。
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Related products */}
        {related.length > 0 && (
          <section className="mt-16 lg:mt-24 pt-12 border-t">
            <div className="flex items-end justify-between mb-6">
              <div>
                <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">
                  你可能也喜欢
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  更多 {product.seriesName} 作品
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6 lg:gap-x-8">
              {related.slice(0, 4).map((p) => (
                <Link
                  key={p.id}
                  href={`/products/${p.handle}`}
                  className="group flex flex-col"
                >
                  <div className="relative aspect-square bg-muted overflow-hidden rounded-md">
                    <img
                      src={p.thumbnail}
                      alt={p.title}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      loading="lazy"
                    />
                    {p.badge && (
                      <span className="absolute top-3 left-3 inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] rounded bg-foreground text-background">
                        {p.badge}
                      </span>
                    )}
                  </div>
                  <div className="pt-3 flex flex-col gap-0.5">
                    <p className="text-sm font-medium group-hover:text-accent transition-colors line-clamp-2 text-pretty">
                      {p.title}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      <span className="text-foreground font-medium">
                        {formatPriceCNY(p.basePriceCents / 100)}
                      </span>
                      <span className="ml-1.5 text-xs">起</span>
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Back to home */}
        <div className="mt-12 lg:mt-16 pt-8 border-t">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
            返回所有作品
          </Link>
        </div>
      </div>
    </div>
  );
}
