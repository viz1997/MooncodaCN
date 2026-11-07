/**
 * 克重计算器的对外类型 —— 单独一个文件
 *
 * ## 为什么不在 `pricing-calculator.tsx` 里
 *
 * `PricingModelPayload` 要被**别的模块**import(打印单卡片、模型上传器),
 * 而 `pricing-calculator.tsx` 是一个 "use client" 组件 —— 从组件文件里 import
 * 类型虽然编译期没问题(类型会被擦除),但读代码的人会以为引入了那个组件的
 * 运行时依赖。
 *
 * 放一个纯类型文件,依赖关系一眼看得清:谁要用这个形状,只依赖这个文件。
 */

import type { ModelFile } from "@/features/pricing/lib/zip-extractor";
import type { PrintQuoteInput } from "@/features/print-quote/lib/quote-types";

/**
 * 报价模式下抛给父组件的模型载荷
 *
 * `scales` 是当前生效的缩放因子 —— 下单重新打包模型时要按它缩放,
 * 否则工作室拿到的文件和报价单上的尺寸对不上。
 */
export type PricingModelPayload = {
  model: ModelFile;
  scales: [number, number, number];
};

/**
 * 「按**当前姿态**把支撑算出来」的入口
 *
 * ## 为什么需要它
 *
 * 工作室的口径(2026-11-07):**支撑不跟随角度实时重算** —— 用户把角度摆定
 * 之后,点浮层上那颗「包裹支撑」才算一次(支撑克重 + 总克重 + 画出来那圈
 * 支撑)。转一下模型就重算一遍,页面卡、数字还在一直跳。
 *
 * 但「加入打印单」**必须带上支撑克重** —— 服务端按这组数重算报价,少了它
 * 支撑费会算成 0(收少了钱)。用户没点过那颗按钮的时候,这里现算一次
 * (只要数,那块几何不用建)。
 *
 * 返回算完之后的 `PrintQuoteInput`(几何 + 支撑);模型还没就绪就返回 null。
 */
export type EnsureSupportFn = () => Promise<PrintQuoteInput | null>;
