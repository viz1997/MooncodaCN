/**
 * 根 `/` 专属 layout —— atelier 视觉 1:1 拼装,commerce overlay (cart / currency /
 * payment) 全部不在此处(commerce 在 Medusa,见 [[mooncada-medusa-integration]])。
 *
 * 关键边界:
 *  - 此 layout 仅服务根 URL `/`(当前没有其他 page.tsx 在本 route group 下)
 *  - 其他 marketing 页(/blog /pricing /pseo /products /marketing/products)继续走
 *    `(marketing)/layout.tsx` + 现有 Header + Footer,**不受本 layout 影响**
 *  - 用 Next.js route group `(marketing-atelier)` 与 `(marketing)` 平行,达到隔离
 *    layout 目的 —— 同 URL 级别(`/`)只能有一个 page.tsx 在一个 group 内,所以根
 *    `/(marketing)/page.tsx` 必须迁到本 group
 *
 * 组件来源:
 *  - 顶部:`<WjpStoreHeader />`(atelier `StoreHeader` 视觉版,commerce 已剥)
 *  - 底部:`<StoreFooter />`(atelier `StoreFooter` 1:1 适配版,见 [[wjp-storefront-atelier-port]])
 *  - 内容:`children` —— page.tsx 拼装 6 段(StoreHero / FeaturedProducts /
 *    SeriesShowcase / HowItWorks / CraftStory / CommunityWall)
 */
import { StoreFooter } from "@/features/marketing/components/storefront/store-footer";
import { WjpStoreHeader } from "@/features/marketing/components/storefront/wjp-store-header";

export default function MarketingAtelierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <WjpStoreHeader />
      <main className="flex-1">{children}</main>
      <StoreFooter />
    </div>
  );
}
