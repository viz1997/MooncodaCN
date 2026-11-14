import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";

import { siteConfig } from "@/config";

import "./globals.css";
/**
 * 中文衬线(Noto Serif SC)的切片表 —— **手写 @font-face**,不是 next/font
 *
 * 汉字字体是按码位切片的,靠 `unicode-range` 告诉浏览器每个文件管哪一段
 * 字形 ⇒ 页面只用到哪几个字就只下哪几个切片。
 * `next/font/local` 没有 unicode-range 这个口子 ⇒ 用它的话 101 个切片
 * 会被浏览器全下下来(6MB/页)。
 *
 * 这份 CSS 是 `pnpm fonts:sync` 生成的(逐条照抄 Google 的,只把 `url()`
 * 换成本地路径),并在这里定义 `--font-atelier-serif-sc`。
 */
import "@/fonts/noto-serif-sc/font.css";

/**
 * 全局元数据配置
 * 使用 siteConfig 集中管理
 */
export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [...siteConfig.keywords],
  authors: [{ name: siteConfig.author.name, url: siteConfig.author.url }],
  creator: siteConfig.author.name,
  metadataBase: new URL(siteConfig.url),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteConfig.url,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.name,
    description: siteConfig.description,
    images: [siteConfig.ogImage],
    creator: "@mooncoda",
  },
  manifest: "/manifest.webmanifest",
};

/* -------------------------------------------------------------------------- */
/*  Atelier 字体(只在 (marketing-atelier) 路由组内实际启用 —— 见                */
/*  src/app/[locale]/(marketing-atelier)/layout.tsx 的 .atelier-root CSS 变量) */
/* -------------------------------------------------------------------------- */

/**
 * ⚠️ **字体自托管,不走 `next/font/google`**(2026-11-14)
 *
 * 原来这三套走 `next/font/google` —— 构建期去 Google 拉字体。那天 Vercel 上
 * 构建直接炸了(32 个 Turbopack 报错):
 *
 * ```
 * Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
 * next/font/google queries have exactly one entry
 * ```
 *
 * 根因**不在本仓库的代码** —— Google 偶尔返回**没有扩展名**的字体地址
 * (`/l/font?kit=…`),Next 16.1.4 的 Turbopack 解析不了那个形状
 * (上游 vercel/next.js#99114,至今没有修复版)⇒ **构建结果取决于当天
 * Google 返回什么**。
 *
 * ⇒ 字体文件进仓库(产物由 `pnpm fonts:sync` 生成,提交进仓库),
 * 构建期不再碰 Google。顺带:境内访问 fonts.gstatic.com 不稳,
 * 自托管之后字体跟站点同源。
 *
 * **文件在 `src/fonts/`**(不是 `public/`)—— Turbopack 会给它们打哈希名
 * 放进 `/_next/static/media/`,带 immutable 缓存头。
 */

/**
 * Inter —— 正文(latin 子集)
 *
 * Google 对 (latin, normal) 只给**一个**文件,字重 100–900 共用
 * (可变字体)⇒ 声明成区间 "100 900"。
 *
 * ⚠️ **只留了 latin 子集** —— `next/font/local` 不支持 unicode-range,
 * 一个文件只能对应一个子集。latin-ext(ā ő ū 那些)在中文/英文站点上
 * 几乎不会出现,缺了也只是逐字形回退到系统字体。
 */
const inter = localFont({
  variable: "--font-atelier-inter",
  display: "swap",
  src: [
    {
      path: "../fonts/inter/latin.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
});

/**
 * Playfair Display —— 标题(latin 子集,normal + italic 各一个文件)
 *
 * 字重 400–700 共用同一个文件(可变字体)⇒ 区间 "400 700"。
 *
 * `adjustFontFallback: "Times New Roman"` —— 衬线字体的兜底度量要用
 * 衬线度量,跟原来 `next/font/google` 认 Playfair 是衬线时的口径一致
 * (Inter 走默认的 Arial 度量)。
 */
const playfair = localFont({
  variable: "--font-atelier-serif",
  display: "swap",
  adjustFontFallback: "Times New Roman",
  src: [
    {
      path: "../fonts/playfair-display/latin.woff2",
      weight: "400 700",
      style: "normal",
    },
    {
      path: "../fonts/playfair-display/latin-italic.woff2",
      weight: "400 700",
      style: "italic",
    },
  ],
});

/**
 * 中文衬线 —— 只在 atelier 子树的标题里当 Playfair 的**字形级回退**用。
 *
 * Playfair Display 没有汉字,所以字体栈写成
 * `Playfair → Noto Serif SC → Georgia → serif`,
 * 浏览器逐字形回退:拉丁字母走 Playfair,汉字走 Noto Serif SC。
 * 不需要按 locale 切 CSS —— zh 页上夹的英文单词仍是 Playfair,这是
 * 中文编辑排版的常规做法。
 *
 * 体积:汉字字体按码位切片,页面只用到哪几个字就只下哪几个切片
 * (切片表见 `@/fonts/noto-serif-sc/font.css`)。**只取 500/600 两档**
 * (标题用不到 400/700)。
 *
 * ⚠️ 它**不占 `<body>` 的 className 槽** —— `--font-atelier-serif-sc`
 * 是那份生成的 CSS 定义在 `:root` 上的(`<html>`),往下继承得到。
 */

/**
 * 根布局
 *
 * 提供基础 HTML 结构和字体配置
 * 实际内容由 [locale]/layout.tsx 处理
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const locale = cookieStore.get("NEXT_LOCALE")?.value ?? "zh";

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} ${inter.variable} ${playfair.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
