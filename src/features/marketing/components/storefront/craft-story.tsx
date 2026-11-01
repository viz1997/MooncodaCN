"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/routing";

/**
 * WJP 工艺故事 —— 左文 + 右侧三条竖排(2026-10-21 第三次改版)
 *
 * ## 版式为什么要从「上通栏头 + 下三列」换成「左右两栏」
 *
 * 第一版是通栏头(5+7)+ 三列并排的短条目 + 一条内联链接,问题有三:
 *  1. **横线堆叠** —— 段落自身的 `border-t`、三条目行的 `border-t`、底部
 *     链接行的 `border-t`,三条线上下紧挨着,读起来像表格的分隔线而不是版式
 *  2. **三列并排 = 又一个栅格** —— 刚在首页上面摆过四种商品栅格,这里再补
 *     一排三列,节奏上是第五次「并排 N 列」
 *  3. **整段没有视觉锚点** —— 纯文字,在一屏图像和一段横向滚动条之间显得很薄
 *
 * 现在:左侧 5 列放标题 / 说明 / 内联链接,右侧 6 列竖排三条,条目之间只用一条
 * 细线分隔。左右分栏之后,**细线只出现在右栏条目之间**,一条线一种用法。
 *
 * ## 为什么不给这一段配图(2026-10-21 明确决定)
 *
 * 页面上的图片全部是 `mock-catalog` 的 12 件商品,它们已经在四段场合色带里
 * **每件各出现过一次**。工艺段再插一张,就是同一件商品在首页露第二次 ——
 * 正是 `page.tsx` 注释里刚消灭掉的「12 件 unique 被摊成 24 次展示」。
 * 所以这段保持纯文字;真正需要图像锚点的位置留给上面的色带和下面的案例墙。
 */
const craftNotes = [
  {
    n: "01",
    title: "AI 秒级渲染",
    body: "照片进我们的风格迁移管线,Q 版、二次元、水彩、线稿 —— 点一下立刻返回预览图。",
  },
  {
    n: "02",
    title: "手工修图师傅把关",
    body: "AI 是起点不是终点。我们工作室的师傅会修掉瑕疵、补细节,文件过不了关的不会打印。",
  },
  {
    n: "03",
    title: "手工精修 + 带单号发货",
    body: "全彩 3D 打印,每件都从工作室带物流单号发出,周期 14-30 天。",
  },
];

export function CraftStory() {
  return (
    <section id="craft" className="bg-background py-16 lg:py-24 scroll-mt-16">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 lg:gap-16">
          {/* Left —— eyebrow + 衬线标题 + 说明 + 内联链接 */}
          <div className="lg:col-span-5">
            <p className="eyebrow text-[var(--accent)] mb-3">关于工艺</p>
            <h2 className="text-3xl sm:text-4xl font-medium tracking-tight text-balance leading-[1.1]">
              AI 起稿。
              <br />
              师傅收尾。
            </h2>
            <p className="mt-5 text-sm text-muted-foreground leading-relaxed text-pretty">
              我们用 AI 快速重渲染,但每张订单都经过工作室师傅审核、手工精修。AI
              是工具,不是工匠 —— 这一页就是让你知道,从上传到发货之间发生了什么。
            </p>
            {/* 内联链接 —— 不再自带 border-t(第一版和条目行叠成三条线),
                只靠 mt 拉开距离。锚点指向下一段的案例墙。 */}
            <Link
              href="#gallery"
              className="mt-8 inline-flex items-center gap-2 text-sm font-medium text-foreground hover:text-[var(--accent)] transition-colors group"
            >
              看真实客户订单
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          {/* Right —— 三条竖排,条目间一条细线。序号同样走衬线低透明度,
              与 HowItWorks 的 01–04 同一套语言,但这里是纵向排布。 */}
          <div className="mt-10 lg:mt-0 lg:col-span-6 lg:col-start-7">
            {craftNotes.map((note, i) => (
              <motion.div
                key={note.n}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                transition={{
                  duration: 0.45,
                  delay: i * 0.07,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className={`flex flex-col gap-2 py-7 first:pt-0 lg:first:pt-8 ${
                  i < craftNotes.length - 1
                    ? "border-b border-border/60"
                    : "pb-0"
                }`}
              >
                <div className="flex items-baseline gap-4">
                  <span className="atelier-serif text-2xl leading-none text-foreground/30 tabular-nums shrink-0">
                    {note.n}
                  </span>
                  <h3 className="text-lg font-medium tracking-tight">
                    {note.title}
                  </h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed text-pretty sm:pl-10">
                  {note.body}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
