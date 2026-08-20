// @ts-nocheck
/**
 * env shim —— 把 infinite-canvas 的 `import.meta.env.VITE_*` 翻译成 Next.js 的
 * `process.env.NEXT_PUBLIC_*`。
 *
 * 用法：
 * ```ts
 * import { VITE_DEV_PLUGINS } from "@/features/canvas/lib/env-shim";
 * const raw = VITE_DEV_PLUGINS;
 * ```
 *
 * 设计动机：
 * - infinite-canvas 是 Vite SPA，env 走 `import.meta.env.VITE_*`
 * - Next.js 16 Turbopack 的 `turbopack` 选项 schema **没有 `define` 字段**，
 *   webpack DefinePlugin 也只在 production build 生效，dev --turbopack 完全不读
 *   —— 直接 `import.meta.env.VITE_*` 在 dev 客户端会抛
 *   "Cannot read properties of undefined (reading 'VITE_DOC_URL')"
 * - Next.js 16 客户端可见 env 必须前缀 `NEXT_PUBLIC_`，服务端用 `process.env.*`
 * - 画布只读这几个少量 env，**不需要**在服务端使用，因此统一暴露为字符串常量
 *
 * 命名规则：
 * - 保持 VITE_* 原名不变，调用方无需修改 import.meta.env 写法
 * - 默认值：未配置时返回 `undefined`（调用方按 `if (!raw) return` 兜底即可）
 */

export const VITE_DEV_PLUGINS: string | undefined =
  process.env.NEXT_PUBLIC_DEV_PLUGINS;

// env.ts 用
export const VITE_DOC_URL: string | undefined =
  process.env.NEXT_PUBLIC_DOCS_URL;
export const VITE_PLUGIN_REGISTRY_URL: string | undefined =
  process.env.NEXT_PUBLIC_PLUGIN_REGISTRY_URL;

// runtime-config.ts 用
export const VITE_ANALYTICS_GA4_ID: string | undefined =
  process.env.NEXT_PUBLIC_ANALYTICS_GA4_ID;
export const VITE_ANALYTICS_BAIDU_ID: string | undefined =
  process.env.NEXT_PUBLIC_ANALYTICS_BAIDU_ID;

// 未来可按需扩展：
// export const VITE_API_BASE = process.env.NEXT_PUBLIC_CANVAS_API_BASE ?? "";
// export const VITE_APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";
