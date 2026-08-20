// @ts-nocheck
/**
 * motion/react 别名 —— 把 infinite-canvas 的 motion v12 API 桥到 NextDevTpl 的 framer-motion
 *
 * 用法：画布代码 `import { motion } from "motion/react"` → 实际来自 `framer-motion`
 *
 * 关系背景：motion 在 12.x 之后从 framer-motion 拆出独立 npm package，API 完全兼容。
 * NextDevTpl 项目用 framer-motion@12，所以这里 re-export 一下即可，画布代码零改动。
 *
 * 注意：只 re-export 必要 API，不做 wrapper，避免类型推断出错。
 */
export {
  animate,
  type HTMLMotionProps,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
