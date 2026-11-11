/**
 * 海外独立站公告条 —— 顶部那一行细条,**所有语言站都出现**(2026-11-11 改的)。
 *
 * ## 为什么要有
 *
 * 工作室的独立站是**另一个 Shopify 店铺**(境外的那个),本仓库是境内站。
 * 境外访客落到本仓库之后,看到的是人民币价格、境内物流、境内客服 —— 看着
 * 就不是给他准备的。这条细条直接告诉他「境外下单请去独立站」。
 *
 * ## 三条边界
 *
 * 1. **所有语言站都出现** —— 原来只在英文站出现,工作室的口径是
 *    「**不是 en 才是,所有都要**」。「外国访客」不等于「会看英文」:
 *    中文站上也有境外买家(中文是他们的母语)。境内买家看到会不会困惑,
 *    靠**文案**解决(「中国大陆以外下单?请前往我们的海外独立站」),
 *    不靠**藏起来**。
 * 2. **没配 `NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL` 就不出现** —— 宁可没有
 *    入口,也不要一条指向空地址的死链。
 * 3. **它是 server component** —— locale 从 layout 的 `params` 拿,两端
 *    渲染出来的是同一份 HTML(不靠 `typeof window` 判断,见 MEMORY 那条)。
 *
 * ## 跟已下线的 Shopify 支付通道没关系
 *
 * `src/features/payments/providers/shopify/` 那个是**收款通道**(2026-11-05
 * 就退出 `ENABLED_PAYMENT_CHANNELS` 了),这里是**顾客访问地址**。两个
 * 变量名也刻意不一样:`SHOPIFY_STORE_DOMAIN` vs
 * `NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL`。
 */

import { getTranslations } from "next-intl/server";

import { siteConfig } from "@/config/site";

import { shouldShowInternationalStore } from "./international-store";

export async function InternationalStoreBar({ locale }: { locale: string }) {
  const url = siteConfig.internationalStoreUrl;

  // 没配地址 ⇒ 什么都不渲染(判定跟导航按钮共用同一份)
  if (!shouldShowInternationalStore(url)) return null;

  const t = await getTranslations({
    locale: locale as "en" | "zh",
    namespace: "InternationalStore",
  });

  return (
    <div className="border-b border-border/60 bg-[var(--secondary)]/70">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-2 text-[11px] tracking-wide text-muted-foreground sm:px-6 lg:px-8">
        <span>{t("bar")}</span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-[var(--primary)] underline underline-offset-2 transition-opacity hover:opacity-75"
        >
          {t("barCta")}
        </a>
      </div>
    </div>
  );
}
