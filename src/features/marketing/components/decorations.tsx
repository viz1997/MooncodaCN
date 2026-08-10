/**
 * 手作潮玩风装饰元素 —— 统一语言
 *
 * 整页贯穿的小型 SVG 装饰：✨ sparkle / ♥ heart / ✿ paw / ★ star / 波浪分隔
 * 用 className 控制颜色（`text-coral` / `text-amber` 等）。
 *
 * 设计原则：
 * - stroke-width 一律 1.5（柔和不锐利）
 * - 默认 1em 大小（用 className 缩放）
 * - 不引入外部资源
 */

import type { SVGProps } from "react";

type DecorProps = SVGProps<SVGSVGElement> & {
  /** 像素尺寸，覆盖默认 1em */
  size?: number;
};

/** ✨ 闪光（4 角星） */
export function Sparkle({ size = 16, ...props }: DecorProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="presentation"
      aria-hidden
      {...props}
    >
      <path d="M12 0L13.5 8.5L22 12L13.5 15.5L12 24L10.5 15.5L2 12L10.5 8.5Z" />
    </svg>
  );
}

/** ♥ 心形 */
export function Heart({ size = 16, ...props }: DecorProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="presentation"
      aria-hidden
      {...props}
    >
      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
    </svg>
  );
}

/** ✿ 小花（5 瓣） */
export function Flower({ size = 16, ...props }: DecorProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="presentation"
      aria-hidden
      {...props}
    >
      <circle cx="12" cy="12" r="3" />
      <ellipse cx="12" cy="4" rx="2.5" ry="3.5" />
      <ellipse cx="12" cy="20" rx="2.5" ry="3.5" />
      <ellipse cx="4" cy="12" rx="3.5" ry="2.5" />
      <ellipse cx="20" cy="12" rx="3.5" ry="2.5" />
    </svg>
  );
}

/** ★ 描边五角星 */
export function Star({ size = 16, ...props }: DecorProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="presentation"
      aria-hidden
      {...props}
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

/** 〰️ 波浪分隔（用作 section 之间分隔线） */
export function WavyDivider({
  className,
  ...props
}: SVGProps<SVGSVGElement> & DecorProps) {
  return (
    <svg
      width="100%"
      height="24"
      viewBox="0 0 1200 24"
      preserveAspectRatio="none"
      fill="none"
      role="presentation"
      aria-hidden
      className={className}
      {...props}
    >
      <path
        d="M0,12 C150,2 300,22 450,12 C600,2 750,22 900,12 C1050,2 1150,18 1200,12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 散落的小圆点装饰组（占位容器，子元素由调用方渲染） */
export function ConfettiDots({
  items,
  className,
}: {
  items: { color: string; top?: string; left?: string; size?: number }[];
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className ?? ""}`}
    >
      {items.map((dot, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: 装饰位置由 index 决定
          key={i}
          className="confetti-dot absolute"
          style={{
            top: dot.top,
            left: dot.left,
            width: dot.size ? `${dot.size}px` : "8px",
            height: dot.size ? `${dot.size}px` : "8px",
            backgroundColor: dot.color,
          }}
        />
      ))}
    </div>
  );
}

/** 🐾 爪印（猫爪四瓣） */
export function Paw({ size = 24, ...props }: DecorProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="presentation"
      aria-hidden
      {...props}
    >
      <ellipse cx="6" cy="9" rx="2" ry="2.6" />
      <ellipse cx="10" cy="5.5" rx="2" ry="2.6" />
      <ellipse cx="14" cy="5.5" rx="2" ry="2.6" />
      <ellipse cx="18" cy="9" rx="2" ry="2.6" />
      <path d="M12 11c-3 0-5.5 2.8-5.5 5.5 0 2 1.5 3.5 3.5 3.5.8 0 1.3-.3 2-.3s1.2.3 2 .3c2 0 3.5-1.5 3.5-3.5 0-2.7-2.5-5.5-5.5-5.5z" />
    </svg>
  );
}

/** 🎁 礼物（手作风小礼物盒） */
export function Gift({ size = 24, ...props }: DecorProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="presentation"
      aria-hidden
      {...props}
    >
      <rect x="3" y="8" width="18" height="13" rx="2" />
      <path d="M3 12h18" />
      <path d="M12 8v13" />
      <path
        d="M12 8c-1.5-2.5-4-3-5-2s-.5 2.5 1 3c1 .3 3 .5 4-1z"
        fill="currentColor"
      />
      <path
        d="M12 8c1.5-2.5 4-3 5-2s.5 2.5-1 3c-1 .3-3 .5-4-1z"
        fill="currentColor"
      />
    </svg>
  );
}

/** ☁️ 云朵（柔软轮廓） */
export function Cloud({ size = 24, ...props }: DecorProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role="presentation"
      aria-hidden
      {...props}
    >
      <path d="M19 18H6c-3 0-5-2.5-5-5 0-2.4 1.8-4.4 4.2-4.7.4-2.4 2.5-4.3 5-4.3 2 0 3.7 1.1 4.5 2.8.5-.2 1-.3 1.6-.3 2.5 0 4.7 2 4.7 4.5S21.5 14 19 14c-.3 0-.6 0-.9-.1C18.8 16 19 18 19 18z" />
    </svg>
  );
}
