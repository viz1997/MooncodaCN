import { Footer, Header } from "@/features/marketing/components";
import { InternationalStoreBar } from "@/features/marketing/components/storefront/international-store-bar";

/**
 * 博客 / 作品集 / 法律页那一组的 layout。
 *
 * 2026-11-10:上面加了一条**海外独立站公告条** —— 引导境外访客去工作室的
 * 另一个 Shopify 店铺。**所有语言站都出现**(2026-11-11 工作室改的口径:
 * 「不是 en 才是,所有都要」—— 中文站上也有境外买家)。locale 从 `params` 拿
 * (构建期就是确定的,读 params 不会把页面变成动态渲染)。
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
      {/* 海外独立站公告条 —— 所有语言站都出现,挂在头上面 */}
      <InternationalStoreBar locale={locale} />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
