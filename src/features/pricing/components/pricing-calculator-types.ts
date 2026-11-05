/**
 * 克重计算器的对外类型 —— 单独一个文件
 *
 * ## 为什么不在 `pricing-calculator.tsx` 里
 *
 * `PricingModelPayload` 要被**别的模块**import(打印报价台、模型上传器),
 * 而 `pricing-calculator.tsx` 是一个 "use client" 组件 —— 从组件文件里 import
 * 类型虽然编译期没问题(类型会被擦除),但读代码的人会以为引入了那个组件的
 * 运行时依赖。
 *
 * 放一个纯类型文件,依赖关系一眼看得清:谁要用这个形状,只依赖这个文件。
 */

import type { ModelFile } from "@/features/pricing/lib/zip-extractor";

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
