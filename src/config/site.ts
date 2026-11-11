/**
 * 站点配置
 *
 * 集中管理站点的基本信息，用于 SEO、元数据、页脚等
 *
 * 品牌定位：WJP 全彩 3D 打印专家，主营宠物徽章 / 钥匙扣 / 冰箱贴 / 手办等，
 * 支持一件定制、一件发货。
 */

/**
 * 站点联系邮箱 —— 环境变量的兜底值
 *
 * `NEXT_PUBLIC_SUPPORT_EMAIL` 没配的时候用它。**别再写
 * `hello@example.com` 这种占位符** —— 它会出现在页脚的版权行、导航里的
 * 「联系我们」链接(用户点了发邮件给 nobody),以及打印工单通知邮件的
 * Reply-To(工作室回信直接回不到)。
 *
 * 店铺自己的联系邮箱(收据 / 确认邮件上那个)是另一个东西,住在 Sellbase 的
 * 店铺设置里(`shop@mooncoda.com`,用 `scripts/update-sellbase-store.ts` 改)。
 */
export const FALLBACK_SUPPORT_EMAIL = "support@mooncoda.com";

export const siteConfig = {
  /** 站点名称 */
  name: "Mooncoda",

  /**
   * 海外独立站(Shopify)的顾客访问地址 —— **兜底值**
   *
   * ⚠️ **这一项现在是「兜底」,不是真理源**(2026-11-11 改的)。
   *
   * 工作室的原话:**「不需要环境变量,在后台设置」** ⇒ 真理源搬到 DB
   * (`site_setting` 表),后台在 `/admin/site-settings` 改,改完**不用重新
   * 部署**。回退链(逐键):
   *
   * ```
   * DB 那一行 → NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL → 空(不显示入口)
   * ```
   *
   * **别在这里读它来渲染页面** —— 那样就绕开了后台配置。真正生效的值走
   * `src/features/site-settings/lib/site-setting-store.ts` 的
   * `getInternationalStoreUrl()`。
   *
   * 空字符串 ⇒ **所有语言站上**既没有顶部公告条、也没有导航按钮(别留一条
   * 指向空地址的死链)。配上了就**所有语言站都出现**(2026-11-11 工作室改的
   * 口径:「不是 en 才是,所有都要」—— 中文站上也有境外买家)。
   *
   * ⚠️ **这跟 `src/features/payments/providers/shopify/` 那个支付通道不是
   * 一回事** —— 那个 2026-11-05 就下线了(`SHOPIFY_STORE_DOMAIN` 那套是
   * Admin API,给收款用的)。这里说的是**另一个 Shopify 店铺的顾客访问
   * 地址**:工作室的独立站在境外,境外的买家在那儿下单。
   *
   * `NEXT_PUBLIC_*` 是**构建期内联**的 ⇒ 改完环境变量要**重新部署**才生效,
   * 不是改完环境变量刷新页面就行 —— 这正是它只能当兜底的原因。
   */
  internationalStoreUrl:
    process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL?.trim() || "",

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
    email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || FALLBACK_SUPPORT_EMAIL,
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
