import {
  Award,
  BookOpen,
  Box,
  Briefcase,
  Cpu,
  Frame,
  Globe,
  Headset,
  Image,
  Images,
  KeyRound,
  LayoutDashboard,
  ListOrdered,
  type LucideIcon,
  Magnet,
  Package,
  ScrollText,
  Settings,
  Shield,
  Sparkles,
  Ticket,
  Users,
  Wand2,
} from "lucide-react";

/**
 * 导航链接类型
 */
export interface NavItem {
  title: string;
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

/**
 * Products 下拉菜单项类型
 */
export interface ProductNavItem {
  title: string;
  href: string;
  description: string;
  icon: LucideIcon;
}

/**
 * Products 下拉菜单分组类型
 */
export interface ProductNavGroup {
  title: string;
  items: ProductNavItem[];
}

// ============================================
// Marketing 导航配置
// ============================================

/**
 * Products 下拉菜单内容 —— WJP 全彩 3D 打印真实品类
 *
 * 3 列 × 2 项：周边配饰 / 桌面展示 / 收藏礼品，覆盖 src/features/products/lib/data.ts
 * 里所有 ProductCategory（badge/keychain/fridge-magnet/figure/standee/gift）。
 * 全部跳 /products 作品集页，由页内的 category chip 做进一步筛选。
 */
export const productsNav: ProductNavGroup[] = [
  {
    title: "Wearables",
    items: [
      {
        title: "Keychain",
        href: "/products",
        description: "30-80mm 全彩挂件",
        icon: KeyRound,
      },
      {
        title: "Badge",
        href: "/products",
        description: "30-50mm 胸针佩戴",
        icon: Award,
      },
    ],
  },
  {
    title: "Desk",
    items: [
      {
        title: "Magnet",
        href: "/products",
        description: "40-60mm 磁吸贴",
        icon: Magnet,
      },
      {
        title: "Standee",
        href: "/products",
        description: "80-150mm 桌面立牌",
        icon: Image,
      },
    ],
  },
  {
    title: "Collectibles",
    items: [
      {
        title: "Figure",
        href: "/products",
        description: "100-200mm 桌面摆件",
        icon: Box,
      },
      {
        title: "Gift Set",
        href: "/products",
        description: "礼盒包装 + 定制卡片",
        icon: Package,
      },
    ],
  },
];

/**
 * 主导航链接 (Header)
 */
export const mainNav: NavItem[] = [
  { title: "Gallery", href: "/products" },
  { title: "Image Gen", href: "/image-gen" },
  { title: "Docs", href: "/docs" },
  { title: "Pricing", href: "/#pricing" },
  { title: "Blog", href: "/blog" },
];

/**
 * Footer 导航配置
 */
export const footerNav = {
  /** 产品 (Product) */
  product: [
    { title: "Pricing", href: "/#pricing" },
    { title: "Changelog", href: "/blog" },
    {
      title: "Contact Us",
      href: `mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "hello@example.com"}`,
    },
  ] as NavItem[],

  /** 法律 (Legal) */
  legal: [
    { title: "Terms of Service", href: "/legal/terms" },
    { title: "Privacy Policy", href: "/legal/privacy" },
    { title: "Cookie Policy", href: "/legal/cookie-policy" },
  ] as NavItem[],
};

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
      // 已隐藏：公开生图（与 /image-gen 公开页重复）
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
      {
        // 2026-08-23：代理商业务（飞书 docx「链接生成管理系统」），
        // ToB 订单归因与代理商档案管理。与商品管理并列。
        title: "代理商管理",
        href: "/admin/agents",
        icon: Briefcase,
      },
      {
        title: "商品管理",
        href: "/admin/product-effects",
        icon: Package,
        children: [
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
        ],
      },
      {
        title: "外部生图",
        href: "/admin/external-api-keys",
        icon: Globe,
      },
      {
        title: "GPT-Image",
        href: "/admin/prompt-templates",
        icon: Sparkles,
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
 * Marketing 页面配置
 */
export const marketingConfig = {
  mainNav,
  footerNav,
};

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
