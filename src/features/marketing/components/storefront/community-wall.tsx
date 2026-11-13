"use client";

import { motion } from "framer-motion";
import { ArrowLeftRight, Heart } from "lucide-react";
import { PRODUCT_TYPES } from "@/features/gpt-image/lib/product-catalog";
import type { WjpCommunityPost } from "./wjp-store-data";
import { WJP_COMMUNITY_POSTS } from "./wjp-store-data";

/**
 * WJP 客户案例墙 —— 非对称三形态(2026-10-21 第三次改版)
 *
 * ## 为什么去掉了卡片外框
 *
 * 第一版是 4 张 `bg-card + border + rounded-lg` 的方卡,和 `ProductCard`
 * 又是同一个壳子。首页此时已经有:hero 大图、四段场合色带(四种栅格)、
 * 一条横向滚动条 —— 案例墙是第四种「并排 4 个相同单元」的栅格。
 *
 * 现在**只保留图像本身**,去掉底色、边框、圆角:图直接落在段底色上,说明文字
 * 排在图下方。四个案例不再是四个一样的盒子,而是三种画面形状:
 *  - 一张大图(左 7 列,吃掉右列多出来的高度)
 *  - 两张方图上下叠(右 5 列)
 *  - 一张通栏全景(整行收尾)
 *
 * 「左大右二」的骨架跟 `OccasionShelf` 的 `FeatureSplit` 一致,但**不**照抄它
 * 的 `grid-rows-2 + row-span-2`:那套把两列的行高绑在一起,一旦某一列的
 * aspect 定高跟另一列对不上,图底下就会空出版位(该文件里记了这个坑)。这里
 * 让右列自然撑高、左列 stretch 跟齐,大图 `flex-1` 吸收高差。
 *
 * ## before/after 指示为什么常驻(不再 hover 才出现)
 *
 * 这一段的内容**就是**「原图 → 成品」这组对比,指示标签是内容的一部分而非
 * 装饰。第一版跟 `ProductCard` 一样做成 hover 才浮出,触屏永远看不到 ——
 * 而这里恰恰是全页最需要把 before/after 讲清楚的地方。
 */
/**
 * code → 面向顾客的中文名。从 PRODUCT_TYPES 派生(不手抄一份),但**要去掉
 * unit 前缀**。
 *
 * PRODUCT_TYPES[].name 是内部规格名,`unit: "cm"` 被拼在前面 —— R 的 name 实际
 * 是 "CM 钥匙扣"、M 是 "CM 手办"。那是给规格表 / SKU 用的,直接印在顾客看的
 * 案例墙徽章上会读成"CM 钥匙扣"这种莫名其妙的东西(2026-10-21 修)。
 * 这里剥掉前缀,只留品类名。
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

/** 单个案例 —— 图 + 图下说明。无卡片外框。 */
export function PostCell({
  post,
  className = "",
  imgClassName = "aspect-square",
  priority = false,
}: {
  post: WjpCommunityPost;
  className?: string;
  imgClassName?: string;
  priority?: boolean;
}) {
  const label = TYPE_NAMES[post.productType] ?? post.productType;
  return (
    <motion.figure
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className={`group flex flex-col min-w-0 ${className}`}
    >
      <div
        className={`relative overflow-hidden rounded-lg bg-muted ${imgClassName}`}
      >
        {/* After(默认) */}
        <img
          src={post.afterImage}
          alt={`${post.author} 收到的 ${label}`}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 group-hover:opacity-0"
          loading={priority ? "eager" : "lazy"}
        />
        {/* Before(hover 露出) */}
        <img
          src={post.beforeImage}
          alt={`${post.author} 的原始照片`}
          className="absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          loading="lazy"
        />
        <span className="absolute top-3 left-3 inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] rounded bg-background/85 backdrop-blur text-foreground/80">
          {label}
        </span>
        {/* 指示器常驻 —— 见文件头说明 */}
        <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] rounded bg-background/85 backdrop-blur text-foreground/70">
          <ArrowLeftRight className="size-2.5" />
          <span className="group-hover:hidden">成品</span>
          <span className="hidden group-hover:inline">原图</span>
        </span>
      </div>

      {/* 说明 —— 直接排在图下,不再包在卡片底色里 */}
      <figcaption className="pt-3 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {/* 头像用作者名首字 —— 原 i.pravatar.cc 外链对本网络一律 403,
              案例墙四颗头像是裂的。首字圆片零网络依赖。 */}
          <span
            aria-hidden
            className="size-6 rounded-full bg-[var(--primary)]/12 text-[var(--primary)] text-[10px] font-medium flex items-center justify-center shrink-0"
          >
            {post.author.slice(0, 1)}
          </span>
          <p className="text-xs font-medium truncate">{post.author}</p>
        </div>
        <p className="text-xs text-foreground/80 leading-relaxed text-pretty line-clamp-2">
          {post.caption}
        </p>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Heart className="size-3 fill-accent text-accent" />
          <span>{post.likes.toLocaleString()}</span>
        </p>
      </figcaption>
    </motion.figure>
  );
}

export function CommunityWall() {
  const top = [...WJP_COMMUNITY_POSTS]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 4);
  const [lead, second, third, panorama] = top;
  if (!lead || !second || !third || !panorama) return null;

  return (
    <section id="gallery" className="bg-muted/30 py-16 lg:py-24 scroll-mt-16">
      <div className="atelier-container">
        {/* Header —— 与 CraftStory 同一套「左标题 / 右说明」分栏 */}
        <div className="grid lg:grid-cols-12 lg:gap-16 mb-12 lg:mb-16">
          <div className="lg:col-span-5">
            <p className="eyebrow text-[var(--accent)] mb-3">真实订单</p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-balance leading-[1.1]">
              真实照片。
              <br />
              真实礼物。
            </h2>
          </div>
          <p className="mt-5 lg:mt-0 lg:col-span-6 lg:col-start-7 text-sm text-muted-foreground leading-relaxed text-pretty">
            客户开箱 / 原图对比成品,鼠标移到图上看 Before/After 翻转。 打{" "}
            <span className="font-medium text-foreground">#梦可达WJP</span>{" "}
            标签有机会被推荐。
          </p>
        </div>

        <div className="flex flex-col gap-5 lg:gap-7">
          {/* 主块 —— 左大右二。右列用嵌套栅格堆两张,自己撑出总高;左列靠
              默认的 align-items:stretch 跟到同高,图用 flex-1 吸收高差。
              不要写成 `lg:grid-rows-2 + row-span-2 + 固定 aspect`:那样两列
              行高各由自己的 aspect 决定,对不齐就会在图底下留空洞 ——
              OccasionShelf 的 FeatureSplit 注释里记的就是这个坑。 */}
          <div className="grid lg:grid-cols-12 gap-5 lg:gap-7">
            <PostCell
              post={lead}
              priority
              className="lg:col-span-7"
              imgClassName="aspect-[4/3] lg:aspect-auto lg:flex-1 lg:min-h-[440px]"
            />
            <div className="grid sm:grid-cols-2 lg:grid-cols-1 gap-5 lg:gap-7 lg:col-span-5">
              <PostCell post={second} imgClassName="aspect-[4/3]" />
              <PostCell post={third} imgClassName="aspect-[4/3]" />
            </div>
          </div>

          {/* 收尾 —— 一张通栏全景,给整页一个横向的收笔 */}
          <PostCell
            post={panorama}
            imgClassName="aspect-[16/9] lg:aspect-[24/7]"
          />
        </div>
      </div>
    </section>
  );
}
