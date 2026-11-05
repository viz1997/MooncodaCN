import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { QuoteWorkbench } from "@/features/print-quote/components/quote-workbench";
import {
  listUserPrintOrders,
  toUserPrintOrder,
} from "@/features/print-quote/lib/order-store";
import { Link } from "@/i18n/routing";
import { auth } from "@/lib/auth";

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
 *
 * ## 2026-11-01:整页要登录
 *
 * 打印服务从匿名下单改成登录后下单 —— 订单挂在账号名下,用户在自己的
 * dashboard 页看进度。所以整个 `/quote` 页面都在登录墙后面:
 *  - proxy.ts 的 `protectedRoutes` 里加了 `/quote` —— 未登录访问会 302 到
 *    `/sign-in?callbackUrl=…`,登录后跳回本页
 *  - 这里再兜一层 RSC 校验(proxy 只看 cookie 在不在,这里是真的查库)
 *
 * 页面顺手把这个用户的最近订单查出来给报价台当首屏数据 —— 下单成功后
 * 列表能立刻多出一行,不用等刷新。
 */
export const dynamic = "force-dynamic";

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
    ? "上传 3D 模型,本地解析体积与表面积,按克重实时算出打印报价。调整尺寸、加跑智能摆盘,价格跟着变;确定要做就登录下单,工作室一个工作日内联系你。"
    : "Upload a 3D model and get an instant print quote based on weight. Adjust the size or run smart orientation and the price follows — then sign in to place the order.";

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

  // 登录墙 —— proxy 已经拦了一道,这里是真的查库
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/quote");
  }

  // 首屏就带上这个用户的最近订单 —— 报价台下单后能把新单插到列表顶部
  const rows = await listUserPrintOrders(session.user.id, 10);

  const bullets = [
    t("page.bulletUpload"),
    t("page.bulletPrice"),
    t("page.bulletOrder"),
  ];

  // 打印服务的须知 / 规范 / 售后 —— 上传模型之前就该知道这些
  const policies = [
    { href: "/legal/print-notice", label: t("order.policyPrintNotice") },
    { href: "/legal/design-spec", label: t("order.policyDesignSpec") },
    { href: "/legal/print-order-notice", label: t("order.policyOrderNotice") },
    { href: "/legal/after-sales", label: t("order.policyAfterSales") },
  ] as const;

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

        {/* 打印服务的须知 / 规范 / 售后 —— 放在上传入口正上方 */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{t("page.policyLabel")}</span>
          {policies.map((policy) => (
            <Link
              key={policy.href}
              href={policy.href}
              className="underline underline-offset-4 transition-colors hover:text-foreground"
            >
              {policy.label}
            </Link>
          ))}
        </div>
      </div>

      {/* 报价台 */}
      <div className="mt-10 md:mt-12">
        <QuoteWorkbench
          user={{
            name: session.user.name ?? "",
            email: session.user.email ?? "",
          }}
          initialOrders={rows.map(toUserPrintOrder)}
        />
      </div>
    </div>
  );
}
