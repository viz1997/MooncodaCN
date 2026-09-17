/**
 * ProductQuickView —— 1:1 移植自 atelier product-quick-view.tsx
 *
 * 视觉保留:
 *  - 全屏 overlay + centered modal(左图右详情)
 *  - Before/After 图切换
 *  - 缩略图列表
 *  - 系列标签 + 标题 + 副标题 + 评分 + 基础价
 *  - "Customization included" 卡片(5 AI 风格 / 材质 / 尺寸 / 刻字)
 *  - Lead time 显示
 *  - "Customize this product" 主按钮 + "View full details" 链接
 *  - Perks 三件套(免运费 / 重新制作 / 手工精修)
 *  - Description / Details / Shipping tabs
 *
 * 适配差异:
 *  - useCartStore → useStorefrontModal
 *  - useFormatPrice → formatPriceCNY
 *  - next/link Link → @/i18n/routing Link
 *  - 文案中文化(¥ / 天 / 工艺文案)
 *  - 用 shadcn Dialog 而非 raw framer-motion(更好的 a11y)
 */

"use client";

import {
  ArrowRight,
  Clock,
  RotateCcw,
  ShieldCheck,
  Star,
  Truck,
  Wand2,
  X,
} from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPriceCNY } from "@/features/marketing/components/storefront/wjp-store-data";
import { Link } from "@/i18n/routing";

import { useStorefrontModal } from "../hooks/use-storefront-modal";

const perks = [
  { icon: Truck, label: "¥99 以上免运费" },
  { icon: RotateCcw, label: "工艺问题免费重做" },
  { icon: ShieldCheck, label: "工作室手工精修" },
];

export function ProductQuickView() {
  const product = useStorefrontModal((s) => s.quickViewProduct);
  const setQuickView = useStorefrontModal((s) => s.setQuickView);
  const setCustomize = useStorefrontModal((s) => s.setCustomize);

  const [activeImage, setActiveImage] = React.useState(0);
  const [showingBefore, setShowingBefore] = React.useState(false);

  React.useEffect(() => {
    if (product) {
      setActiveImage(0);
      setShowingBefore(false);
    }
  }, [product]);

  const startCustomize = () => {
    if (!product) return;
    setQuickView(null);
    setCustomize(product);
  };

  return (
    <Dialog
      open={Boolean(product)}
      onOpenChange={(open) => !open && setQuickView(null)}
    >
      <DialogContent className="w-full sm:max-w-5xl max-h-[92vh] sm:max-h-[88vh] p-0 overflow-hidden flex flex-col">
        {product && (
          <>
            <DialogTitle className="sr-only">
              {product.title} 快速预览
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setQuickView(null)}
              aria-label="关闭预览"
              className="absolute top-3 right-3 z-10 size-9 rounded-full bg-background/90 backdrop-blur hover:bg-background shadow-sm"
              type="button"
            >
              <X className="size-5" />
            </Button>

            <div className="grid lg:grid-cols-2 overflow-y-auto flex-1">
              {/* Left: Before/After image */}
              <div className="bg-muted">
                <div className="relative aspect-[4/5] lg:aspect-auto lg:h-full lg:min-h-[560px]">
                  <img
                    src={
                      showingBefore
                        ? product.originalPhoto
                        : product.finishedPhoto
                    }
                    alt={`${product.title} — ${showingBefore ? "原图" : "成图"}`}
                    className="w-full h-full object-cover transition-opacity"
                  />
                  {/* Before/After toggle */}
                  <div className="absolute bottom-4 left-4 right-4 flex items-center gap-1 bg-background/95 backdrop-blur rounded-full p-1">
                    <button
                      type="button"
                      onClick={() => setShowingBefore(false)}
                      className={`flex-1 py-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.14em] rounded-full transition-colors ${
                        !showingBefore
                          ? "bg-foreground text-background"
                          : "text-foreground/70"
                      }`}
                    >
                      After
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowingBefore(true)}
                      className={`flex-1 py-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.14em] rounded-full transition-colors ${
                        showingBefore
                          ? "bg-foreground text-background"
                          : "text-foreground/70"
                      }`}
                    >
                      Before
                    </button>
                  </div>
                  {product.badge && (
                    <span className="absolute top-4 left-4 inline-flex items-center px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] rounded-sm bg-foreground text-background">
                      {product.badge}
                    </span>
                  )}
                </div>
                {product.images.length > 1 && (
                  <div className="flex gap-2 p-3 bg-muted border-t border-border/60">
                    {product.images.map((img, i) => (
                      <button
                        key={img}
                        type="button"
                        onClick={() => setActiveImage(i)}
                        className={`size-16 overflow-hidden rounded-sm border-2 transition-colors ${
                          activeImage === i
                            ? "border-foreground"
                            : "border-transparent opacity-70 hover:opacity-100"
                        }`}
                      >
                        <img
                          src={img}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Right: details */}
              <div className="flex flex-col p-6 sm:p-8 lg:p-10">
                <p
                  className="text-[11px] uppercase tracking-[0.18em] text-accent font-medium"
                  style={{ color: product.accent }}
                >
                  {product.seriesName}
                </p>
                <h2 className="font-serif text-2xl sm:text-3xl lg:text-4xl mt-2 tracking-tight text-balance">
                  {product.title}
                </h2>
                <p className="text-sm text-muted-foreground mt-1.5 text-pretty">
                  {product.subtitle}
                </p>

                <div className="flex items-center gap-3 mt-3">
                  <div className="flex items-center gap-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Star
                        // biome-ignore lint/suspicious/noArrayIndexKey: 固定 5 颗星
                        key={i}
                        className={`size-3.5 ${
                          i < Math.floor(product.rating)
                            ? "fill-foreground text-foreground"
                            : "text-border"
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {product.rating.toFixed(1)} ·{" "}
                    {product.ratingCount.toLocaleString()} 条评价
                  </span>
                </div>

                <div className="flex items-baseline gap-3 mt-5">
                  <span className="text-2xl font-serif">
                    {formatPriceCNY(product.basePriceCents / 100)}
                  </span>
                  <span className="text-xs text-muted-foreground uppercase tracking-[0.12em]">
                    起
                  </span>
                </div>

                {/* Customization summary */}
                <div className="mt-5 p-4 bg-secondary/60 rounded-sm border border-border/60">
                  <div className="flex items-center gap-2 mb-3">
                    <Wand2 className="size-4 text-accent" />
                    <p className="text-[11px] uppercase tracking-[0.16em] font-medium">
                      自定义能力
                    </p>
                  </div>
                  <ul className="space-y-1.5 text-sm text-pretty">
                    <li className="flex items-start gap-2">
                      <span className="size-1 rounded-full bg-accent mt-1.5 shrink-0" />
                      <span>
                        <span className="font-medium">
                          {product.aiStyles.length} 种 AI 风格
                        </span>{" "}
                        — Original / Q-Version / 日漫 / 水彩 / 线稿
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
                        — {product.sizes.map((s) => `${s.cm}cm`).join(" / ")}
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

                {/* CTA — start customizing */}
                <Button
                  onClick={startCustomize}
                  size="lg"
                  className="w-full h-11 rounded-md text-sm font-medium group"
                  type="button"
                >
                  <Wand2 className="size-4 mr-2" />
                  开始定制
                  <ArrowRight className="size-4 ml-2 transition-transform group-hover:translate-x-0.5" />
                </Button>

                {/* View full details link */}
                <Link
                  href={`/products/${product.handle}`}
                  onClick={() => setQuickView(null)}
                  className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors mt-2 inline-block"
                >
                  查看完整详情 →
                </Link>

                {/* Perks */}
                <ul className="mt-6 space-y-2.5">
                  {perks.map((p) => (
                    <li
                      key={p.label}
                      className="flex items-center gap-2.5 text-xs text-muted-foreground"
                    >
                      <p.icon className="size-4 text-foreground/70 shrink-0" />
                      <span>{p.label}</span>
                    </li>
                  ))}
                </ul>

                {/* Tabs */}
                <Tabs defaultValue="description" className="mt-6">
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
                        起售价:{formatPriceCNY(product.basePriceCents / 100)}
                      </li>
                    </ul>
                  </TabsContent>
                  <TabsContent
                    value="shipping"
                    className="text-sm leading-relaxed text-muted-foreground mt-4 text-pretty"
                  >
                    工作室手工精修,{product.leadTimeDays} 天内发货。¥99
                    以上免运费。 定制商品不支持退货,但工艺问题免费重做。
                  </TabsContent>
                </Tabs>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
