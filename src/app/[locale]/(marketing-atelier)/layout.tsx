/**
 * 根 `/` 专属 layout —— atelier 视觉 1:1 拼装 + commerce overlay 全部挂载
 * (mock Medusa 阶段,见 [[wjp-mock-medusa-storefront]])。
 *
 * 关键边界:
 *  - 此 layout 服务根 URL `/` + `/products/[handle]`(都隶属本 route group)
 *  - 其他 marketing 页(/blog /pricing /pseo /products /marketing/products)继续走
 *    `(marketing)/layout.tsx` + 现有 Header + Footer,**不受本 layout 影响**
 *  - 用 Next.js route group `(marketing-atelier)` 与 `(marketing)` 平行,达到隔离
 *    layout 目的
 *
 * 设计语言局部注入(2026-09-17 增):
 *  - NextDevTpl 全站 = Mooncode Warm Craft(Spruce + Geist + 1.25rem 大圆角)
 *  - atelier = Warm Boutique(clay + Inter + Playfair Display + 0.25rem 矩形)
 *  - 此 layout 在 `.atelier-root` 子树内重写 CSS 变量,不影响 /dashboard、
 *    /admin、/docs、/blog、/image-gen 等其他页
 *  - h1-h4 在 atelier 子树走 Playfair Display(editorial 标题感)
 *  - 字体变量由 `app/layout.tsx` 注入:`--font-atelier-inter` /
 *    `--font-atelier-serif`(命名加 atelier 前缀避免与 Geist 冲突)
 *
 * 组件来源:
 *  - 顶部:`<WjpStoreHeader />`(含 cart 按钮 / count,wire useCart)
 *  - 底部:`<StoreFooter />`(atelier `StoreFooter` 1:1 适配版,见 [[wjp-storefront-atelier-port]])
 *  - 全局 overlay(挂 mount,所有 atelier 页面可见):
 *    - `<CartDrawer />` —— 购物袋 Sheet
 *    - `<ProductQuickView />` —— 产品快速预览 Dialog
 *    - `<CustomWorkshop />` —— 4 阶段定制工作台 Dialog(Upload/Transform/Configure/Review)
 *  - 内容:`children` —— page.tsx 拼装 6 段(StoreHero / FeaturedProducts /
 *    SeriesShowcase / HowItWorks / CraftStory / CommunityWall)
 *    + `/products/[handle]/page.tsx` 渲染 `<ProductDetail />`
 */
import { StoreFooter } from "@/features/marketing/components/storefront/store-footer";
import { WjpStoreHeader } from "@/features/marketing/components/storefront/wjp-store-header";
import { CartDrawer } from "@/features/storefront/components/cart-drawer";
import { CustomWorkshop } from "@/features/storefront/components/custom-workshop";
import { ProductQuickView } from "@/features/storefront/components/product-quick-view";

export default function MarketingAtelierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* atelier 设计语言局部注入 —— 只罩本 route group 子树 */}
      <style>{`
        .atelier-root {
          --background: oklch(0.972 0.008 75);   /* bone 暖白底 */
          --foreground: oklch(0.205 0.005 60);   /* charcoal 暖墨 */
          --card: oklch(0.992 0.004 75);
          --card-foreground: oklch(0.205 0.005 60);
          --popover: oklch(0.992 0.004 75);
          --popover-foreground: oklch(0.205 0.005 60);
          --primary: oklch(0.278 0.005 60);      /* 暗墨(替 Spruce) */
          --primary-foreground: oklch(0.972 0.008 75);
          --secondary: oklch(0.945 0.012 70);
          --secondary-foreground: oklch(0.278 0.005 60);
          --muted: oklch(0.945 0.012 70);
          --muted-foreground: oklch(0.55 0.01 70);
          --accent: oklch(0.58 0.09 50);          /* clay 暖陶土主色 */
          --accent-foreground: oklch(0.985 0.005 75);
          --destructive: oklch(0.577 0.245 27.325);
          --border: oklch(0.905 0.01 70);
          --input: oklch(0.905 0.01 70);
          --ring: oklch(0.58 0.09 50);
          --radius: 0.25rem;                     /* 矩形锐角替 1.25rem 圆角 */
        }
        .atelier-root { font-family: var(--font-atelier-inter), system-ui, sans-serif; }
        .atelier-root h1,
        .atelier-root h2,
        .atelier-root h3,
        .atelier-root h4 {
          font-family: var(--font-atelier-serif), Georgia, serif;
        }
        .atelier-root ::selection {
          background-color: var(--accent);
          color: var(--accent-foreground);
        }
      `}</style>

      <div className="atelier-root min-h-screen flex flex-col bg-background text-foreground">
        <WjpStoreHeader />
        <main className="flex-1">{children}</main>
        <StoreFooter />

        {/* commerce overlays(全局挂载) */}
        <CartDrawer />
        <ProductQuickView />
        <CustomWorkshop />
      </div>
    </>
  );
}
