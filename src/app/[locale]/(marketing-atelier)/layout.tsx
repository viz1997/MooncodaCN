/**
 * 根 `/` 专属 layout —— atelier 视觉 1:1 拼装 + commerce overlay 全部挂载
 * (本仓库的 mock commerce 阶段,见 architecture-sellbase-integration.md)。
 *
 * 关键边界:
 *  - 此 layout 服务根 URL `/` + `/product/[handle]`(都隶属本 route group)
 *  - 其他 marketing 页(/blog /pricing /pseo /products /marketing/products)继续走
 *    `(marketing)/layout.tsx` + 现有 Header + Footer,**不受本 layout 影响**
 *  - 用 Next.js route group `(marketing-atelier)` 与 `(marketing)` 平行,达到隔离
 *    layout 目的
 *
 * 设计语言局部注入(2026-10-21 重铺,参考 The Foggy Dog):
 *  - NextDevTpl 全站 = Mooncode Warm Craft(Spruce + Geist + 1.25rem 大圆角)
 *  - atelier = Soft Pastel Atelier(evergreen 墨绿 + dusty rose 玫瑰 + bone 暖纸底
 *    + Playfair Display / Noto Serif SC + 0.5rem 圆角 + 场合色带)
 *  - 此 layout 在 `.atelier-root` 子树内重写 CSS 变量,不影响 /dashboard、
 *    /admin、/docs、/blog、/image-gen 等其他页
 *  - h1-h4 在 atelier 子树走 `Playfair Display → Noto Serif SC` 字体栈:
 *    拉丁字形走 Playfair,汉字逐字形回退到中文衬线(不需要按 locale 切 CSS)
 *  - 字体变量由 `app/layout.tsx` 注入:`--font-atelier-inter` /
 *    `--font-atelier-serif` / `--font-atelier-serif-sc`(前缀避免与 Geist 冲突)
 *
 * 调色板说明:The Foggy Dog 的具体色值是二手的(官网无法在本环境抓取),
 * 所以**所有色值集中在这一个 <style> 块 + occasion-data.ts 的 wash 字段**,
 * 落地后微调色相只改这两处。
 *
 * 组件来源:
 *  - 顶部:`<WjpStoreHeader />`(含 cart 按钮 / count,wire useCart)
 *  - 底部:`<StoreFooter />`(atelier `StoreFooter` 1:1 适配版,见 [[wjp-storefront-atelier-port]])
 *  - 全局 overlay(挂 mount,所有 atelier 页面可见):
 *    - `<CartDrawer />` —— 购物袋 Sheet
 *    - `<ProductQuickView />` —— 产品快速预览 Dialog
 *    - `<CustomizeEntry />` —— 品类选择层(导航 / Hero 的「定制」入口,选完
 *      品类交给 CustomWorkshop;见 customize-entry.tsx)
 *    - `<CustomWorkshop />` —— 4 阶段定制工作台 Dialog(Upload/Transform/Configure/Review)
 *  - 四个 overlay 都把 portal 指回 `.atelier-root`(useAtelierContainer),否则
 *    Radix 的 portal 落在这个 token 子树之外,配色 / 圆角会退回全站默认主题
 *  - 内容:`children` —— page.tsx 拼装 4 段(StoreHero / OccasionShelf(四屏
 *    整屏色带,统一版式)/ HowItWorks / CraftGallery(工艺 + 真实订单合并))
 *    + `/product/[handle]/page.tsx` 渲染 `<ProductDetail />`
 */
import { InternationalStoreBar } from "@/features/marketing/components/storefront/international-store-bar";
import { StoreFooter } from "@/features/marketing/components/storefront/store-footer";
import { WjpStoreHeader } from "@/features/marketing/components/storefront/wjp-store-header";
import { CartDrawer } from "@/features/storefront/components/cart-drawer";
import { CustomWorkshop } from "@/features/storefront/components/custom-workshop";
import { CustomizeEntry } from "@/features/storefront/components/customize-entry";
import { ProductQuickView } from "@/features/storefront/components/product-quick-view";

export default async function MarketingAtelierLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // 海外独立站公告条只挂在英文站(2026-11-10)—— locale 在构建期就是确定的,
  // 所以 `/en` 的页面在构建期就不带条、`/zh` 的带。读 params **不会**把页面
  // 变成动态渲染(`[locale]/layout.tsx` 已经有 generateStaticParams)。
  const { locale } = await params;
  return (
    <>
      {/* atelier 设计语言局部注入 —— 只罩本 route group 子树 */}
      <style>{`
        .atelier-root {
          --background: oklch(0.973 0.010 85);   /* bone 暖纸底 */
          --foreground: oklch(0.245 0.014 55);   /* warm onyx 暖墨 */
          --card: oklch(0.995 0.005 85);
          --card-foreground: oklch(0.245 0.014 55);
          --popover: oklch(0.995 0.005 85);
          --popover-foreground: oklch(0.245 0.014 55);
          --primary: oklch(0.375 0.048 158);     /* evergreen 墨绿 = 锚色 */
          --primary-foreground: oklch(0.978 0.008 85);
          --secondary: oklch(0.945 0.022 88);    /* wheat 麦色 */
          --secondary-foreground: oklch(0.300 0.020 158);
          --muted: oklch(0.945 0.022 88);
          --muted-foreground: oklch(0.545 0.018 72);
          --accent: oklch(0.655 0.105 18);       /* dusty rose 玫瑰 = CTA */
          --accent-foreground: oklch(0.988 0.006 85);
          --destructive: oklch(0.577 0.245 27.325);
          --border: oklch(0.898 0.014 78);
          --input: oklch(0.898 0.014 78);
          --ring: oklch(0.655 0.105 18);
          --radius: 0.5rem;
        }
        .atelier-root { font-family: var(--font-atelier-inter), system-ui, sans-serif; font-feature-settings: "ss01", "cv11"; }
        /* Playfair 没有汉字 —— 拉丁字形走 Playfair,汉字逐字形回退到 Noto Serif SC */
        .atelier-root h1,
        .atelier-root h2,
        .atelier-root h3,
        .atelier-root h4 {
          font-family: var(--font-atelier-serif), var(--font-atelier-serif-sc), Georgia, serif;
        }
        /* 非标题元素上的衬线 —— h1-h4 规则只覆盖标题标签,大号步骤号 / 序号
           这类"当标题用"的正文元素靠这个类拿到同一套字形 */
        .atelier-root .atelier-serif {
          font-family: var(--font-atelier-serif), var(--font-atelier-serif-sc), Georgia, serif;
        }
        /* 小号大写字母间距 —— 替代各板块散落的 text-xs uppercase tracking-[0.2em] */
        .atelier-root .eyebrow {
          font-size: 0.6875rem;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          font-weight: 500;
        }
        .atelier-root ::selection {
          background-color: var(--accent);
          color: var(--accent-foreground);
        }
        /* Soft float — 给 hero 右侧主图加 6s 缓慢上下漂移,
           跟 atelier globals.css 的 @keyframes soft-float 一致 */
        @keyframes soft-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .atelier-root .animate-soft-float {
          animation: soft-float 6s ease-in-out infinite;
        }
      `}</style>

      <div className="atelier-root min-h-screen flex flex-col bg-background text-foreground">
        {/* 海外独立站公告条 —— 只在英文站出现,挂在头上面 */}
        <InternationalStoreBar locale={locale} />
        <WjpStoreHeader />
        <main className="flex-1">{children}</main>
        <StoreFooter />

        {/* commerce overlays(全局挂载) */}
        <CartDrawer />
        <ProductQuickView />
        <CustomizeEntry />
        <CustomWorkshop />
      </div>
    </>
  );
}
