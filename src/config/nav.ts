import {
  Activity,
  Bot,
  Coins,
  Cpu,
  CreditCard,
  Globe,
  HardDrive,
  Headset,
  Image,
  Images,
  LayoutDashboard,
  ListOrdered,
  type LucideIcon,
  Package,
  ScrollText,
  Settings,
  Shield,
  Sparkles,
  Ticket,
  UserCog,
  Users,
  Wand2,
  Zap,
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
 * Products 下拉菜单内容
 */
export const productsNav: ProductNavGroup[] = [
  {
    title: "Core",
    items: [
      {
        title: "Authentication",
        href: "/#features",
        description: "Multi-provider auth with session management",
        icon: Shield,
      },
      {
        title: "Payments",
        href: "/#features",
        description: "Subscriptions and one-time purchases",
        icon: CreditCard,
      },
      {
        title: "Credits",
        href: "/#features",
        description: "Double-entry bookkeeping with FIFO expiration",
        icon: Coins,
      },
    ],
  },
  {
    title: "DX Platform",
    items: [
      {
        title: "Background Jobs",
        href: "/#features",
        description: "Async processing with Inngest",
        icon: Zap,
      },
      {
        title: "Internationalization",
        href: "/#features",
        description: "Multi-language with next-intl",
        icon: Globe,
      },
      {
        title: "AI Integration",
        href: "/#features",
        description: "Multi-model LLM abstraction",
        icon: Bot,
      },
    ],
  },
  {
    title: "Infrastructure",
    items: [
      {
        title: "Admin Panel",
        href: "/#features",
        description: "User and ticket management",
        icon: UserCog,
      },
      {
        title: "File Storage",
        href: "/#features",
        description: "S3/R2 cloud storage",
        icon: HardDrive,
      },
      {
        title: "Monitoring",
        href: "/#features",
        description: "Logging and error tracking",
        icon: Activity,
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
      // 已隐藏：公开生图（与 /image-gen 公开页重复）
      // { title: "Public Image Gen", href: "/image-gen", icon: Sparkles },
      {
        title: "Photos",
        href: "/dashboard/photos",
        icon: Image,
      },
      {
        title: "Effects",
        href: "/dashboard/effects",
        icon: Image,
      },
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
