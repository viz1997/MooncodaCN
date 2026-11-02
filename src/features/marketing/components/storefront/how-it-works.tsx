"use client";

import { motion } from "framer-motion";
import { Package, Settings, Upload, Wand2 } from "lucide-react";

/**
 * WJP 工作流程 —— 编号步骤栏。
 *
 * ## 为什么不再是 4 张方卡(2026-10-21 第三次改版的直接原因)
 *
 * 第一版是 4 张带边框的方形卡,形态和 `ProductCard` **完全一样**。首页上面
 * 已经有四段场合色带,再接一条横向滚动条,末尾补一排同形态的卡 —— 等于把
 * 这次改版刚消灭掉的「商品网格堆 N 遍」又请回来一次。
 *
 * 现在这段是**纯文字的编号栏**:一条横贯的细线之上,四列等分,列间竖细线分隔,
 * 每列顶端一个大号衬线数字 01–04。零边框、零圆角、零图标底座,视觉重量全部
 * 交给留白和数字 —— 和上下两段的图像栅格拉开一个量级。
 *
 * 顺序表达靠数字本身,**不画箭头**:横向阅读本来就是从左到右,箭头是冗余的。
 *
 * ## 与下一段的分工
 *
 * 紧邻的下一段(CraftGallery)的上半是「左文 + 右文」的分栏,这一段是
 * 「四列横排」—— 相邻两段的形状刻意错开,连续滚下来不会撞版。
 *
 * ## 图标为什么留着
 *
 * 图标不再是带底座的圆片(第一版那样会和 ProductCard 的图块打架),降级成
 * 标题前面的一个 14px 墨绿小记号 —— 只在扫读时提供一点定位辅助,不参与版面。
 */
const steps = [
  {
    icon: Upload,
    n: "01",
    title: "上传照片",
    description: "拖入或选一张清晰的照片 —— 宠物、合照、孩子的画都行。",
  },
  {
    icon: Wand2,
    n: "02",
    title: "选尺寸与风格",
    description:
      "先定尺寸,再挑 AI 风格:Q 版 / 二次元 / 水彩 / 线稿,约 20–35 秒出预览。",
  },
  {
    icon: Settings,
    n: "03",
    title: "选规格",
    description: "挑材质,加可选刻字与加急。",
  },
  {
    icon: Package,
    n: "04",
    title: "收货",
    description: "我们手工精修、全彩 3D 打印,带物流单号发出。",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="bg-background py-16 lg:py-24 scroll-mt-16">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        {/* Header —— 与 occasion 色带同构:eyebrow + 衬线标题 + tagline,
            但字号留在 text-3xl/4xl(色带的 5xl/6xl 是整屏大标题的量级,
            收尾段不跟)。CraftGallery 同一档。 */}
        <div className="max-w-xl mb-10 lg:mb-14">
          <p className="eyebrow text-[var(--accent)] mb-3">工作流程</p>
          <h2 className="text-3xl sm:text-4xl font-medium tracking-tight leading-[1.1] text-balance">
            4 步从照片到礼物
          </h2>
          <p className="mt-4 text-base text-foreground/65 leading-relaxed text-pretty">
            不需要懂设计,四步就行,中途随时改。
          </p>
        </div>

        {/* 步骤栏 —— 容器一条横线;移动端列与列之间用横线分隔,lg 换成竖线。
            first:border-t-0 去掉容器横线正下方那条重复的线;
            lg:border-t-0 把横线在四列布局下整体关掉,只留列间竖线。 */}
        <ol className="grid grid-cols-1 lg:grid-cols-4 border-t border-border/60">
          {steps.map((s, i) => (
            <motion.li
              key={s.n}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{
                duration: 0.45,
                delay: i * 0.07,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="border-t border-border/60 py-7 first:border-t-0 lg:border-t-0 lg:border-l lg:border-border/60 lg:py-9 lg:pr-8 lg:pl-8 first:lg:border-l-0 first:lg:pl-0 last:lg:pr-0"
            >
              {/* 序号 —— 衬线 + 低透明度当纹理用,不跟标题抢注意力 */}
              <span className="atelier-serif block text-4xl lg:text-5xl leading-none text-foreground/30 tabular-nums">
                {s.n}
              </span>
              <h3 className="mt-5 flex items-center gap-2 text-base font-medium">
                <s.icon className="size-3.5 shrink-0 text-[var(--primary)]" />
                {s.title}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed text-pretty">
                {s.description}
              </p>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
