"use client";

import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/routing";

/**
 * WJP 工艺故事 —— 1:1 移植自 atelier `craft-story.tsx`。
 *
 * 适配差异:
 *  - studio 城市 "Rotterdam" → "上海"(WJP 实际运营地)
 *  - AI 渲染时长 "2 seconds" 保留(NextDevTpl Lingting wellapi 异步,但展示时仍说"秒级")
 *  - 文案整体本地化
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
    body: "AI 是起点不是终点。我们工作室的师傅会修掉瑕疵、补细节,文件过不了关的不会切割/打印。",
  },
  {
    n: "03",
    title: "手工精修 + 带单号发货",
    body: "激光切亚克力、手工浇注树脂、压制马口铁,每件都从上海工作室带物流单号发出,周期 14-30 天。",
  },
];

export function CraftStory() {
  return (
    <section id="craft" className="bg-background py-14 lg:py-20 border-t">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        {/* Header — restrained, not a hero-style marketing block */}
        <div className="grid lg:grid-cols-12 gap-6 lg:gap-12 mb-10">
          <div className="lg:col-span-5">
            <p className="text-[11px] uppercase tracking-[0.22em] text-accent mb-3">
              关于工艺
            </p>
            <h2 className="text-3xl sm:text-4xl tracking-tight text-balance leading-[1.1]">
              AI 起稿。
              <br />
              师傅收尾。
            </h2>
          </div>
          <p className="lg:col-span-7 text-sm text-muted-foreground leading-relaxed text-pretty lg:pt-2">
            我们用 AI 快速重渲染,但每张订单都经过工作室师傅审核、手工精修。AI
            是工具,不是工匠 —— 这一页就是让你知道,从上传到发货之间发生了什么。
          </p>
        </div>

        {/* Three short notes — horizontal, not big cards */}
        <div className="grid sm:grid-cols-3 gap-6 lg:gap-10 border-t pt-8">
          {craftNotes.map((note, i) => (
            <motion.div
              key={note.n}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="flex flex-col gap-2"
            >
              <div className="flex items-baseline gap-3">
                <span className="text-sm text-muted-foreground tabular-nums">
                  {note.n}
                </span>
                <h3 className="text-base font-semibold">{note.title}</h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
                {note.body}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Inline link, not a CTA banner */}
        <div className="mt-8 pt-6 border-t flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            想看实际收到的是什么样子?
          </p>
          <Link
            href="#gallery"
            className="inline-flex items-center gap-1.5 text-sm font-medium hover:text-accent transition-colors group"
          >
            看真实客户订单
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
