"use client";

import { motion, useInView } from "framer-motion";
import type { ReactNode } from "react";
import { useRef } from "react";

/**
 * Reveal — 滚动进入视口时淡入上浮的包裹组件
 *
 * 用法：
 *   <Reveal>...</Reveal>
 *   <Reveal delay={0.08}>...</Reveal>
 *
 * 用于营销页各 section 的逐块入场动画。
 */
interface RevealProps {
  children: ReactNode;
  /** 入场延迟（秒），默认 0 */
  delay?: number;
  /** 一次入场后是否保持显示（默认 true，避免来回触发） */
  once?: boolean;
  className?: string;
}

export function Reveal({
  children,
  delay = 0,
  once = true,
  className,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, {
    once,
    margin: "-10% 0px -10% 0px",
  });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
      transition={{
        duration: 0.5,
        delay,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
