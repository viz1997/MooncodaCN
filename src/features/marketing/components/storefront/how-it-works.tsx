"use client";

import { motion } from "framer-motion";
import { Package, Settings, Upload, Wand2 } from "lucide-react";

/**
 * WJP 工作流程 —— 1:1 移植自 atelier `how-it-works.tsx`。
 *
 * 适配差异:
 *  - step 4 Receive 文案换成 "我们手工精修 + 物流跟踪 / 14-30 天" (atelier 是 5-21 天)
 *  - 其余文案/图标保持不变
 */
const steps = [
  {
    icon: Upload,
    step: "1",
    title: "上传照片",
    description: "拖入或选一张清晰的照片 —— 宠物、合照、孩子的画都行。",
  },
  {
    icon: Wand2,
    step: "2",
    title: "选风格",
    description: "选 AI 风格:Q 版 / 二次元 / 水彩 / 线稿,5 秒看效果。",
  },
  {
    icon: Settings,
    step: "3",
    title: "选规格",
    description: "挑材质、尺寸,加可选刻字。",
  },
  {
    icon: Package,
    step: "4",
    title: "收货",
    description: "我们手工精修、激光切割 / 3D 打印,带物流单号发出。",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="bg-background py-12 lg:py-16">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            工作流程
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            4 步从照片到礼物。
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {steps.map((s, i) => (
            <motion.div
              key={s.step}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="flex flex-col gap-3 p-5 border rounded-md"
            >
              <div className="flex items-center justify-between">
                <span className="size-9 rounded-md bg-muted flex items-center justify-center">
                  <s.icon className="size-4" />
                </span>
                <span className="text-sm font-semibold text-muted-foreground">
                  {s.step}
                </span>
              </div>
              <h3 className="text-sm font-semibold">{s.title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed text-pretty">
                {s.description}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
