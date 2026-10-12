/**
 * WJP 作品集静态数据 (atelier 系列展示形态)
 *
 * 来源：`D:\下载\atelier-source` 的 series/series 数据，本仓库适配为 WJP 全彩 3D 打印业务的
 * 三个系列（钥匙扣 / 手办 / 冰箱贴）。数据 hardcoded 是因为：(1) 业务侧 monthly 上新品 (N 个),
 * 量小不值得上 DB; (2) 静态数据让 marketing 页 SSR 无需数据库连接。
 *
 * 关系：未来若需 Medusa product/market 接管，按 handle 在 Medusa 端建 Product 即可，本文件可删。
 */
import type { PRODUCT_TYPES } from "@/features/gpt-image/lib/product-catalog";

/** 6 个产品型号 code（同步 product-catalog 的 R/A/P/RM/LB/M） */
export type ProductTypeCode = (typeof PRODUCT_TYPES)[number]["code"];

export interface WjpSeries {
  id: string;
  handle: string;
  name: string;
  tagline: string;
  description: string;
  cover: string;
  fromPriceCNY: number;
  count: number;
  accent: string;
}

export const WJP_SERIES: WjpSeries[] = [
  {
    id: "s_keychain",
    handle: "keychain",
    name: "钥匙扣",
    tagline: "照片裁形,随身携带",
    description:
      "WJP 全彩树脂钥匙扣,激光切割按照片轮廓,支持透明/磨砂底板、单双面印图,送礼最受欢迎。",
    cover:
      "https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=1200&q=80",
    fromPriceCNY: 19,
    count: 4,
    accent: "#B07A5B",
  },
  {
    id: "s_figure",
    handle: "figure",
    name: "Q版手办",
    tagline: "照片雕塑,3D 打印手办",
    description:
      "WJP 全彩树脂 3D 打印,真人照片雕塑化,约 8cm 高,手工上色,最个性礼物。",
    cover:
      "https://images.unsplash.com/photo-1558997767-920fa5b75e6e?auto=format&fit=crop&w=1200&q=80",
    fromPriceCNY: 199,
    count: 4,
    accent: "#7A5A8C",
  },
  {
    id: "s_magnet",
    handle: "magnet",
    name: "冰箱贴",
    tagline: "小记忆,贴在你每天看的地方",
    description:
      "WJP 全彩树脂冰箱贴 4-7cm,适合合影、宠物照、孩子画作,每天早上都能看见。",
    cover:
      "https://images.unsplash.com/photo-1611923134239-b9be5816e23d?auto=format&fit=crop&w=1200&q=80",
    fromPriceCNY: 39,
    count: 4,
    accent: "#8FA873",
  },
];

/**
 * 客户案例(真实订单示例)
 *
 * 数据来源：未来接 photo 表 source='generation' 全量 + 人工筛选最受欢迎 4 张。
 * 当前 hardcoded 占位,后续可替换为 db query。
 */
export interface WjpCommunityPost {
  id: string;
  author: string;
  avatar: string;
  caption: string;
  likes: number;
  productType: ProductTypeCode;
  beforeImage: string;
  afterImage: string;
}

export const WJP_COMMUNITY_POSTS: WjpCommunityPost[] = [
  {
    id: "p_001",
    author: "薇薇安的🐱",
    avatar: "https://i.pravatar.cc/100?img=1",
    caption: "我家金毛被做成了钥匙扣,每天都带在身边,真的太可爱了!",
    likes: 1280,
    productType: "R",
    beforeImage:
      "https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=600&q=80",
    afterImage:
      "https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "p_002",
    author: "李同学",
    avatar: "https://i.pravatar.cc/100?img=2",
    caption: "生日礼物 Q 版手办,朋友收到哭出来了 😭",
    likes: 956,
    productType: "M",
    beforeImage:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=600&q=80",
    afterImage:
      "https://images.unsplash.com/photo-1558997767-920fa5b75e6e?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "p_003",
    author: "萌宠博主",
    avatar: "https://i.pravatar.cc/100?img=3",
    caption: "三只猫合照做冰箱贴,每天做饭都能看到 ☀️",
    likes: 743,
    productType: "P",
    beforeImage:
      "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=600&q=80",
    afterImage:
      "https://images.unsplash.com/photo-1611923134239-b9be5816e23d?auto=format&fit=crop&w=600&q=80",
  },
  {
    id: "p_004",
    author: "新晋奶爸",
    avatar: "https://i.pravatar.cc/100?img=4",
    caption: "宝宝满月纪念钥匙扣,送给爷爷奶奶的礼物 👶",
    likes: 612,
    productType: "R",
    beforeImage:
      "https://images.unsplash.com/photo-1519689680058-324335c77eba?auto=format&fit=crop&w=600&q=80",
    afterImage:
      "https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=600&q=80",
  },
];

/**
 * formatPrice —— 简化版(人民币展示,无 Zustand 货币切换)。
 * 后续接 NextIntl + 货币 store 可替换为完整版。
 */
export function formatPriceCNY(amountCNY: number): string {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: amountCNY % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amountCNY);
}
