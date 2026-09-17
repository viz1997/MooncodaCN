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
    <div className="min-h-screen flex flex-col bg-background">
      <WjpStoreHeader />
      <main className="flex-1">{children}</main>
      <StoreFooter />

      {/* commerce overlays(全局挂载) */}
      <CartDrawer />
      <ProductQuickView />
      <CustomWorkshop />
    </div>
  );
}
