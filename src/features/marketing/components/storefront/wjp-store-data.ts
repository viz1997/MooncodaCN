/**
 * WJP 作品集静态数据 (atelier 系列展示形态)
 *
 * 来源：`D:\下载\atelier-source` 的 series/series 数据，本仓库适配为 WJP 全彩 3D 打印业务的
 * 三个系列（钥匙扣 / 手办 / 冰箱贴）。数据 hardcoded 是因为：(1) 业务侧 monthly 上新品 (N 个),
 * 量小不值得上 DB; (2) 静态数据让 marketing 页 SSR 无需数据库连接。
 *
 * 关系：商品目录的真理源在本仓库（见 architecture-sellbase-integration.md），Sellbase 只做
 * 收银台、目录是同步过去的镜像，所以这个文件不会删 —— 真要接 Sellbase，走
 * scripts/sync-sellbase-catalog.ts 按 product code 同步，跟这里的系列展示数据是两条线。
 */
export interface WjpSeries {
  id: string;
  handle: string;
  name: string;
  /** 英文名 —— 2026-11-01 补:首页改商城后品类名出现在首屏,en locale
   *  再显示「钥匙扣 / Q版手办 / 冰箱贴」就露馅了。 */
  nameEn: string;
  tagline: string;
  description: string;
  cover: string;
  /** 起售价(分)—— 展示走 `@/lib/money` 的 `formatCents` */
  fromPriceCents: number;
  count: number;
  accent: string;
}

export const WJP_SERIES: WjpSeries[] = [
  {
    id: "s_keychain",
    handle: "keychain",
    name: "钥匙扣",
    nameEn: "Keychain",
    tagline: "照片裁形,随身携带",
    description:
      "WJP 全彩树脂钥匙扣,激光切割按照片轮廓,支持透明/磨砂底板、单双面印图,送礼最受欢迎。",
    cover:
      "https://images.unsplash.com/photo-1624222247344-550fb60583dc?auto=format&fit=crop&w=1200&q=80",
    fromPriceCents: 1900,
    count: 4,
    accent: "#B07A5B",
  },
  {
    id: "s_figure",
    handle: "figure",
    name: "Q版手办",
    nameEn: "Q-Version Figure",
    tagline: "照片雕塑,3D 打印手办",
    description:
      "WJP 全彩树脂 3D 打印,真人照片雕塑化,约 8cm 高,手工上色,最个性礼物。",
    // 原 photo-1558997767-920fa5b75e6e 已 404 —— 这张是 StoreHero 的主图,
    // 首页右侧大图之前一直是裂的。改用对应商品已验证的那张肖像图。
    cover:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=1200&q=80",
    fromPriceCents: 19900,
    count: 4,
    accent: "#7A5A8C",
  },
  {
    id: "s_magnet",
    handle: "magnet",
    name: "冰箱贴",
    nameEn: "Fridge Magnet",
    tagline: "小记忆,贴在你每天看的地方",
    description:
      "WJP 全彩树脂冰箱贴 4-7cm,适合合影、宠物照、孩子画作,每天早上都能看见。",
    // 原 photo-1611923134239-b9be5816e23d 已 404
    cover:
      "https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=1200&q=80",
    fromPriceCents: 3900,
    count: 4,
    accent: "#8FA873",
  },
];

/**
 * 客户案例(真实订单示例)—— **2026-11-16 从这里搬走了**
 *
 * 以前这里是四条 **Unsplash 图库链接** + 编出来的顾客昵称和点赞数,前台
 * 首页(`CraftGallery`)和作品集页(`CommunityWall`)拿它当「真实照片。真实礼物。」
 * 摆在最显眼的位置。
 *
 * 那是**别人的宠物照片** —— 摆在「真实」两个字底下比不摆更糟。
 *
 * ⇒ 案例改成**后台可维护的 DB 数据**:`storefront_case` 表 + `/admin/showcases`。
 *   前台两处读 `getShowcaseCases(locale)`(`src/features/showcase/lib/showcase-catalog.ts`),
 *   渲染走 `src/features/showcase/components/showcase-case-cell.tsx`。
 *
 * ⚠️ **没有案例就整段不渲染** —— 不拿静态数据兜底。
 */

/**
 * 金额格式化 —— **不在这里**
 *
 * 以前这个文件里有一个 `formatPriceCNY`(收「元」的 float)。2026-11-05 起
 * 全仓库统一走 `@/lib/money` 的 `formatCents`(收「分」的整数)—— 一份就够,
 * 两份单位不同的格式化函数迟早混用出错(「差 100 倍」)。
 */
