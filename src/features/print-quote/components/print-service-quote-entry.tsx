"use client";

/**
 * 打印服务 —— 「报价下单」入口卡片
 *
 * 挂在克重工具(`/tools/weight`)的右栏(计算器的插槽位)。
 *
 * ## 它只做一件事
 *
 * 给一个通往报价台(`/quote`)的口子。工具页是**工具**:只算不存、不显示价格、
 * 模型不上传服务器 —— 价格、交期、下单全在报价台那一条路上。
 *
 * 2026-11-05 工具页上挂过「报价 + 交期 + 加入购物车」那一整套(跟 `/quote`
 * 平行的一份),2026-11-06 按工作室要求撤掉:工具里不该直接放那些下单控件,
 * 只留一个入口。
 *
 * ## 模型接力
 *
 * 点下去的时候把「量好的那个模型」交给报价台(`lib/model-handoff.ts`),
 * 用户不用在报价台重新选一遍文件。接力只在**客户端跳转**里成立 ——
 * 整页刷新、或者未登录被弹去登录页,接力都会作废(卡片上写明了)。
 */

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import type { PricingModelPayload } from "@/features/pricing/components/pricing-calculator-types";
import { stashPendingModel } from "@/features/print-quote/lib/model-handoff";
import { Link } from "@/i18n/routing";

export type PrintServiceQuoteEntryProps = {
  /** 工具里当前量着的模型 —— 有就带过去,没有就空着过去 */
  model: PricingModelPayload | null;
  /** 登录了吗 —— 没登录会先被弹去登录页,接力会丢 */
  isLoggedIn: boolean;
};

export function PrintServiceQuoteEntry({
  model,
  isLoggedIn,
}: PrintServiceQuoteEntryProps) {
  const t = useTranslations("PrintQuote");

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
        <span className="text-xs font-medium text-foreground">
          {t("entry.title")}
        </span>
      </div>

      <div className="space-y-2 p-3">
        <p className="text-xs text-muted-foreground">{t("entry.desc")}</p>

        <Link
          href="/quote"
          onClick={() => stashPendingModel(model)}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t("entry.cta")}
          <ArrowRight className="size-3.5" />
        </Link>

        <p className="text-[10px] text-muted-foreground">
          {model ? t("entry.carry") : t("entry.empty")}
        </p>

        {!isLoggedIn && (
          <p className="text-[10px] text-muted-foreground">
            {t("entry.signIn")}
          </p>
        )}
      </div>
    </div>
  );
}
