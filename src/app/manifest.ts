import type { MetadataRoute } from "next";

import { siteConfig } from "@/config";

/**
 * PWA manifest —— 特殊文件约定（与 robots.ts / sitemap.ts 同类）
 *
 * 由 src/app/layout.tsx 的 metadata.manifest 自动注入：
 *   <link rel="manifest" href="/manifest.webmanifest" />
 *
 * Next 14+ 的约定：文件名是 manifest.ts，导出的 MetadataRoute.Manifest
 * 会被编译成 /manifest.webmanifest 静态文件 —— 这才是真正的"特殊文件约定"
 * （之前的 route.ts 走的是自定义路由处理器，必须命名方法导出，用 default 不行）
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.nameZh,
    description: siteConfig.description,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#000000",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
