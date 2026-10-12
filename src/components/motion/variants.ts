/**
 * 全站统一的 motion 缓动 + 入场变体
 *
 * 集中维护一处，避免 Hero / Reveal / 各 section 的 ease 各写各的。
 *
 * 缓动曲线选择 `[0.22, 1, 0.36, 1]` —— 平滑落定无超调，
 * 与"工程图纸"风格的克制视觉匹配。
 */

/** 统一的 ease-out 缓动曲线（framer-motion tuple 格式） */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** 标准入场时长（秒） */
export const ENTRANCE_DURATION = 0.5;

/** 基础 fade-up 变体（Reveal 用） */
export const fadeUpVariants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: ENTRANCE_DURATION, ease: EASE },
  },
};

/** Hero 的 stagger 容器变体（一次性 mount，no scroll trigger） */
export const heroContainerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08, delayChildren: 0.04 },
  },
};

/** Hero 的子项变体 —— 与 fadeUpVariants 一致但带 ease tuple 类型 */
export const heroItemVariants = fadeUpVariants;
