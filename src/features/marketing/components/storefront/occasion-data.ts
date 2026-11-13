/**
 * 场合分类层(2026-10-21 新增,2026-11-01 改成导购入口)
 *
 * 场合是首页的一条真实信息轴 —— 「送什么场合」是定制礼品最常见的入口。
 * 现在每段是**促销位**:一张海报图 + 场合名 + 一句文案 + 一个 CTA,
 * 点 CTA 设场合筛选(`useShopFilter.selectOccasion`)并滚回商品网格。
 *
 * 场合**不再陈列商品** —— 商品目录只有一处(`ShopGrid` 的 12 件网格),
 * 四段色带各摆 3 件的话,同一个目录就有两份。
 *
 * 色值集中在本文件的 `wash` 字段 +
 * `(marketing-atelier)/layout.tsx` 的 `.atelier-root` token 块,微调色相
 * 只改这两处。
 *
 * **`wash` 的明度必须离底色足够远**(2026-10-21 修正):第一版取 L=0.955,
 * 底色 `--background` 是 L=0.973,ΔL 只有 0.018 —— 四块色带肉眼完全看不见,
 * 整个改版读起来就是「什么都没变」。现在统一压到 L≈0.93,与底色差 0.04+
 * (约 4% 感知明度),既仍是柔和粉彩,又真的看得出是四块不同的颜色。
 * 改色值时先算 ΔL,别凭感觉调。
 *
 * **`handles` 是手工编排的,不做 tag 自动推导** —— mock-catalog 的 `tags`
 * 里没有「毕业」「节日」这类词(只有 宠物/情侣/宝宝/旅行/手办/雕塑/相框/…),
 * 强行按 tag 推导会把「毕业」映射成一堆手办,失真。代价是新商品不会自动
 * 进任何色带,要手工往这里加一行 —— 这是刻意的。
 *
 * 它现在有第二个用途:商品网格按场合筛选时,拿的就是这组 handle。
 *
 * ## 2026-10-31:版式不再由 occasion 决定
 *
 * 原来每个 occasion 带一个 `layout` 字段,四段分别是 feature-left /
 * triptych / wide-rows / feature-right —— 四种栅格轮着来。代价是:
 *  - 整页有五套并排栅格在打架(四种色带 + 一条横向滚动条),读起来像
 *    「商品列表堆了 5 遍」;
 *  - 12 件商品在四段色带里出现过一次,又被底部那条横向滚动条重复展示一次,
 *    unique 12 件摊成 24 次。
 *
 * 现在:**四段用同一种版式**(左海报右文案的两列 12 栅格),颜色继续一屏一变。
 * 节奏靠色带走,不再靠换栅格。
 */

/** 场合定义。`id` 同时是首页锚点(#birthday 等)。 */
export interface Occasion {
  id: string;
  /** 中文标签(色带标题) */
  label: string;
  /** 英文标签(en locale 的标题) */
  labelEn: string;
  /** 色带顶部的 eyebrow 前缀,拼成 "GIFTS FOR 生日礼物" / "GIFTS FOR BIRTHDAY" */
  eyebrow: string;
  /** 色带副标题 */
  tagline: string;
  taglineEn: string;
  /** 整段背景色(oklch) */
  wash: string;
  /** 场合海报图 —— 促销行里的那张大图 */
  poster: string;
  /** 该场合主推的 handle —— 取自 mock-catalog 的 12 件 StorefrontProduct */
  handles: readonly string[];
}

export const OCCASIONS: readonly Occasion[] = [
  {
    id: "birthday",
    label: "生日礼物",
    labelEn: "Birthday",
    eyebrow: "生日",
    tagline: "收礼的人打开盒子会笑出来的那种礼物。",
    taglineEn: "The kind of gift that gets a laugh out of the box.",
    wash: "oklch(0.930 0.052 15)", // petal pink
    poster:
      "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=1200&q=80",
    handles: [
      "keychain-pet-portrait",
      "figure-baby-statue",
      "magnet-pet-fridge",
    ],
  },
  {
    id: "graduation",
    label: "毕业季",
    labelEn: "Graduation",
    eyebrow: "毕业季",
    tagline: "给即将背上行囊的人,留一个能带走的四年。",
    taglineEn: "Four years, small enough to carry.",
    wash: "oklch(0.928 0.044 243)", // sky
    poster:
      "https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=80",
    // keychain-travel(旅行纪念)对应副标题里的「背上行囊」;不再复用生日的
    // keychain-pet-portrait,否则同一件在两屏出现,12 件 unique 会摊成 24 次展示
    handles: ["figure-portrait-statue", "magnet-frame-6", "keychain-travel"],
  },
  {
    id: "anniversary",
    label: "纪念日",
    labelEn: "Anniversary",
    eyebrow: "纪念日",
    tagline: "两个人的日常,值得被摆出来。",
    taglineEn: "The everyday of two people, worth putting on a shelf.",
    wash: "oklch(0.930 0.048 160)", // mint
    poster:
      "https://images.unsplash.com/photo-1518621736915-f3b1c41bfd00?auto=format&fit=crop&w=1200&q=80",
    handles: [
      "keychain-couple",
      "figure-couple-statue",
      "magnet-couple-fridge",
    ],
  },
  {
    id: "seasonal",
    label: "节日限定",
    labelEn: "Seasonal",
    eyebrow: "节日限定",
    tagline: "年末的、旅途中的、想记住的那一刻。",
    taglineEn: "Year-end, on-the-road, worth remembering.",
    wash: "oklch(0.935 0.062 90)", // wheat
    poster:
      "https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=1200&q=80",
    // 剩下三件未分配的:真皮徽章 / 宝宝异形 / 宠物雕塑 —— 凑满第四屏
    handles: [
      "magnet-leather-badge",
      "keychain-baby-shape",
      "figure-pet-statue",
    ],
  },
];

/**
 * 顶部导航项(2026-10-31 从 6 项精简到 4 项,2026-11-01 加「工具」)
 *
 * 原来这里是 生日 / 毕业 / 纪念 / 节日 / 定制 / 全部 六项,移动端还多一个
 * 「按形态」三项的二级列表 —— 一共九个可点的去处,导航本身就成了首页最复杂
 * 的元素。现在只留这些:
 *
 *  - **作品** → `/#works` —— 商品网格(12 件的唯一目录)。首页顶部导航
 *    「作品」和 hero 的「看全部商品」都落这儿。
 *  - **流程** → `/#how` —— 四步流程段。
 *  - **工艺** → `/#craft` —— 工艺 + 真实订单合并段。
 *  - **工具** → `/tools` —— 工具中心(独立路由,浏览器本地算,不需要登录)。
 *  - **定制** —— **不是链接**,是动作(`kind: "customize"`):点开品类选择层
 *    `CustomizeEntry`,选完品类交给 `CustomWorkshop`。
 *
 * 「定制」之前写的是 `href: "/image-gen"`。那是登录后的 SaaS 工作台,
 * `proxy.ts` 会把未登录访客弹到 `/sign-in?callbackUrl=/image-gen` —— 公开
 * 店铺的访客点「定制」会撞登录墙,而 `/api/store/*` 定制链路
 * 被绕开。（2026-11-13 起那条公开的生图路由也删了 —— 工作室不要公开的生图页面；生图能力还在控制台的 `/dashboard/generate`）也没有编造 `#custom` 锚点:`CustomWorkshop` 是 Dialog(没选中商品时
 * 整个组件 `return null`),页面上根本没有可以挂 id 的 DOM 节点。
 *
 * 2026-11-02:生图链路(`/api/store/ai/transform`)本身也改成要登录了 ——
 * 选完品类进 Workshop 时会过登录门槛。
 *
 * 场合(生日 / 毕业 / 纪念 / 节日)不再占导航位,但四段促销位本身还在首页上,
 * 每段有自己的标题和锚点 —— footer 的「作品集」栏直接链过去。
 *
 * 2026-11-10 加了第 6 项「海外独立站」(`kind: "external"`):境外来访客
 * 引导到工作室的**另一个 Shopify 店铺**。它**所有语言站都显示**(2026-11-11
 * 工作室改的口径:「不是 en 才是,所有都要」),而且要配了地址才显示。
 *
 * 2026-11-11:地址的真理源搬到 DB(`site_setting` 表)—— 工作室要求「**不
 * 需要环境变量,在后台设置**」。所以这一项的 `href` **恒为空**:真正的地址
 * 在渲染时从 `internationalStoreUrl` 这个 prop 拿(见 `wjp-store-header.tsx`)。
 *
 * 2026-11-12:这一项的标题从「海外独立站」改成 **「Shopify」** + 摆官方那个
 * 购物袋标志 —— 工作室的要求:**「【海外独立站】改为【shopify】,用 shopify
 * 的图标」**。那个店本来就是 Shopify 店铺,以前只是没说清楚。**标题仍然走
 * i18n**(`InternationalStore.nav`),改文案改 `messages/*.json` 就行。
 *
 * 2026-11-13:加了「打印」一项(`kind: "route"`,指向 `/tools/workbench`)——
 * 工作室的要求:**「顶部增加打印入口,进入 workbench 工具」**。它是工作室的
 * 主营入口(把模型打印出来),跟「工具」(`/tools` 工具中心索引)并存。
 */

export type StoreNavItem =
  | {
      id: string;
      label: string;
      labelEn: string;
      /** 渲染成 `<Link>`,跳首页锚点 */
      kind: "anchor";
      href: string;
    }
  | {
      id: string;
      label: string;
      labelEn: string;
      /**
       * 渲染成 `<Link>`,跳站内独立路由(不是首页锚点)
       *
       * 现在有两项:`/tools` 工具中心(索引页,列着工作台和磁吸孔切割)和
       * `/tools/workbench` 打印前工作台(2026-11-13 加的「打印」入口,直接
       * 进工作台)。两者都在 route group `(marketing-atelier)` 里,浏览器本地
       * 算,不需要登录。
       * 2026-11-01:原来是 `/pricing` 克重计算器,现在工具多了(模型检查),
       * 导航位只留一个「工具」,具体清单在 `/tools` 里列。
       * 与「anchor」分开是因为两者语义不同:anchor 是首页内滚动,
       * route 是换页,后续给 route 加「当前页高亮」时不用动 anchor 分支。
       */
      kind: "route";
      href: string;
    }
  | {
      id: string;
      label: string;
      labelEn: string;
      /** 渲染成 `<button>`,打开品类选择层 */
      kind: "customize";
    }
  | {
      id: string;
      /**
       * 渲染成 `<a target="_blank">`,跳**站外**(另一个 Shopify 店铺)
       *
       * 2026-11-10 新增:引导境外访客去工作室的独立站。
       *
       * 2026-11-11:地址的真理源搬到 DB(`site_setting` 表,工作室要求
       * 「不需要环境变量,在后台设置」)⇒ **这一项的 `href` 恒为空**,
       * 真正的地址在渲染时从 `internationalStoreUrl` prop 拿
       * (见 `wjp-store-header.tsx`)。这里留着 `href` 字段只是为了类型
       * 统一 —— 别的分支(`anchor` / `route`)要它。
       *
       * **只用 `<a>`,不用 next-intl 的 `<Link>`** —— `<Link>` 是给站内路由
       * 加 locale 前缀用的,外部绝对地址走它没有意义(多一事不如少一事)。
       *
       * 这一项**所有语言站都出现**(2026-11-11 工作室改的口径:「不是 en
       * 才是,所有都要」),而且要配了地址才出现 —— 判断在渲染处
       * (header),不在数据处。
       *
       * **它没有 `label` / `labelEn`** —— 别的几项标题写死在数据里(那是
       * 这个文件的老规矩),这一项的标题走 i18n(`InternationalStore.nav`),
       * 工作室要改文案改 `messages/*.json` 就行,不用动这份数据。
       */
      kind: "external";
      href: string;
    };

export const STORE_NAV: readonly StoreNavItem[] = [
  {
    id: "works",
    label: "作品",
    labelEn: "Work",
    kind: "anchor",
    href: "/#works",
  },
  {
    id: "how",
    label: "流程",
    labelEn: "How it works",
    kind: "anchor",
    href: "/#how",
  },
  {
    id: "craft",
    label: "工艺",
    labelEn: "Craft",
    kind: "anchor",
    href: "/#craft",
  },
  {
    // 「打印」(2026-11-13)—— 工作室要求「顶部增加打印入口,进入 workbench
    // 工具」。这是**工作室的主营入口**:导航里除了「作品」,用户最想点进去的
    // 就是「把我的模型打印出来」。
    //
    // 它跟「工具」的区别 —— 「工具」是**工具中心**(一个索引页,列着工作台
    // 和磁吸孔切割),「打印」是**直接进打印前工作台** `/tools/workbench`。
    // 两个都留着:想逛工具清单的走「工具」,已经知道要打印的直接走「打印」。
    //
    // 老的三个地址(`/pricing` / `/tools/weight` / `/tools/model-check`)都 308
    // 跳到 `/tools/workbench` —— 这一项指向的正是那个「活」的地址。
    id: "print",
    label: "打印",
    labelEn: "Print",
    kind: "route",
    href: "/tools/workbench",
  },
  {
    id: "tools",
    label: "工具",
    labelEn: "Tools",
    kind: "route",
    href: "/tools",
  },
  { id: "custom", label: "定制", labelEn: "Customize", kind: "customize" },
  {
    // 海外独立站(2026-11-10)—— **所有语言站都显示**(2026-11-11 改的口径),
    // 而且要配了地址才显示(判断在 header 的渲染处)。
    //
    // ⚠️ **`href` 恒为空** —— 真正的地址在渲染时从 `internationalStoreUrl`
    // prop 拿(DB 里的那一行 → 环境变量兜底 → 空)。
    id: "international",
    kind: "external",
    href: "",
  },
];

/** handle → 它属于哪些场合。商品详情页「也适合这些场合」用。 */
const BY_HANDLE: ReadonlyMap<string, readonly Occasion[]> = (() => {
  const map = new Map<string, Occasion[]>();
  for (const o of OCCASIONS) {
    for (const h of o.handles) {
      const arr = map.get(h) ?? [];
      arr.push(o);
      map.set(h, arr);
    }
  }
  return map;
})();

/** 某商品所属的场合(顺序同 OCCASIONS);不属于任何场合则空数组 */
export function occasionsForHandle(handle: string): readonly Occasion[] {
  return BY_HANDLE.get(handle) ?? [];
}

/**
 * 商品详情页的色带背景:取第一个匹配场合的 wash,无匹配则 bone 暖纸底。
 *
 * 无匹配不返 null —— 页面需要的是「能直接塞进 style.background 的值」,
 * 让调用方写 fallback 会到处漏。
 */
export function washForHandle(handle: string): string {
  return occasionsForHandle(handle)[0]?.wash ?? "oklch(0.973 0.010 85)";
}
