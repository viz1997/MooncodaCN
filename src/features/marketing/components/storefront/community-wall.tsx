"use client";

import { ShowcaseCaseCell } from "@/features/showcase/components/showcase-case-cell";
import type { ShowcaseCase } from "@/features/showcase/lib/case-types";

/**
 * WJP 客户案例墙 —— 非对称三形态(2026-10-21 第三次改版)
 *
 * ## 数据是**后台维护的真实案例**(2026-11-16)
 *
 * 以前这一段喂的是 `wjp-store-data.ts` 里四条 **Unsplash 图库链接**,配着
 * 编出来的顾客昵称和点赞数 —— 那是**别人的宠物照片**,摆在「真实照片。真实
 * 礼物。」底下比不摆更糟。工作室把自己的实拍成品传上来(后台 `/admin/showcases`),
 * 这一段读 DB。
 *
 * ⚠️ **没有案例就整段不渲染** —— **不拿静态数据兜底**。宁可空着,也不能拿假
 * 数据冒充「真实」。
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
 * ## 案例数量可以是 1~4 个
 *
 * 工作室刚开张时手里可能只有一张实拍图。**摆不满就少摆,别拿重复的凑** ——
 * 重复的图摆在「真实」底下等于说「我们只有一张」。所以:
 *
 * | 案例数 | 版式 |
 * |---|---|
 * | 1 | 一张通栏 |
 * | 2 | 左 7 列 + 右 5 列(右列那一张自己撑高) |
 * | 3 | 左 7 列 + 右 5 列(两张叠) |
 * | 4 | 左 7 列 + 右 5 列(两张叠)+ 底部一张通栏 |
 *
 * ## before/after 指示常驻(不再 hover 才出现)
 *
 * 这一段的内容**就是**「原图 → 成品」这组对比,指示标签是内容的一部分而非
 * 装饰。第一版跟 `ProductCard` 一样做成 hover 才浮出,触屏永远看不到 ——
 * 而这里恰恰是全页最需要把 before/after 讲清楚的地方。
 *
 * ⚠️ 但**只有真配了原图的时候才摆那个指示器** —— 摆一个点了没反应的提示
 * 是骗人(见 `showcase-case-cell.tsx`)。
 */
export function CommunityWall({ cases }: { cases: ShowcaseCase[] }) {
  // 没有案例 —— 整段不渲染(不拿静态数据兜底)
  if (!cases || cases.length === 0) return null;

  // 第一张一定有(上面已经判过长度)—— 单独取出来,`lead` 就不是「可能没有」
  // 了,TS 也能把类型收窄。后面三张**可以没有**(案例数 1~4 都摆得下)。
  const lead = cases[0];
  if (!lead) return null;
  const second = cases[1];
  const third = cases[2];
  const panorama = cases[3];

  /** 有几张配了原图 —— 决定说明里能不能提「移到图上看翻转」 */
  const hasBefore = cases.some((c) => Boolean(c.beforeSrc));

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
            {hasBefore
              ? "工作室自己打印、自己拍照 —— 客户开箱 / 原图对比成品,鼠标移到图上看 Before/After 翻转。"
              : "工作室自己打印、自己拍照 —— 下面是真实交付的成品。"}
          </p>
        </div>

        <div className="flex flex-col gap-5 lg:gap-7">
          {/* 主块 —— 左大右二。右列用嵌套栅格堆两张,自己撑出总高;左列靠
              默认的 align-items:stretch 跟到同高,图用 flex-1 吸收高差。
              不要写成 `lg:grid-rows-2 + row-span-2 + 固定 aspect`:那样两列
              行高各由自己的 aspect 决定,对不齐就会在图底下留空洞 ——
              OccasionShelf 的 FeatureSplit 注释里记的就是这个坑。 */}
          <div className="grid lg:grid-cols-12 gap-5 lg:gap-7">
            <ShowcaseCaseCell
              item={lead}
              priority
              className={second ? "lg:col-span-7" : "lg:col-span-12"}
              imgClassName="aspect-[4/3] lg:aspect-auto lg:flex-1 lg:min-h-[440px]"
            />

            {/* 只有一张的时候,右列那一张自己占满 5 列 */}
            {second ? (
              third ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-1 gap-5 lg:gap-7 lg:col-span-5">
                  <ShowcaseCaseCell item={second} imgClassName="aspect-[4/3]" />
                  <ShowcaseCaseCell item={third} imgClassName="aspect-[4/3]" />
                </div>
              ) : (
                <ShowcaseCaseCell
                  item={second}
                  className="lg:col-span-5"
                  imgClassName="aspect-[4/3] lg:aspect-auto lg:flex-1 lg:min-h-[440px]"
                />
              )
            ) : null}
          </div>

          {/* 收尾 —— 一张通栏全景,给整页一个横向的收笔 */}
          {panorama ? (
            <ShowcaseCaseCell
              item={panorama}
              imgClassName="aspect-[16/9] lg:aspect-[24/7]"
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
