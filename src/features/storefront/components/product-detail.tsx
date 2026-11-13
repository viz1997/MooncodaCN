/**
 * ProductDetail —— 1:1 移植自 atelier `product-detail.tsx`
 *
 * 适配差异:
 *  - useCartStore → useStorefrontModal(useStorefrontModal.setCustomize 触发 CustomWorkshop)
 *  - useFormatPrice → formatCents
 *  - next/link Link → @/i18n/routing Link
 *  - 客户端取数改走 useProduct(handle)(TanStack Query → /api/store/products/[handle])
 *  - 文案中文化(¥ / 天 / 工艺文案)
 *  - related 卡片 inline 渲染(无独立 ProductCard,避免跨模块耦合)
 *
 * Customize CTA 行为:setCustomize(product) + router.push("/"),让根 layout 挂载的
 * <CustomWorkshop /> 自动弹出。完全对齐 atelier 行为。
 *
 * 2026-10-21 换肤(参考 The Foggy Dog):
 *  - 主图落在该商品所属场合的柔和色带上(washForHandle),不匹配则 bone 暖纸底
 *  - 新增「也适合这些场合」chips —— 场合为主的信息架构在详情页的落点,
 *    点 chip 回首页对应色带
 *  - 价格走玫瑰 --accent,主 CTA 走墨绿 --primary,标题字重降到 medium
 *    (衬线大字在 600 以上显笨)
 */

"use client";

import { motion } from "framer-motion";
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  occasionsForHandle,
  washForHandle,
} from "@/features/marketing/components/storefront/occasion-data";
import { Link, useRouter } from "@/i18n/routing";
import { formatCents } from "@/lib/money";

import { useProduct } from "../hooks/use-products";
import { useRequireSignIn } from "../hooks/use-require-sign-in";
import { useStorefrontModal } from "../hooks/use-storefront-modal";
import { formatSizeCompact } from "../lib/size-format";
import type { StorefrontProduct } from "../types";

const perks = [
  { icon: Truck, label: "¥99 以上免运费" },
  { icon: RotateCcw, label: "工艺问题免费重做" },
  { icon: ShieldCheck, label: "工作室手工精修" },
];

export function ProductDetail({ handle }: { handle: string }) {
  const router = useRouter();
  const setCustomize = useStorefrontModal((s) => s.setCustomize);
  const setQuickView = useStorefrontModal((s) => s.setQuickView);
  // 2026-11-02:生图要登录 —— 未登录点「定制」先去登录页
  const requireSignIn = useRequireSignIn();
  const query = useProduct(handle);

  const product = query.data?.product ?? null;
  const related = query.data?.related ?? [];

  // 场合色带 —— 主图底色 + 「也适合这些场合」chips 都从这里取。
  // 用 handle 而不是 product.handle:查询还没回来时也能出占位底色。
  const occasions = React.useMemo(() => occasionsForHandle(handle), [handle]);

  const [activeImage, setActiveImage] = React.useState(0);

  // Reset active image when handle changes
  React.useEffect(() => {
    setActiveImage(0);
  }, [handle]);

  // Build gallery: finished → original → extras (must be above early returns)
  const gallery = React.useMemo(() => {
    if (!product) return [] as string[];
    const imgs = [
      product.finishedPhoto,
      product.originalPhoto,
      ...product.images,
    ];
    return Array.from(new Set(imgs));
  }, [product]);

  const handleCustomize = () => {
    if (!product) return;
    // 2026-11-02:生图要登录 —— 未登录先去 /sign-in,登录后回本页再点一次
    requireSignIn(() => {
      setCustomize(product);
      // 跳回根 / 让 layout 挂载的 <CustomWorkshop /> 自动弹出
      router.push("/");
    });
  };

  const handleRelatedQuickView = (p: StorefrontProduct) => {
    setQuickView(p);
  };

  if (query.isLoading) {
    return (
      <div className="atelier-container py-10">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
          <div className="aspect-square bg-muted rounded-lg animate-pulse" />
          <div className="space-y-4">
            <div className="h-4 w-24 bg-muted rounded animate-pulse" />
            <div className="h-10 w-3/4 bg-muted rounded animate-pulse" />
            <div className="h-6 w-1/2 bg-muted rounded animate-pulse" />
            <div className="h-40 w-full bg-muted rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (query.isError || !product) {
    return (
      <div className="atelier-container py-20 text-center">
        <h1 className="font-serif text-3xl mb-3">找不到这件作品</h1>
        <p className="text-sm text-muted-foreground mb-6">
          产品 {handle} 不存在或已下架。
        </p>
        <Button asChild>
          <Link href="/">返回首页</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-background">
      <div className="atelier-container py-6 lg:py-10">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-muted-foreground mb-6">
          <Link href="/" className="hover:text-foreground transition-colors">
            首页
          </Link>
          <span>/</span>
          <span className="hover:text-foreground transition-colors capitalize">
            {product.seriesName}
          </span>
          <span>/</span>
          <span className="text-foreground truncate">{product.title}</span>
        </nav>

        {/* Main grid: gallery + info */}
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Gallery */}
          <div className="flex flex-col-reverse sm:flex-row gap-3">
            {/* Thumbnails */}
            <div className="flex sm:flex-col gap-2 sm:w-20 overflow-x-auto sm:overflow-x-visible">
              {gallery.map((img, i) => {
                const isActive = activeImage === i;
                const isBefore = i === 1;
                return (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: gallery 顺序固定
                    key={`${img}-${i}`}
                    type="button"
                    onClick={() => {
                      setActiveImage(i);
                    }}
                    className={`relative size-16 sm:size-20 shrink-0 overflow-hidden rounded-md border-2 transition-colors ${
                      isActive
                        ? "border-[var(--primary)]"
                        : "border-transparent opacity-70 hover:opacity-100"
                    }`}
                  >
                    <img
                      src={img}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {isBefore && (
                      <span className="absolute bottom-0.5 left-0.5 px-1 py-0 text-[8px] font-medium uppercase rounded bg-background/85">
                        Before
                      </span>
                    )}
                    {i === 0 && (
                      <span className="absolute bottom-0.5 left-0.5 px-1 py-0 text-[8px] font-medium uppercase rounded bg-background/85">
                        After
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Main image —— 落在该商品所属场合的色带上(Foggy Dog 商品页的标志布局) */}
            <div
              className="relative flex-1 aspect-square overflow-hidden rounded-lg p-3 sm:p-5"
              style={{ backgroundColor: washForHandle(handle) }}
            >
              <motion.img
                key={activeImage}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                src={gallery[activeImage]}
                alt={`${product.title} — 第 ${activeImage + 1} 张`}
                className="w-full h-full object-cover rounded-md"
              />
              {/* Navigation arrows */}
              <button
                type="button"
                onClick={() => {
                  const next =
                    (activeImage - 1 + gallery.length) % gallery.length;
                  setActiveImage(next);
                }}
                className="absolute left-3 top-1/2 -translate-y-1/2 size-9 rounded-full bg-background/85 backdrop-blur flex items-center justify-center hover:bg-background transition-colors"
                aria-label="上一张"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = (activeImage + 1) % gallery.length;
                  setActiveImage(next);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 size-9 rounded-full bg-background/85 backdrop-blur flex items-center justify-center hover:bg-background transition-colors"
                aria-label="下一张"
              >
                <ChevronRight className="size-4" />
              </button>
              {/* Image counter */}
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 px-2.5 py-1 text-[11px] font-medium rounded-full bg-background/85 backdrop-blur">
                {activeImage + 1} / {gallery.length}
              </span>
              {product.badge && (
                <span className="absolute top-3 left-3 inline-flex items-center px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] rounded-sm bg-foreground text-background">
                  {product.badge}
                </span>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="flex flex-col">
            <p className="eyebrow mb-2" style={{ color: product.accent }}>
              {product.seriesName}
            </p>
            <h1 className="font-serif text-3xl sm:text-4xl font-medium tracking-tight text-balance">
              {product.title}
            </h1>
            <p className="text-sm text-muted-foreground mt-2 text-pretty">
              {product.subtitle}
            </p>

            {/* 「也适合这些场合」—— 场合为主的信息架构在详情页的落点,
                点 chip 回首页对应色带。这是新品唯一的反向曝光入口。 */}
            {occasions.length > 0 ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  也适合这些场合:
                </span>
                {occasions.map((o) => (
                  <Link
                    key={o.id}
                    href={`/#${o.id}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border border-border/70 hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: o.wash }}
                    />
                    {o.label}
                  </Link>
                ))}
              </div>
            ) : null}

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
              <span className="font-serif text-3xl text-[var(--accent)]">
                {formatCents(product.basePriceCents)}
              </span>
              <span className="text-xs text-muted-foreground uppercase tracking-[0.12em]">
                起
              </span>
            </div>

            {/* Custom options summary */}
            <div className="mt-6 p-4 bg-secondary/60 rounded-lg border border-border/60">
              <div className="flex items-center gap-2 mb-3">
                <Wand2 className="size-4 text-[var(--accent)]" />
                <p className="eyebrow">自定义能力</p>
              </div>
              <ul className="space-y-2 text-sm text-pretty">
                <li className="flex items-start gap-2">
                  <span className="size-1 rounded-full bg-accent mt-1.5 shrink-0" />
                  <span>
                    <span className="font-medium">
                      {product.aiStyles.length} 种 AI 风格
                    </span>{" "}
                    — {product.aiStyles.map((s) => s.name).join(" / ")}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="size-1 rounded-full bg-accent mt-1.5 shrink-0" />
                  <span>
                    <span className="font-medium">
                      {product.materials.length} 种材质
                    </span>{" "}
                    — {product.materials.map((m) => m.name).join(" / ")}
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="size-1 rounded-full bg-accent mt-1.5 shrink-0" />
                  <span>
                    <span className="font-medium">
                      {product.sizes.length} 种尺寸
                    </span>{" "}
                    —{" "}
                    {product.sizes
                      .map((s) => formatSizeCompact(s.cm))
                      .join(" / ")}
                  </span>
                </li>
                {/* 刻字按型号能力开合 —— 手办 / 冰箱贴是 3D 造型件,不做表面刻字 */}
                {product.canEngrave && (
                  <li className="flex items-start gap-2">
                    <span className="size-1 rounded-full bg-accent mt-1.5 shrink-0" />
                    <span>可选背面刻字(+¥3)</span>
                  </li>
                )}
              </ul>
            </div>

            {/* Lead time */}
            <div className="flex items-center gap-2 mt-4 text-sm">
              <Clock className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">制作周期:</span>
              <span className="font-medium">{product.leadTimeDays} 天</span>
            </div>

            <Separator className="my-5" />

            {/* CTA */}
            <Button
              onClick={handleCustomize}
              size="lg"
              className="w-full h-12 rounded-md text-sm font-medium bg-[var(--primary)] text-[var(--primary-foreground)] hover:bg-[var(--primary)]/90 group"
              type="button"
            >
              <Wand2 className="size-4 mr-2" />
              定制此作品
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
                  className="text-[11px] uppercase tracking-[0.14em] data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none border-b-2 border-transparent data-[state=active]:border-foreground px-0 pb-2"
                >
                  描述
                </TabsTrigger>
                <TabsTrigger
                  value="details"
                  className="text-[11px] uppercase tracking-[0.14em] data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none border-b-2 border-transparent data-[state=active]:border-foreground px-0 pb-2"
                >
                  详情
                </TabsTrigger>
                <TabsTrigger
                  value="shipping"
                  className="text-[11px] uppercase tracking-[0.14em] data-[state=active]:bg-transparent data-[state=active]:shadow-none rounded-none border-b-2 border-transparent data-[state=active]:border-foreground px-0 pb-2"
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
                    起售价:{formatCents(product.basePriceCents)}
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
                <h2 className="font-serif text-xl sm:text-2xl tracking-tight">
                  你可能也喜欢
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  更多 {product.seriesName}
                </p>
              </div>
              <Link
                href="/"
                className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-foreground/70 hover:text-foreground transition-colors"
              >
                查看全部
                <ArrowRight className="size-4" />
              </Link>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-8 sm:gap-x-6 lg:gap-x-8">
              {related.slice(0, 4).map((p) => (
                <RelatedCard
                  key={p.id}
                  product={p}
                  onQuickView={() => handleRelatedQuickView(p)}
                />
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
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * RelatedCard —— 内联简化版卡片(避免新增 ProductCard 跨模块耦合)
 * 点击:push /product/[handle](SPA 跳详情)
 */
function RelatedCard({
  product,
  onQuickView,
}: {
  product: StorefrontProduct;
  onQuickView: () => void;
}) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4 }}
      className="group flex flex-col"
    >
      <Link
        href={`/product/${product.handle}`}
        className="relative aspect-square bg-muted overflow-hidden rounded-lg block"
        aria-label={product.title}
      >
        <img
          src={product.thumbnail}
          alt={product.title}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
          loading="lazy"
        />
        {product.badge && (
          <span className="absolute top-3 left-3 inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] rounded bg-background/85 backdrop-blur text-foreground/80">
            {product.badge}
          </span>
        )}
      </Link>
      <div className="pt-3 flex flex-col gap-1">
        <Link
          href={`/product/${product.handle}`}
          className="text-sm font-medium hover:text-[var(--accent)] transition-colors line-clamp-2 text-pretty"
        >
          {product.title}
        </Link>
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">
              {formatCents(product.basePriceCents)}
            </span>
            <span className="ml-1.5 text-xs">起</span>
          </p>
          {/* 快速预览 —— 独立按钮,不叠在上面的 <Link> 里(旧版是按钮套链接,
              靠 e.preventDefault() 兜底,在某些浏览器里点击会同时触发跳转) */}
          <button
            type="button"
            onClick={onQuickView}
            className="text-[11px] font-medium text-[var(--primary)] hover:text-[var(--accent)] transition-colors"
          >
            快速预览
          </button>
        </div>
      </div>
    </motion.article>
  );
}
