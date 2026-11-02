/**
 * CustomizeEntry —— 品类选择层(2026-10-22 新增)
 *
 * ## 它解决什么
 *
 * 导航和 Hero 的「定制」是**无商品入口**,但 `CustomWorkshop` 是商品作用域的
 * (`if (!product) return null`)。这两者之前链 `/image-gen` —— 那是登录后的
 * SaaS 工作台,`proxy.ts` 会把未登录访客弹到 `/sign-in?callbackUrl=/image-gen`,
 * 于是公开店铺的访客点「定制」直接撞登录墙,而匿名本来就能用的
 * `/api/store/*` 定制链路被白白绕开。
 *
 * 现在:点「定制」→ 选一个品类 → 该品类的代表商品交给 `CustomWorkshop`,
 * 全程不登录、不离开当前页。
 *
 * ## 为什么按「品类」而不是「场合」在这里选
 *
 * 定制工作台第三步(Configure)要选材质 / 尺寸,而材质和尺寸都是**按品类**给的
 * (`product.sizes` / `product.materials`)。场合(生日 / 毕业)不带任何规格信息,
 * 在这里选场合反而多一步且没有意义。品类是规格的最小充分维度。
 *
 * ## 代表商品怎么来的
 *
 * 每个品类取 `MOCK_PRODUCTS` 里该 `seriesId` 的第一件。选完品类后
 * CustomWorkshop 的 Configure 阶段仍然能改尺寸 / 材质 / 刻字,代表商品只提供
 * 品类骨架(aiStyles / sizes / materials / 价格档),不会锁死用户的选择。
 *
 * 挂载在 `(marketing-atelier)/layout.tsx`,与 CartDrawer / ProductQuickView /
 * CustomWorkshop 并列。portal 指向 `.atelier-root`,否则拿不到 atelier 的
 * 颜色 token(见 use-atelier-container.ts)。
 */

"use client";

import { ArrowRight, X } from "lucide-react";
import { useLocale } from "next-intl";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  formatPriceCNY,
  WJP_SERIES,
} from "@/features/marketing/components/storefront/wjp-store-data";

import { useAtelierContainer } from "../hooks/use-atelier-container";
import { useStorefrontModal } from "../hooks/use-storefront-modal";
import { MOCK_PRODUCTS } from "../lib/mock-catalog";

export function CustomizeEntry() {
  const locale = useLocale();
  const isZh = locale === "zh";

  const open = useStorefrontModal((s) => s.customizePickerOpen);
  const closePicker = useStorefrontModal((s) => s.closeCustomizePicker);
  const setCustomize = useStorefrontModal((s) => s.setCustomize);
  const container = useAtelierContainer();

  // 每个品类的代表商品。filter 保持 WJP_SERIES 的顺序,找不到的品类不渲染 ——
  // 宁可少一个卡片,也不要拿一个空壳商品进工作台(那一步会直接报错退出)。
  const entries = React.useMemo(
    () =>
      WJP_SERIES.map((series) => ({
        series,
        product: MOCK_PRODUCTS.find((p) => p.seriesId === series.id) ?? null,
      })).filter((e) => e.product !== null),
    []
  );

  const pick = (product: (typeof entries)[number]["product"]) => {
    if (!product) return;
    // setCustomize 内部会把 customizePickerOpen 关掉并打开 Workshop,
    // 两层 Dialog 不会叠着
    setCustomize(product);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closePicker()}>
      <DialogContent
        portalContainer={container}
        showCloseButton={false}
        className="w-full sm:max-w-3xl p-0 overflow-hidden"
      >
        <DialogTitle className="sr-only">
          {isZh ? "选择要定制的品类" : "Choose a category to customize"}
        </DialogTitle>

        <Button
          variant="ghost"
          size="icon"
          onClick={closePicker}
          aria-label={isZh ? "关闭" : "Close"}
          className="absolute top-3 right-3 z-10 size-9 rounded-full bg-background/90 backdrop-blur hover:bg-secondary shrink-0"
          type="button"
        >
          <X className="size-5" />
        </Button>

        <div className="px-6 sm:px-8 pt-7 pb-5">
          <p className="eyebrow text-[var(--accent)] mb-3">
            {isZh ? "定制" : "Customize"}
          </p>
          <h2 className="text-2xl sm:text-3xl font-medium tracking-tight leading-[1.1] text-balance">
            {isZh ? "想做一件自己的?" : "Make one that's yours?"}
          </h2>
          <p className="mt-2.5 text-sm text-muted-foreground leading-relaxed text-pretty">
            {isZh
              ? "先选一个品类,接着上传照片、选尺寸和风格、定规格。不需要注册。"
              : "Pick a form, then upload a photo, choose a size and style, set the specs. No sign-up."}
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-px bg-border/60 border-t">
          {entries.map(({ series, product }, i) => (
            <button
              key={series.id}
              type="button"
              onClick={() => pick(product)}
              className="group flex flex-col text-left bg-background hover:bg-secondary/40 transition-colors motion-safe:animate-in motion-safe:fade-in"
              style={{
                animationDelay: `${i * 60}ms`,
                animationDuration: "400ms",
              }}
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                <img
                  src={series.cover}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  loading="lazy"
                />
              </div>
              <div className="p-4 sm:p-5 flex flex-col gap-1 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className="size-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: series.accent }}
                  />
                  <span className="text-[11px] text-muted-foreground truncate">
                    {series.tagline}
                  </span>
                </div>
                <p className="text-base font-medium">{series.name}</p>
                <div className="mt-auto pt-3 flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {isZh ? "起 " : "from "}
                    {formatPriceCNY(series.fromPriceCNY, isZh ? "zh-CN" : "en")}
                  </p>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" />
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
