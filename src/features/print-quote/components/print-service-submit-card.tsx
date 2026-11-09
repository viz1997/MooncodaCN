"use client";

/**
 * 「提交打印订单」那张卡 —— 挂在打印前工作台(`/tools/workbench`)的右栏
 *
 * ## 它是打印服务的**入口**,不是报价条
 *
 * 工作室的流程(2026-11-08 改):
 *
 *   /tools/workbench(量重量的工具,公开)
 *     → 量好 → 点「填写下单信息」
 *     → 表单展开在下面(收货地址 / 交期 / 支付方式)
 *     → 提交 → 服务端重算报价 + 建一张打印工单
 *     → 跳 `/account/print-orders/{orderNo}` —— 钱在那儿付
 *
 * ## 打印服务**不进商城购物袋**(2026-11-08)
 *
 * 工作室的原话:**「不要放入购物车,放在这里 account/print-orders」**。
 *
 * 商城购物袋只装**目录商品**(钥匙扣 / 冰箱贴 / 相框 …),打印服务是**另一
 * 条线**:工单自己建、自己收款(微信扫码 / 支付宝跳转),钱在工单详情页付。
 *
 * 2026-11-08 之前那一版是「打印服务并进商城购物袋」—— 打印服务行是购物袋里
 * 的一行,钱由商城订单一次收。现在**分家了**:工单详情页给回付款入口
 * (`decidePrintOrderPaymentEntry()`:独立工单 → 给入口;跟着商城订单结的旧
 * 工单 → 409 `PAY_VIA_STOREFRONT`)。
 *
 * ## 工具里不自己算价
 *
 * 价格是服务端算的。这张卡上摆的**预估价**是问服务端要的
 * (`POST /api/print-quote`),不是本地算的;访客能不能看由后台
 * `/admin/print-pricing` 的「访客可见计价」开关决定。
 *
 * ## 登录:**在量之前**登录
 *
 * 下单要登录 —— 工单挂在账号名下,模型文件也落到用户自己的 R2 分区里
 * (归属校验按那个分区算)。
 *
 * 没登录时按钮不是灰的,而是「去登录」:**登录那一下是整页跳转**,浏览器里的
 * 模型会没。所以文案写的是「先登录再量」,而不是让人量完再被弹去登录。
 */

import { ArrowRight, ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";

import type {
  CouponErrorCode,
  CouponView,
} from "@/features/coupon/lib/coupon-calc";
import { PrintServiceQuotePreview } from "@/features/print-quote/components/print-service-quote-preview";
import type { DeliveryTierId } from "@/features/print-quote/lib/delivery-tier";
import type {
  PrintQuote,
  PrintQuoteInput,
} from "@/features/print-quote/lib/quote-types";
import { Link } from "@/i18n/routing";

export type PrintServiceSubmitCardProps = {
  /**
   * 当前量着的几何 —— 服务端按这组数报价
   *
   * null = 还没有模型(什么都不摆)。
   */
  input: PrintQuoteInput | null;
  /**
   * 选中的交期档位 —— 要带进报价
   *
   * 用户选的那一档,预估价就得按那一档算 —— 否则卡片上摆的数跟用户选的对不上。
   */
  deliveryTier: DeliveryTierId;
  /**
   * 把报价抬给父组件
   *
   * 父组件要拿 `quote.deliveryRates`(三档的比例)摆交期选择器 —— 比例只能
   * 由服务端给,前端不自己认一份。
   */
  onQuote?: (quote: PrintQuote | null) => void;
  /**
   * 优惠码(2026-11-08)
   *
   * 带了它去问价,服务端顺带算这张码能减多少。null = 没用券。
   */
  couponCode?: string | null;
  /**
   * 把优惠结果抬给父组件(2026-11-08)
   *
   * `coupon` = 服务端算好的优惠快照;`error` = 券不可用的精确原因码。
   */
  onCoupon?: (coupon: CouponView | null, error: CouponErrorCode | null) => void;
  /** 展开下单表单 —— 父组件把表单摆在工作台下面 */
  onStart: () => void;
  /** 表单已经展开了 */
  formOpen: boolean;
  /** 登录了吗 —— 没登录不能建工单 */
  isLoggedIn: boolean;
  /** 登录链接(带 callbackUrl,登录完回到工具页) */
  signInUrl: string;
};

export function PrintServiceSubmitCard({
  input,
  deliveryTier,
  onQuote,
  couponCode,
  onCoupon,
  onStart,
  formOpen,
  isLoggedIn,
  signInUrl,
}: PrintServiceSubmitCardProps) {
  const t = useTranslations("PrintQuote");

  /** 模型和几何都在才算「能填单」 */
  const ready = Boolean(input);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
        <span className="text-xs font-medium text-foreground">
          {t("entry.title")}
        </span>
      </div>

      <div className="space-y-2 p-3">
        <p className="text-xs text-muted-foreground">
          {isLoggedIn ? t("entry.desc") : t("entry.descSignIn")}
        </p>

        {/* 预估报价(2026-11-07)—— 访客也能看,后台一个开关管着 */}
        <PrintServiceQuotePreview
          input={input}
          deliveryTier={deliveryTier}
          couponCode={couponCode}
          onQuote={onQuote}
          onCoupon={onCoupon}
        />

        {isLoggedIn ? (
          <button
            type="button"
            onClick={onStart}
            disabled={!ready}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {formOpen ? t("order.continueEditing") : t("order.start")}
            <ArrowRight className="size-3.5" />
          </button>
        ) : (
          <Link
            href={signInUrl}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t("entry.signInCta")}
            <ArrowRight className="size-3.5" />
          </Link>
        )}

        <p className="text-[10px] text-muted-foreground">
          {ready ? t("entry.ready") : t("entry.empty")}
        </p>

        {formOpen ? (
          <p className="flex items-start gap-1 text-[10px] text-muted-foreground">
            <ClipboardList className="mt-px size-3 shrink-0" />
            {t("entry.formHint")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
