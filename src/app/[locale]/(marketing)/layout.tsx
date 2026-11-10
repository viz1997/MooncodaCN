import { Footer, Header } from "@/features/marketing/components";
import { InternationalStoreBar } from "@/features/marketing/components/storefront/international-store-bar";

/**
 * 博客 / 作品集 / 法律页那一组的 layout。
 *
 * 2026-11-10:上面加了一条**海外独立站公告条** —— 只在英文站出现,引导境
 * 外访客去工作室的另一个 Shopify 店铺。locale 从 `params` 拿(构建期就是
 * 确定的,读 params 不会把页面变成动态渲染)。
 */
export default async function MarketingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <div className="flex min-h-screen flex-col">
      {/* 海外独立站公告条 —— 只在英文站出现,挂在头上面 */}
      <InternationalStoreBar locale={locale} />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
