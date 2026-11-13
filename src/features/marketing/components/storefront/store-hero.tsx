"use client";

import { motion } from "framer-motion";
import { ArrowRight, Upload } from "lucide-react";
import * as React from "react";
import { useStorefrontModal } from "@/features/storefront/hooks/use-storefront-modal";
import {
  pickByHandle,
  resolveSeriesFromPrices,
} from "@/features/storefront/lib/series-pricing";
import type { StorefrontProduct } from "@/features/storefront/types";
import { Link } from "@/i18n/routing";
import { formatCents } from "@/lib/money";

import { WJP_SERIES } from "./wjp-store-data";

/**
 * WJP 商店首页 Hero —— 移植自 atelier `store-hero.tsx`。
 *
 * ## 2026-11-01:主图从「一张生活照」换成「四件商品」
 *
 * 原来右侧是一张 Unsplash 生活照(一个大笑的女人),角标写着「Q版手办 ·
 * 起 ¥199」—— 照片里根本没有手办,只有人。这不是配图不当,这是**读起来
 * 完全不像商城**的根源:首屏看不到一件商品、一个价格,读者不知道这家店卖什么。
 *
 * 现在右侧是 2×2 的商品拼贴,四块分别覆盖三个品类(钥匙扣 ¥19 / 冰箱贴
 * ¥39 / 手办 ¥199),每块角上直接写价格和「起」。首屏一眼就知道:卖什么、
 * 多少钱、大概什么形状。
 *
 * 价格锚点也补进了左侧文案 —— 商城的第一屏必须给数字。
 *
 * ## 2026-11-01:补 en locale
 *
 * hero 之前整段写死中文。首页改成商城之后,上面多了一条英文公告条、
 * 下面多了一排英文品类格,中间夹一段中文 hero —— en 页看着像没做完。
 * 现在 hero 接 `locale` prop,文案 / 价格锚点 / CTA / 拼贴上的商品名
 * 全按 locale 走(拼贴用 `titleEn`,不是 `title`)。
 *
 * ## 其它适配差异
 *
 *  - 移除 atelier 的 `useFormatPrice` (Zustand 货币切换)→ 用本仓库的 formatCents
 *  - "How it works" 锚点保留 (#how)
 *  - 主 CTA 从 `<Link href="/image-gen">` 改成按钮 → 开品类选择层(2026-10-22):
 *    `/image-gen` 是登录后的 SaaS 工作台,`proxy.ts` 会把未登录访客弹到
 *    `/sign-in?callbackUrl=/image-gen`。Hero 是访客的第一入口,不该一上来就要登录
 *    —— 匿名本来就能跑 `/api/store/*` 的定制链路。（2026-11-13 起那条公开的生图路由也删了 —— 工作室不要公开的生图页面；生图能力还在控制台的 `/dashboard/generate`）
 *
 * ## 2026-11-02:生图要登录
 *
 * 上面那段「匿名本来就能跑 `/api/store/*` 的定制链路」已经作废 ——
 * `/api/store/ai/transform` 现在缺会话一律 401(那是一次真花钱的上游 AI 调用)。
 * Hero CTA **仍然只开品类选择层**(逛品类不花钱),但选完品类进工作台时
 * 会先过登录门槛(`use-require-sign-in.ts`)。
 */

/**
 * 首屏拼贴的四件 —— 刻意跨三个品类,让读者看到「什么都能做」。
 *
 * 选图上有个硬约束:这四张缩略图**不能**和下面品类导航条的三张系列封面
 * (`WJP_SERIES[].cover`)撞图。撞了就等于第一屏里同一张照片出现两次,
 * 一眼看过去像「只有一张图」。mock-catalog 里 12 件商品用的图只够这么分,
 * 再多就没有不重复的库存图了。
 */
const HERO_HANDLES = [
  "keychain-travel",
  "figure-pet-statue",
  "magnet-frame-6",
  "magnet-leather-badge",
] as const;

/**
 * 首屏那三行价格锚点 —— **品类 id 对上 `WJP_SERIES` 的 id**
 *
 * 以前这三行是写死的字符串(「钥匙扣 ¥19 起」)。后台改了基础价,首屏还是
 * ¥19 —— 又是「改了不生效」。现在从**商品**算:每个品类取最便宜那件的
 * 基础价(= 文案上说的「起」)。
 */
const PRICE_ANCHOR_SERIES = [
  { seriesId: "s_keychain", zh: "钥匙扣", en: "Keychains" },
  { seriesId: "s_magnet", zh: "冰箱贴", en: "Magnets" },
  { seriesId: "s_figure", zh: "Q 版手办", en: "Figures" },
] as const;

export function StoreHero({
  locale,
  products,
}: {
  locale: "zh" | "en";
  products: StorefrontProduct[];
}) {
  const isZh = locale === "zh";
  // 「上传照片开始」→ CustomizeEntry(选品类)→ CustomWorkshop
  const openCustomizePicker = useStorefrontModal((s) => s.openCustomizePicker);

  const featured = React.useMemo(
    () => pickByHandle(products, HERO_HANDLES),
    [products]
  );

  // 起售价 —— DB 的价优先,查不到退回 `WJP_SERIES` 里的静态兜底值
  const seriesFrom = React.useMemo(
    () => resolveSeriesFromPrices(products, WJP_SERIES),
    [products]
  );

  return (
    <section className="bg-background">
      {/* 顶部一道玫瑰细线 —— The Foggy Dog 的收边手法 */}
      <div
        className="h-px w-full"
        style={{ backgroundColor: "var(--accent)" }}
      />
      <div className="atelier-container">
        <div className="grid items-center gap-0 py-12 lg:grid-cols-2 lg:gap-12 lg:py-20">
          {/* Left: copy —— eyebrow + 大衬线标题 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="px-1 lg:px-2"
          >
            <p className="eyebrow text-[var(--accent)] mb-5">
              {isZh ? "全彩 3D 定制礼品" : "Full-colour 3D custom gifts"}
            </p>
            {/* 三行硬断,不是两行:lg 栏宽约 584px,text-7xl(72px)下
                「变成一件真实的礼物.」是 10 个全角字 ≈ 720px,放不下,
                浏览器只能在「真实的礼 / 物.」处折行 —— 一个孤零零的
                「物.」挂第三行。改成 4 + 6 字的两行断,不再依赖自然折行。 */}
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-medium tracking-tight leading-[1.02] text-balance">
              {isZh ? (
                <>
                  一张照片,
                  <br />
                  变成一件
                  <br />
                  真实的礼物.
                </>
              ) : (
                <>
                  One photo,
                  <br />
                  one real
                  <br />
                  keepsake.
                </>
              )}
            </h1>
            <p className="mt-6 text-base text-muted-foreground max-w-md leading-relaxed text-pretty">
              {isZh
                ? "上传一张照片,挑选 AI 风格,我们把它做成钥匙扣、Q 版手办或冰箱贴 —— 每件全彩树脂打印,手工精修。"
                : "Upload a photo, pick an AI style, and we print it in full-colour resin — keychains, Q-version figures, fridge magnets. Hand-finished."}
            </p>

            {/* 价格锚点 —— 商城首屏必须给数字
                价从商品算(DB 的基础价),不是写死的字符串。 */}
            <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-sm text-foreground/80">
              {PRICE_ANCHOR_SERIES.map((anchor, i) => {
                const price = formatCents(
                  seriesFrom.get(anchor.seriesId) ?? 0,
                  {
                    locale: isZh ? "zh-CN" : "en",
                  }
                );
                return (
                  <React.Fragment key={anchor.seriesId}>
                    {i > 0 ? <span className="text-border">·</span> : null}
                    <span>
                      {isZh
                        ? `${anchor.zh} ${price} 起`
                        : `${anchor.en} from ${price}`}
                    </span>
                  </React.Fragment>
                );
              })}
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={openCustomizePicker}
                className="inline-flex items-center gap-2 bg-[var(--primary)] text-[var(--primary-foreground)] px-7 py-3.5 text-sm font-medium rounded-md hover:opacity-90 transition-opacity group"
              >
                <Upload className="size-4" />
                {isZh ? "上传照片开始" : "Upload a photo"}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              {/* 同页锚点用原生 <a> —— Link 会带上 locale 前缀,变成一次路由跳转 */}
              <a
                href="#works"
                className="inline-flex items-center gap-2 text-[var(--accent)] px-7 py-3.5 text-sm font-medium border border-[var(--accent)]/40 rounded-md hover:bg-[var(--accent)]/5 transition-colors"
              >
                {isZh ? "看全部商品" : "See all 12"}
                <ArrowRight className="size-4" />
              </a>
            </div>
          </motion.div>

          {/* Right: 商品拼贴 —— 首屏就摆货,不是一张生活照 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="relative mt-10 aspect-square w-full lg:mt-0"
            // 主图落在浅薄荷色块上,呼应下面的「纪念日」色带。
            // 色值跟 occasion-data.ts 的 anniversary wash 保持一致 —— 改那边要同步改这里。
            style={{ backgroundColor: "oklch(0.930 0.048 160)" }}
          >
            <div className="grid h-full grid-cols-2 grid-rows-2 gap-3 p-3 sm:gap-4 sm:p-4">
              {featured.map((product) => (
                <Link
                  key={product.handle}
                  href={`/product/${product.handle}`}
                  className="group relative block overflow-hidden rounded-lg bg-muted"
                >
                  <img
                    src={product.thumbnail}
                    alt={isZh ? product.title : product.titleEn}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                    loading="eager"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-2.5 sm:p-3">
                    <p className="truncate text-xs font-medium text-white">
                      {isZh ? product.title : product.titleEn}
                    </p>
                    <p className="font-mono text-[11px] text-white/80">
                      {formatCents(product.basePriceCents, {
                        locale: isZh ? "zh-CN" : "en",
                      })}{" "}
                      {isZh ? "起" : "from"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
