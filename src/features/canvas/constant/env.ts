// @ts-nocheck
/**
 * APP_VERSION —— 原 infinite-canvas 通过 Vite `define: { __APP_VERSION__: pkg.version }`
 * 在编译时替换为字符串字面量。Next.js 16 + Turbopack 的 `turbopack` 配置 schema
 * （见 node_modules/next/dist/server/config-shared.d.ts TurbopackOptions）
 * **没有 `define` 字段**，webpack DefinePlugin 也只在 build 阶段生效。
 *
 * 三层兜底，按优先级：
 * 1. process.env.NEXT_PUBLIC_APP_VERSION —— next.config.mjs 的 `env` 字段在 dev/prod
 *    都会把 package.json version 同步 inline 到客户端（Next.js 自己处理），所以是首选
 * 2. __APP_VERSION__ —— production build 走 webpack.DefinePlugin 替换为字符串字面量
 *    （用 typeof 兜底，未声明不抛 ReferenceError）
 * 3. "dev" —— 兜底兜底，开发态若 env 也没注入就用这个
 */
export const APP_VERSION =
  (typeof process !== "undefined" &&
    typeof process.env?.NEXT_PUBLIC_APP_VERSION === "string" &&
    process.env.NEXT_PUBLIC_APP_VERSION) ||
  (typeof __APP_VERSION__ !== "undefined" && typeof __APP_VERSION__ === "string"
    ? __APP_VERSION__
    : null) ||
  "dev";

// VITE_DOC_URL / VITE_PLUGIN_REGISTRY_URL 走 env-shim：直接读 import.meta.env 在
// Next.js 16 Turbopack dev 下抛 "Cannot read properties of undefined (reading 'VITE_DOC_URL')"
import {
  VITE_DOC_URL,
  VITE_PLUGIN_REGISTRY_URL,
} from "@/features/canvas/lib/env-shim";

export const DOCS_URL = VITE_DOC_URL || "https://docs.canvas.best";

// Official plugin registry URL: CI publishes to plugins-dist for jsDelivr delivery; an environment variable may override it for self-hosting.
export const PLUGIN_REGISTRY_URL =
  VITE_PLUGIN_REGISTRY_URL ||
  "https://cdn.jsdelivr.net/gh/basketikun/infinite-canvas@plugins-dist/official-plugins.json";
