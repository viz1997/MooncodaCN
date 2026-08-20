import { createMDX } from "fumadocs-mdx/next";
import createNextIntlPlugin from "next-intl/plugin";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 创建 Fumadocs MDX 插件
 */
const withMDX = createMDX();

/**
 * 创建 next-intl 插件
 * 指定国际化请求配置文件路径
 */
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * 在 next.config.mjs 加载阶段同步读 package.json，
 * 给客户端 inline APP_VERSION（避免画布版本号显示 dev）。
 *
 * Next.js 16 dev --turbopack 完全不读 webpack.DefinePlugin，
 * 而 env 字段会被 Next.js 同步处理（dev 和 prod 都生效），
 * 是把 package.json version 暴露给 client code 最稳的途径。
 */
const pkg = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
);
const appVersion = pkg.version || "0.0.0";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // 把 package.json version 暴露给客户端（dev + prod 都生效）：
  // src/features/canvas/constant/env.ts 的 APP_VERSION 会优先读 NEXT_PUBLIC_APP_VERSION
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  // Exclude packages with webpack-specific syntax from server bundling
  serverExternalPackages: ["pino", "pino-pretty"],
  // webpack 别名：把画布里 `motion/react` 与 `radix-ui` 指向项目内的 shim 文件
  // （避免画布代码大量改动：motion 12 与 framer-motion 12 是同库不同发布线，
  //  radix-ui umbrella package 已不在我们的依赖里）
  webpack: (config) => {
    const path = require("path");
    const webpack = require("webpack");
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "motion/react": path.resolve(process.cwd(), "src/features/canvas/components/ui/motion-shim"),
      "radix-ui": path.resolve(process.cwd(), "src/features/canvas/components/ui/radix-ui-shim"),
      "@ant-design/pro-components": path.resolve(process.cwd(), "src/features/canvas/components/layout/pro-components-shim"),
    };
    // infinite-canvas 是 Vite SPA,代码里写 `import.meta.env.VITE_*`；
    // Next.js 客户端可见 env 必须 `NEXT_PUBLIC_`,此处统一 shim 成字符串字面量,
    // 缺失时返回 undefined（调用方按 `if (!raw) return` 兜底即可）
    config.plugins.push(
      new webpack.DefinePlugin({
        "import.meta.env.VITE_DOC_URL": JSON.stringify(
          process.env.NEXT_PUBLIC_DOCS_URL ?? undefined,
        ),
        "import.meta.env.VITE_PLUGIN_REGISTRY_URL": JSON.stringify(
          process.env.NEXT_PUBLIC_PLUGIN_REGISTRY_URL ?? undefined,
        ),
        "import.meta.env.VITE_ANALYTICS_GA4_ID": JSON.stringify(
          process.env.NEXT_PUBLIC_ANALYTICS_GA4_ID ?? undefined,
        ),
        "import.meta.env.VITE_ANALYTICS_BAIDU_ID": JSON.stringify(
          process.env.NEXT_PUBLIC_ANALYTICS_BAIDU_ID ?? undefined,
        ),
        "import.meta.env.VITE_DEV_PLUGINS": JSON.stringify(
          process.env.NEXT_PUBLIC_DEV_PLUGINS ?? undefined,
        ),
        // infinite-canvas 原 Vite `define` 配置里的构建时常量：
        //   __APP_RELEASES__  →  GitHub releases 数组（供 use-version-check 用）
        // __APP_VERSION__ 不在这里注入了：上面 `env: { NEXT_PUBLIC_APP_VERSION }` 走
        // Next.js 的内联通道，dev/prod 都生效，比 DefinePlugin（在 Turbopack dev 下不读）
        // 覆盖面更广。env.ts 优先读 process.env.NEXT_PUBLIC_APP_VERSION。
        __APP_RELEASES__: process.env.NEXT_PUBLIC_APP_RELEASES
          ? process.env.NEXT_PUBLIC_APP_RELEASES
          : "[]",
      }),
    );
    return config;
  },
  // infinite-canvas 画布编辑器的 antd 6 + rc-* 系列需要 transpile
  // （antd 6 用 ESM，rc-* 部分子包仍是 CJS）
  transpilePackages: [
    "antd",
    "@ant-design/icons",
    "@ant-design/cssinjs",
    "rc-util",
    "rc-pagination",
    "rc-picker",
    "rc-tree",
    "rc-table",
    "rc-select",
    "rc-cascader",
    "rc-checkbox",
    "rc-dropdown",
    "rc-input",
    "rc-input-number",
    "rc-menu",
    "rc-motion",
    "rc-notification",
    "rc-overflow",
    "rc-progress",
    "rc-rate",
    "rc-resize-observer",
    "rc-segmented",
    "rc-slider",
    "rc-steps",
    "rc-switch",
    "rc-tabs",
    "rc-tooltip",
    "rc-textarea",
    "rc-upload",
    "rc-virtual-list",
    "@uiw/react-codemirror",
    "@codemirror/lang-javascript",
    "@codemirror/lang-json",
  ],
  // antd 全量 import 时按需打包（drawer/button/select 等）
  experimental: {
    optimizePackageImports: ["antd", "@ant-design/icons", "lucide-react"],
  },
  // 客户端 import.meta.env.VITE_* / __APP_VERSION__ 兜底策略：
  // Next.js 16 Turbopack 的 `turbopack` 选项 schema 没有 `define` 字段
  // （见 node_modules/next/dist/server/config-shared.d.ts TurbopackOptions），
  // webpack DefinePlugin 只在 production build 生效，dev --turbopack 完全不读。
  // 因此客户端代码本身必须用 `typeof X !== "undefined" ? X : fallback` 兜底
  // （typeof 对未声明标识符不抛 ReferenceError，是 ECMAScript 唯一允许的操作）。
  // - src/features/canvas/constant/env.ts 的 APP_VERSION
  // - src/features/canvas/hooks/use-version-check.ts 的 __APP_RELEASES__
  // - src/features/canvas/lib/canvas/plugin-runtime.ts 的 APP_VERSION
  // 都已经按此模式改造。
};

// 组合插件: MDX -> NextIntl -> NextConfig
export default withMDX(withNextIntl(nextConfig));
