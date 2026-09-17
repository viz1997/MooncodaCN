"use client";

import { motion } from "framer-motion";
import { ArrowLeftRight, Heart } from "lucide-react";
import { PRODUCT_TYPES } from "@/features/gpt-image/lib/product-catalog";
import { WJP_COMMUNITY_POSTS } from "./wjp-store-data";

/**
 * WJP 客户案例墙 —— 1:1 移植自 atelier `community-wall.tsx`。
 *
 * 适配差异:
 *  - 产品标签从 atelier "Keychain/Figure/Magnet" 改为 NextDevTpl PRODUCT_TYPES 字典的 zh name
 *  - "#MadeWithAtelier" → "#梦可达WJP"
 *  - data source 从 atelier `communityPosts` 切换到 `WJP_COMMUNITY_POSTS`
 */
const typeLabels: Record<string, string> = PRODUCT_TYPES.reduce(
  (acc, t) => {
    acc[t.code] = t.name;
    return acc;
  },
  {} as Record<string, string>
);

export function CommunityWall() {
  const top = [...WJP_COMMUNITY_POSTS]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 4);

  return (
    <section id="gallery" className="bg-muted/30 py-14 lg:py-20 border-t">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-6 lg:gap-12 mb-10">
          <div className="lg:col-span-5">
            <p className="text-[11px] uppercase tracking-[0.22em] text-accent mb-3">
              真实订单
            </p>
            <h2 className="text-3xl sm:text-4xl tracking-tight text-balance leading-[1.1]">
              真实照片。
              <br />
              真实礼物。
            </h2>
          </div>
          <p className="lg:col-span-7 text-sm text-muted-foreground leading-relaxed text-pretty lg:pt-2">
            客户开箱 / 原图对比成品,鼠标移到卡片上看 Before/After 翻转。 打{" "}
            <span className="font-medium text-foreground">#梦可达WJP</span>{" "}
            标签有机会被推荐。
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          {top.map((post, i) => {
            const label =
              typeLabels[post.productType as string] ?? post.productType;
            return (
              <motion.figure
                key={post.id}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                className="group relative bg-card border border-border/60 rounded-md overflow-hidden hover:border-foreground/30 transition-colors"
              >
                <div className="relative aspect-square overflow-hidden bg-muted">
                  {/* After (default) */}
                  <img
                    src={post.afterImage}
                    alt={`${post.author} 收到的 ${label}`}
                    className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 group-hover:opacity-0"
                    loading="lazy"
                  />
                  {/* Before (revealed on hover) */}
                  <img
                    src={post.beforeImage}
                    alt={`${post.author} 的原始照片`}
                    className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                    loading="lazy"
                  />
                  <span className="absolute top-2 left-2 inline-flex items-center px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] rounded bg-background/85 backdrop-blur text-foreground/80">
                    {label}
                  </span>
                  <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] rounded bg-background/85 backdrop-blur text-foreground/80">
                    <ArrowLeftRight className="size-2.5" />
                    <span className="group-hover:hidden">成品</span>
                    <span className="hidden group-hover:inline">原图</span>
                  </span>
                </div>
                <figcaption className="p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <img
                      src={post.avatar}
                      alt={post.author}
                      className="size-6 rounded-full object-cover bg-muted"
                    />
                    <p className="text-xs font-medium truncate">
                      {post.author}
                    </p>
                  </div>
                  <p className="text-xs text-foreground/85 leading-relaxed text-pretty line-clamp-2">
                    {post.caption}
                  </p>
                  <div className="flex items-center gap-1.5 mt-2 text-[11px] text-muted-foreground">
                    <Heart className="size-3 fill-accent text-accent" />
                    <span>{post.likes.toLocaleString()}</span>
                  </div>
                </figcaption>
              </motion.figure>
            );
          })}
        </div>
      </div>
    </section>
  );
}
