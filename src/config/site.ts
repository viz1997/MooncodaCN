/**
 * 站点配置
 *
 * 集中管理站点的基本信息，用于 SEO、元数据、页脚等
 *
 * 品牌定位：WJP 全彩 3D 打印专家，主营宠物徽章 / 钥匙扣 / 冰箱贴 / 手办等，
 * 支持一件定制、一件发货。
 */
export const siteConfig = {
  /** 站点名称 */
  name: "Mooncoda",

  /** 中文站点名（页面标题 / 邮件签名使用） */
  nameZh: "Mooncoda 梦可达",

  /** 站点描述（SEO + OG 共用） */
  description:
    "Mooncoda 梦可达 — WJP 全彩 3D 打印专家，宠物徽章、钥匙扣、冰箱贴、手办等一件定制、一件发货。",

  /** 站点 URL (生产环境) */
  url: process.env.NEXT_PUBLIC_APP_URL || "https://example.com",

  /** OG 图片 URL */
  ogImage: "/og-image.png",

  /** 业务关键词，跨页面 SEO 复用 */
  tagline: {
    zh: "WJP 全彩 3D 打印 · 一件定制 · 一件发货",
    en: "WJP Full-Color 3D Printing · Single-piece Customization & Shipping",
  },

  /** 作者信息 */
  author: {
    name: "Mooncoda",
    url: process.env.NEXT_PUBLIC_APP_URL || "https://example.com",
    email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "hello@example.com",
  },

  /** 社交链接 */
  links: {
    twitter:
      process.env.NEXT_PUBLIC_TWITTER_URL || "https://twitter.com/example",
    github:
      process.env.NEXT_PUBLIC_GITHUB_URL ||
      "https://github.com/example/mooncada",
    discord:
      process.env.NEXT_PUBLIC_DISCORD_URL || "https://discord.gg/example",
  },

  /** 关键词 (SEO) */
  keywords: [
    "WJP 全彩 3D 打印",
    "全彩 3D 打印",
    "宠物徽章",
    "定制钥匙扣",
    "冰箱贴",
    "3D 打印手办",
    "一件定制",
    "一件发货",
    "小批量 3D 打印",
    "Mooncoda",
    "梦可达",
    "WJP 3D printing",
    "full-color 3D print",
    "custom figurine",
    "single-piece 3D print",
  ],
} as const;

/**
 * 站点配置类型
 */
export type SiteConfig = typeof siteConfig;
