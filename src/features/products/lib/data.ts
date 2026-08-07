/**
 * 产品 / 作品集 静态数据
 *
 * WJP 全彩 3D 打印业务的作品展示。每件作品含中英双语字段，slug 用作路由。
 * 后续接 CMS（Sanity / Strapi）时把本文件换成 fetcher 即可，对外接口不变。
 */

export type ProductCategory =
  | "badge"
  | "keychain"
  | "fridge-magnet"
  | "figure"
  | "standee"
  | "gift";

export interface ProductTranslation {
  name: string;
  tagline: string;
  description: string;
  /** 富文本段落，简单起见用 string[] */
  story?: string[];
  highlights?: string[];
}

export interface Product {
  /** URL slug，跨 locale 共用 */
  slug: string;
  /** 主分类（用于过滤 & 标签） */
  category: ProductCategory;
  /** 主图占位（封面） */
  cover: string;
  /** 详情页缩略图列表 */
  gallery: string[];
  /** 规格尺寸（mm） */
  dimensions: { width: number; depth: number; height: number };
  /** 工艺 / 材质 */
  material: string;
  /** 适用场景 / 受众 */
  occasion: string[];
  /** 单件价（元 / 美金由 locale 决定展示） */
  basePriceCNY: number;
  /** 是否为热门 / 推荐款 */
  featured?: boolean;
  translations: {
    zh: ProductTranslation;
    en: ProductTranslation;
  };
}

export const PRODUCTS: Product[] = [
  {
    slug: "pet-badge-golden-retriever",
    category: "badge",
    cover: "/products/pet-badge-golden-retriever/cover.svg",
    gallery: [
      "/products/pet-badge-golden-retriever/01.svg",
      "/products/pet-badge-golden-retriever/02.svg",
    ],
    dimensions: { width: 40, depth: 3, height: 40 },
    material: "WJP 全彩树脂",
    occasion: ["宠物纪念", "随身佩戴"],
    basePriceCNY: 49,
    featured: true,
    translations: {
      zh: {
        name: "宠物徽章 · 金毛犬",
        tagline: "把毛孩子做成随身佩戴的回忆",
        description:
          "一张正面照 + 一张侧脸照，全彩 3D 打印还原毛色、眼神、耳朵轮廓。30-50mm 胸针尺寸，配蝴蝶扣 / 安全别针，可别在衣服或包上。",
        story: [
          "这只金毛叫糖糖，已经陪伴主人 11 年。",
          "建模时特意保留了左耳那撮小卷毛，是它小时候最喜欢让人挠的地方。",
        ],
        highlights: ["30-50mm 全彩胸针", "蝴蝶扣 / 安全别针可选", "附定制卡片"],
      },
      en: {
        name: "Pet Badge · Golden Retriever",
        tagline: "Wear your furry friend close to heart",
        description:
          "One front photo + one side photo, full-color 3D printed faithful to fur color, gaze, and ear shape. 30-50mm pin size with butterfly clasp / safety pin.",
        story: [
          "This Golden Retriever is named Tangtang, 11 years with her human.",
          "The little curl on the left ear — their favorite scratch spot since puppyhood.",
        ],
        highlights: ["30-50mm full-color pin", "Butterfly / safety clasp", "Custom card included"],
      },
    },
  },
  {
    slug: "keychain-cat-tabby",
    category: "keychain",
    cover: "/products/keychain-cat-tabby/cover.svg",
    gallery: ["/products/keychain-cat-tabby/01.svg"],
    dimensions: { width: 45, depth: 8, height: 50 },
    material: "WJP 全彩树脂 + 金属挂扣",
    occasion: ["宠物纪念", "日常携带"],
    basePriceCNY: 89,
    translations: {
      zh: {
        name: "钥匙扣 · 虎斑猫",
        tagline: "揣在口袋里的毛茸茸",
        description:
          "猫主子最爱趴窗台的那张侧脸，做成钥匙扣随身带。40-60mm 立体造型，配 304 不锈钢双环挂扣。",
        highlights: ["40-60mm 立体造型", "304 不锈钢挂扣", "全彩细节还原虎斑纹"],
      },
      en: {
        name: "Keychain · Tabby Cat",
        tagline: "A purr in your pocket",
        description:
          "Your cat's favorite window-perching profile, made into a keychain. 40-60mm 3D form with 304 stainless steel ring.",
        highlights: ["40-60mm 3D form", "304 stainless ring", "Faithful tabby markings"],
      },
    },
  },
  {
    slug: "fridge-magnet-corgi",
    category: "fridge-magnet",
    cover: "/products/fridge-magnet-corgi/cover.svg",
    gallery: ["/products/fridge-magnet-corgi/01.svg"],
    dimensions: { width: 70, depth: 5, height: 80 },
    material: "WJP 全彩树脂 + 强磁底座",
    occasion: ["宠物纪念", "家居装饰"],
    basePriceCNY: 89,
    featured: true,
    translations: {
      zh: {
        name: "冰箱贴 · 柯基",
        tagline: "每次开冰箱都被治愈一下",
        description:
          "柯基标志性的大屁股 + 小短腿，全彩打印磁贴底座，可吸附在任何金属表面。70-100mm 厚度仅 5mm，不占空间。",
        highlights: ["70-100mm 薄片造型", "强磁底座可拆", "全彩还原柯基橘白毛色"],
      },
      en: {
        name: "Fridge Magnet · Corgi",
        tagline: "Smile every time you open the fridge",
        description:
          "An iconic Corgi butt + tiny legs as a magnet, full-color printed with detachable magnetic base. Adheres to any metal surface.",
        highlights: ["70-100mm slim form", "Detachable magnetic base", "Faithful orange-white coat"],
      },
    },
  },
  {
    slug: "figure-oc-illustrator",
    category: "figure",
    cover: "/products/figure-oc-illustrator/cover.svg",
    gallery: [
      "/products/figure-oc-illustrator/01.svg",
      "/products/figure-oc-illustrator/02.svg",
    ],
    dimensions: { width: 120, depth: 80, height: 180 },
    material: "WJP 全彩树脂 + 透明展示底座",
    occasion: ["二次元周边", "收藏摆件"],
    basePriceCNY: 299,
    translations: {
      zh: {
        name: "OC 手办 · 插画师定制",
        tagline: "把画稿做成桌面上的角色",
        description:
          "插画师上传三视图 + 角色性格描述，建模师还原发色渐变、服饰褶皱、表情神态。100-200mm 桌面级收藏摆件，附透明展示底座。",
        story: [
          "插画师 Yuki 自用的 OC 角色，第一次变成实体。",
          "全彩工艺让她画的渐变色和阴影都能 1:1 还原。",
        ],
        highlights: ["100-200mm 收藏级摆件", "渐变色 1:1 还原", "附透明展示底座"],
      },
      en: {
        name: "OC Figure · Illustrator Commission",
        tagline: "Bring your drawing to your desk",
        description:
          "Illustrator submits character reference sheets + personality notes; our modelers faithfully recreate gradient hair, fabric folds, and expressions. 100-200mm collectible figure with clear display base.",
        story: [
          "Illustrator Yuki's personal OC character, brought to life for the first time.",
          "The full-color process reproduces her painted gradients and shadows 1:1.",
        ],
        highlights: ["100-200mm collectible figure", "1:1 gradient reproduction", "Clear display base included"],
      },
    },
  },
  {
    slug: "standee-wedding-q-version",
    category: "standee",
    cover: "/products/standee-wedding-q-version/cover.svg",
    gallery: ["/products/standee-wedding-q-version/01.svg"],
    dimensions: { width: 100, depth: 12, height: 150 },
    material: "WJP 全彩树脂 + 高档礼盒",
    occasion: ["婚礼伴手", "纪念礼品"],
    basePriceCNY: 199,
    translations: {
      zh: {
        name: "婚礼 Q 版立牌 · 50 份起",
        tagline: "每一对来宾都收到专属的那份",
        description:
          "提供新人照片，Q 版化 + 全彩打印。每对来宾站姿、神态略有差异，独立礼盒包装，配丝带 + 定制贺卡。",
        highlights: ["100-150mm Q 版立牌", "高档礼盒 + 丝带", "可加定制贺卡"],
      },
      en: {
        name: "Wedding Q-Version Standee · 50+ set",
        tagline: "Every guest receives their own",
        description:
          "From couple photos, we Q-version and full-color print each guest's standee. Slight pose/expression variations per piece, premium gift box + ribbon + custom card.",
        highlights: ["100-150mm Q-version standee", "Premium box + ribbon", "Custom card add-on"],
      },
    },
  },
  {
    slug: "gift-keychain-couple",
    category: "gift",
    cover: "/products/gift-keychain-couple/cover.svg",
    gallery: ["/products/gift-keychain-couple/01.svg"],
    dimensions: { width: 40, depth: 6, height: 50 },
    material: "WJP 全彩树脂 + 礼盒",
    occasion: ["生日礼物", "纪念日"],
    basePriceCNY: 159,
    featured: true,
    translations: {
      zh: {
        name: "情侣钥匙扣 · 对装",
        tagline: "两件一组，共享一个故事",
        description:
          "一对照片做成对装钥匙扣，可互配或同款不同色。附礼盒包装 + 定制卡片，适合生日 / 纪念日。",
        highlights: ["两件一组对装", "礼盒 + 卡片", "互配 / 同款不同色可选"],
      },
      en: {
        name: "Couple Keychain · Pair",
        tagline: "Two pieces, one story",
        description:
          "Two photos become a pair of matching keychains. Gift box + custom card. Perfect for birthdays and anniversaries.",
        highlights: ["Two-piece set", "Box + card", "Match / same-style-different-color"],
      },
    },
  },
];

export function getProductBySlug(slug: string): Product | undefined {
  return PRODUCTS.find((p) => p.slug === slug);
}

export function getAllProductSlugs(): string[] {
  return PRODUCTS.map((p) => p.slug);
}

export function getFeaturedProducts(): Product[] {
  return PRODUCTS.filter((p) => p.featured);
}

export function getProductsByCategory(category: ProductCategory): Product[] {
  return PRODUCTS.filter((p) => p.category === category);
}

export const PRODUCT_CATEGORY_LABELS: Record<
  ProductCategory,
  { zh: string; en: string }
> = {
  badge: { zh: "宠物徽章", en: "Badge" },
  keychain: { zh: "钥匙扣", en: "Keychain" },
  "fridge-magnet": { zh: "冰箱贴", en: "Fridge Magnet" },
  figure: { zh: "手办", en: "Figure" },
  standee: { zh: "立牌", en: "Standee" },
  gift: { zh: "礼品套装", en: "Gift Set" },
};