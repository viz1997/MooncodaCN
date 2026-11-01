import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { QuoteWorkbench } from "@/features/print-quote/components/quote-workbench";

/**
 * 打印服务报价页 —— `/quote`
 *
 * ## 为什么在 `(marketing)` 而不是 `(marketing-atelier)`
 *
 * 用户的原话是「在**商城之外**的官网也需要克重报价页面」。商城是根路由 `/`
 * (atelier 视觉 + 购物袋 + 定制工作台),官网是 Header/Footer 那一套 ——
 * 两者的视觉语言、导航、转化路径都不一样,混在一起会既不像官网也不像商城。
 *
 * 所以 `/quote` 独立落在 `(marketing)` 下:官网 Header + Footer,不带购物车,
 * 不打断「看报价 → 下单」这条路径。
 *
 * ## 页面边界
 *
 *  - 克重 / 体积 / 尺寸:浏览器本地解析,**报价阶段模型不上传**
 *  - 价格:服务端算(`POST /api/print-quote`)
 *  - 模型文件:只在用户点提交时打包直传 R2
 *
 * 跟 `/tools/weight` 的区别只有一处:那个页面是**工具**(只算不存、不显示价格),
 * 这个页面是**服务**(能报价、能下单)。
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const isZh = locale === "zh";

  const title = isZh
    ? "打印报价 — 上传模型,按克重实时算价"
    : "Print Quote — Upload a model, priced by weight";
  const description = isZh
    ? "上传 3D 模型,本地解析体积与表面积,按克重实时算出打印报价。调整尺寸、加跑智能摆盘,价格跟着变;确定要做就匿名下单,工作室一个工作日内联系你。"
    : "Upload a 3D model and get an instant print quote based on weight. Adjust the size or run smart orientation and the price follows — then place an order without an account.";

  return {
    title,
    description,
    keywords: isZh
      ? [
          "3D打印报价",
          "打印报价单",
          "克重报价",
          "PolyJet报价",
          "3D打印代工",
          "模型报价",
        ]
      : [
          "3d print quote",
          "print price estimate",
          "weight based pricing",
          "PolyJet quote",
          "3d printing service",
        ],
    openGraph: {
      title,
      description,
      type: "website",
    },
  };
}

export default async function QuotePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "PrintQuote" });

  const bullets = [
    t("page.bulletUpload"),
    t("page.bulletPrice"),
    t("page.bulletOrder"),
  ];

  return (
    <div className="container py-12 md:py-16">
      {/* 页头 */}
      <div className="mx-auto max-w-3xl text-center">
        <p className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
          {t("page.eyebrow")}
        </p>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          {t("page.title")}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          {t("page.subtitle")}
        </p>
        <ul className="mx-auto mt-6 flex max-w-2xl flex-col gap-2 text-left text-sm text-muted-foreground sm:flex-row sm:justify-center sm:gap-6">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-2">
              <span
                aria-hidden
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
              />
              {bullet}
            </li>
          ))}
        </ul>
      </div>

      {/* 报价台 */}
      <div className="mt-10 md:mt-12">
        <QuoteWorkbench />
      </div>
    </div>
  );
}
