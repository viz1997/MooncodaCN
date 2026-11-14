import {
  BookOpen,
  Boxes,
  Cpu,
  CreditCard,
  FolderOpen,
  Frame,
  Gift,
  Globe,
  Headset,
  Images,
  LayoutDashboard,
  ListOrdered,
  type LucideIcon,
  Package,
  Scale,
  ScrollText,
  Settings,
  Shield,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  Truck,
  Users,
  Wand2,
} from "lucide-react";

/**
 * 导航链接类型
 */
export interface NavItem {
  title: string;
  /**
   * i18n key —— 给了就用 messages 里的文案,没给就用 title
   *
   * Footer 的链接标题历史上是写死的英文(zh 页面也显示英文)。中文站点的
   * 打印须知这类文档必须有中文标题,靠 titleKey 补齐。
   */
  titleKey?: string;
  href: string;
  disabled?: boolean;
  external?: boolean;
  icon?: LucideIcon;
  description?: string;
  /** 子项（用于侧边栏二级菜单） */
  children?: NavItem[];
  /** 仅管理员可见 */
  requireAdmin?: boolean;
}

/**
 * 导航分组类型
 */
export interface NavGroup {
  title: string;
  items: NavItem[];
}

// ============================================
// Marketing 导航配置 —— 2026-11-13 **整个没了**
// ============================================
//
// 工作室的原话:「全站一套头尾」+「不再展示这些页面，即原项目的页面」。
//
// 以前这里有四份配置,现在**一份都不留**:
//
//  | 删掉的 | 为什么 |
//  |---|---|
//  | `mainNav` | 模板那套 `Header` 的导航 —— 整站改用商城头(`WjpStoreHeader` +
//    `STORE_NAV`),模板头删了,这份配置就没有消费者了 |
//  | `productsNav` | 模板那套 `Header` 的 Products 下拉(3 列 × 2 项)—— 同样只被
//    模板头用。9 个项全跳 `/products`,那个地址现在是**能下单的真目录** |
//  | `footerNav` | 模板那套 `Footer` 的配置 —— 模板页脚删了,现在页脚是
//    `StoreFooter`(商城那一套,链接写死在它自己的文件里) |
//  | `marketingConfig` | 只是把 `mainNav` + `footerNav` 打包 —— 没人用 |
//
// **商城的导航不在这里** —— 商城头那 6 项在
// `src/features/marketing/components/storefront/occasion-data.ts` 的
// `STORE_NAV`(工作室自己精简过的),页脚的链接在
// `src/features/marketing/components/storefront/store-footer.tsx`。
//
// `NavItem` / `NavGroup` 两个类型**留着** —— `dashboardNav` / `adminNav`
// 还在用。

// ============================================
// Dashboard 导航配置
// ============================================

/**
 * Dashboard 侧边栏导航分组
 */
export const dashboardNav: NavGroup[] = [
  {
    title: "Dashboard",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
      },
      {
        title: "Generate",
        href: "/dashboard/generate",
        icon: Wand2,
      },
      {
        title: "Generate V2",
        href: "/dashboard/generate-v2",
        icon: Sparkles,
      },
      // 已隐藏：公开生图（2026-11-13 起那条公开路由整个删了 —— 工作室不要
      // 公开的生图页面；生图能力在上面的「Generate」/「Generate V2」里）
      // { title: "Public Image Gen", href: "/image-gen", icon: Sparkles },
      // 已隐藏：照片库独立入口 —— 已合并到「我的资产」里的「我的照片」Tab
      // { title: "Photos", href: "/dashboard/photos", icon: Image },
      // 已隐藏：效果图独立入口 —— 2026-08-23 「生图结果入库 photo 表」后，
      // 用户在「我的资产」按 source=generation 筛选即可看到所有生图历史，
      // 不需要在 sider 单独放一个 nav。
      // { title: "Effects", href: "/dashboard/effects", icon: Image },
      // 已隐藏：3D 模型管理
      // { title: "Models", href: "/dashboard/models", icon: Image },
      // 已隐藏：积分页（积分功能未启用）
      // { title: "Credits", href: "/dashboard/credits", icon: Coins },
      {
        title: "Orders",
        href: "/dashboard/prompt-orders",
        icon: ListOrdered,
      },
      // 2026-11-06：「我的打印订单 / 我的商城订单 / 收货地址」三样从控制台
      // 侧边栏撤掉了 —— 工作室的原话:「打印订单、购物订单、地址管理不放在
      // 控制台里面,而是电商首页的用户头像那里」。这三样是**买家的东西**,
      // 摆在控制台里等于让买家先搞懂「控制台」是什么才找得到自己的单。
      // 入口现在在电商首页右上角头像下拉里,指向 `/account/*`。
      // （旧的 `/dashboard/print-orders` 等地址留了重定向,见那四个 page.tsx。）
      {
        title: "Canvas",
        href: "/dashboard/canvas",
        icon: Frame,
      },
      {
        title: "Prompt Library",
        href: "/dashboard/prompts",
        icon: BookOpen,
      },
      {
        title: "My Assets",
        href: "/dashboard/assets",
        icon: Images,
      },
      {
        title: "Settings",
        href: "/dashboard/settings",
        icon: Settings,
      },
      {
        title: "Support",
        href: "/dashboard/support",
        icon: Headset,
      },
    ],
  },
  {
    title: "Admin",
    items: [
      {
        title: "Admin Console",
        href: "/admin",
        icon: Shield,
        requireAdmin: true,
      },
    ],
  },
];

// ============================================
// Admin 导航配置
// ============================================

/**
 * Admin 侧边栏导航分组
 */
export const adminNav: NavGroup[] = [
  {
    title: "管理中心",
    items: [
      // 已隐藏：控制面板总览页
      // { title: "控制面板", href: "/admin", icon: LayoutDashboard },
      {
        title: "用户管理",
        href: "/admin/users",
        icon: Users,
      },
      {
        title: "工单管理",
        href: "/admin/tickets",
        icon: Ticket,
      },
      // 2026-09-18：新增 /admin/orders 全局订单管理页（admin 全局视角 + 取消 + 改备注）
      // - 入口与 admin/users 平级（业务管理类）
      // - title "订单管理" 已在 AdminSidebar.nav.gptImageOrders 字典里
      // - 老的 /dashboard/prompt-Orders 仍保留给 user 自服务，不删
      //
      // 2026-11-14：打印订单收进「订单管理」这一组（工作室原话：「打印订单
      // 作为订单管理子菜单」）。**父项的 href 仍然是它自己那个页面** ——
      // 父项既是入口也是分组头,「打印订单」缩进一行挂在下面。
      {
        title: "订单管理",
        href: "/admin/orders",
        icon: ShoppingBag,
        children: [
          // 2026-11-01：打印服务工单（print_order 表）—— 跟父项的
          // 「订单管理」（promptOrder 表,gpt-image 生图订单）是两套独立数据
          {
            title: "打印订单",
            href: "/admin/print-orders",
            icon: Scale,
          },
        ],
      },
      // 2026-11-08：后台文件管理 —— 浏览整个 R2 桶（打印模型 / 生图结果 /
      // 画布产物 / 上传件）。看的是 `R2_*` 那个桶,不是头像桶(`STORAGE_*`)。
      {
        title: "文件管理",
        href: "/admin/files",
        icon: FolderOpen,
      },
      // 2026-11-08：优惠码后台 —— 订单级优惠码(满减 / 百分比 / 免运费 /
      // 新人首单),商城订单和打印工单都能用。折扣由服务端算,这一页只管
      // 「这张券长什么样、什么时候能用、谁能用」。
      {
        title: "优惠码",
        href: "/admin/coupons",
        icon: Gift,
      },
      // 2026-11-13：后台发货台 —— 商城订单和打印工单**摆一张表**,填「快递
      // 公司 + 运单号」,买家在订单详情页看得见物流。一期不接第三方物流平台。
      {
        title: "发货管理",
        href: "/admin/shipments",
        icon: Truck,
      },
      // 2026-11-14：把三页「配置」收进一个「设置」分组（工作室原话：
      // 「打印定价、站点设置、支付设置都放在设置菜单里作为子菜单」）。
      // - 父项的 href 指向**第一个子项**（仓库里「商品管理」那组也是这个
      //   做法：父项 href = 某个子项的 href）
      // - 「设置」**自己**没有页面 —— 三页各管各的,没有一张「设置总览」
      {
        title: "设置",
        href: "/admin/print-pricing",
        icon: Settings,
        children: [
          // 2026-11-06：打印定价后台 —— 克重的计算和计价、材料、计算逻辑
          // 都在这一页配(材料库 / 计价基础 / 支撑加价的分段规则 / 交期比例 /
          // 支撑几何参数)。工具页和打印单一律跟这里走,访客改不了。
          {
            title: "打印定价",
            href: "/admin/print-pricing",
            icon: SlidersHorizontal,
          },
          // 2026-11-11：站点设置 —— 后台能改、不用重新部署的站点级设置。
          // 第一项是海外独立站(Shopify)的顾客访问地址（工作室原话：「不需要
          // 环境变量，在后台设置」）。真理源在 `site_setting` 表。
          {
            title: "站点设置",
            href: "/admin/site-settings",
            icon: Settings,
          },
          // 2026-11-13：支付设置 —— 微信 / 支付宝的**沙箱**开关、端点、凭据
          // 都在这一页配(工作室原话：「支付宝、微信支付先用沙盒测试验证」+
          // 「可以后台配置」)。真理源在 `payment_setting` 表,改完不用重新
          // 部署。⚠️ 正式模式的凭据**一个字都不动** —— 继续走环境变量。
          {
            title: "支付设置",
            href: "/admin/payment-settings",
            icon: CreditCard,
          },
        ],
      },
      {
        title: "商品管理",
        href: "/admin/product-effects",
        icon: Package,
        children: [
          {
            // 2026-10-21：商品目录（名称/描述/封面/基础价 + SKU 变体绝对价）
            // 从 product-catalog.ts 硬编码搬到 product / product_variant 表
            title: "商品",
            href: "/admin/products",
            icon: Boxes,
          },
          {
            title: "效果模板",
            href: "/admin/product-effects",
            icon: Images,
          },
          {
            title: "产品线",
            href: "/admin/product-lines",
            icon: Package,
          },
          {
            title: "生图模型",
            href: "/admin/image-models",
            icon: Wand2,
          },
          {
            title: "3D 引擎",
            href: "/admin/3d-providers",
            icon: Cpu,
          },
          {
            title: "提示词模板",
            href: "/admin/prompt-templates",
            icon: Sparkles,
          },
        ],
      },
      {
        title: "外部生图",
        href: "/admin/external-api-keys",
        icon: Globe,
      },
      {
        title: "系统日志",
        href: "/admin/system-logs",
        icon: ScrollText,
      },
    ],
  },
];

// ============================================
// 导出配置对象
// ============================================

/**
 * Dashboard 页面配置
 */
export const dashboardConfig = {
  sidebarNav: dashboardNav,
};

/**
 * Admin 页面配置
 */
export const adminConfig = {
  sidebarNav: adminNav,
};
