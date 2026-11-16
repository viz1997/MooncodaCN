/**
 * 计价与姿态 —— 定价引擎 / 浮雕档位 / 智能摆盘 / 姿态对比 / 支撑缓存键
 *
 * 这一层算的是**钱**和**姿态**:
 *
 * - `pricing-engine.ts` —— 克重费 / 后处理费 / 支撑加价(引擎内部用「元」)
 * - `relief-detect.ts` —— 浮雕还是手办(决定托底 1mm 还是 5mm)
 * - `angle-optimizer.ts` —— 智能摆盘(在 Worker 里跑)
 * - `support-cache-key.ts` —— 支撑结果的缓存键(**钱的守卫**)
 */

export * from "./angle-optimizer";
export * from "./angle-optimizer-protocol";
export * from "./pose-comparison";
export * from "./pricing-engine";
export * from "./relief-detect";
export * from "./support-cache-key";
