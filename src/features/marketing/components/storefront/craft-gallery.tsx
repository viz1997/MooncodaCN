"use client";

import { PostCell } from "./community-wall";
import { WJP_COMMUNITY_POSTS } from "./wjp-store-data";

/**
 * 工艺 + 真实订单 —— 首页的收尾段(2026-10-31 新增)
 *
 * ## 为什么把 CraftStory 和 CommunityWall 合成一段
 *
 * 原来这是两段:先是「工艺故事」(左文 + 右侧三条竖排),再是「真实订单」
 * (标题分栏 + 四张案例图)。两段各自都有标题栏、都占一屏,连着滚下来像两块
 * 拼贴 —— 而且第一段是纯文字,夹在四段商品色带和一段图像栅格之间,薄得像
 * 掉了一截。
 *
 * 现在合成一段:左边是工艺(标题 + 一段话),右边是真实订单(标题 + 一段话),
 * 下面一条四张案例图横排。**页面上只出现一套标题栏**,文字给了一屏,图像
 * 给了半屏,中间靠留白和换行断开。
 *
 * ## 为什么案例图从非对称改成四张一行
 *
 * 原来的 CommunityWall 用三种画面形状拼(左大右二 + 一张通栏),理由是
 * 「别让页面再出现第四种并排栅格」。但首页现在已经是「四段同版式色带 +
 * 四步流程 + 四张案例」—— 统一才是这一版的主题,非对称反而成了唯一的例外。
 * 四张一行,和上面的 01–04 流程栏形成同一种「等分四列」的节奏。
 *
 * ## 关于 CraftStory 组件本身
 *
 * 它还留在 `craft-story.tsx` 里(带 01–03 三条工艺说明),给作品集页
 * `/marketing/products` 用 —— 那边需要完整的三条说明。首页只取它的标题和
 * 一段话,所以这里不 import 整个组件,避免把三条说明也拖进来。
 */
export function CraftGallery() {
  // 按点赞排序取前 4 —— 和 CommunityWall 同一套取数逻辑
  const top = [...WJP_COMMUNITY_POSTS]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 4);

  return (
    <section id="craft" className="bg-muted/30 py-16 lg:py-24 scroll-mt-16">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        {/* Header —— 一套标题栏,左右分栏。左边讲工艺,右边讲真实订单。 */}
        <div className="grid lg:grid-cols-12 lg:gap-16 mb-12 lg:mb-16">
          <div className="lg:col-span-5">
            <p className="eyebrow text-[var(--accent)] mb-3">关于工艺</p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-balance leading-[1.1]">
              AI 起稿。
              <br />
              师傅收尾。
            </h2>
            <p className="mt-5 text-sm text-muted-foreground leading-relaxed text-pretty">
              我们用 AI 快速重渲染,但每张订单都经过工作室师傅审核、手工精修。 AI
              是工具,不是工匠 —— 从上传到发货之间发生了什么,都在下面的真实
              订单里。
            </p>
          </div>

          <div className="mt-10 lg:mt-0 lg:col-span-6 lg:col-start-7">
            <h3 className="text-3xl sm:text-4xl font-medium tracking-tight text-balance leading-[1.1]">
              真实照片。
              <br />
              真实礼物。
            </h3>
            <p className="mt-5 text-sm text-muted-foreground leading-relaxed text-pretty">
              客户开箱 / 原图对比成品,移到图上看 Before/After 翻转。打{" "}
              <span className="font-medium text-foreground">#梦可达WJP</span>{" "}
              标签有机会被推荐。
            </p>
          </div>
        </div>

        {/* 案例图 —— 四张一行,统一版式 */}
        <div
          id="gallery"
          className="grid grid-cols-2 lg:grid-cols-4 gap-5 lg:gap-7 scroll-mt-16"
        >
          {top.map((post, i) => (
            <PostCell
              key={post.id}
              post={post}
              imgClassName="aspect-[4/5]"
              priority={i === 0}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
