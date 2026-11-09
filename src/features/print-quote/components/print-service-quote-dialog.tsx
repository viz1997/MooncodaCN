"use client";

/**
 * 报价弹窗 —— 打印前工作台里「报价」那颗按钮点开的那一层(2026-11-09)
 *
 * ## 为什么是弹窗
 *
 * 工作室的原话:**「报价不放在右侧了,直接在区域内用一个报价按钮,点击后显示
 * 报价弹窗,弹窗里面去下单」**。
 *
 * 以前是右栏一整列(288px 的「提交打印订单」卡片)—— 那一列把 3D 视口挤到
 * 只剩 ~500px(工作室的原话:「把预览区挤到了左边」)。现在:
 *
 * ```
 * /tools/workbench
 *   → 量好模型 → 视口底下那条控制条上点「报价」
 *   → 弹窗:预估报价(服务端算的)+ 下单表单
 *   → 提交 → 服务端重算报价 + 建一张 print_order
 *   → 跳 /account/print-orders/{orderNo} —— 钱在那儿付
 * ```
 *
 * ## 弹窗里摆什么
 *
 * - **预估报价**(`PrintServiceQuotePreview`)—— 问服务端要的(`POST
 *   /api/print-quote`),不是本地算的;访客能不能看由后台 `/admin/print-pricing`
 *   的「访客可见计价」开关决定
 * - **下单表单**(`PrintServiceOrderForm`)—— 称呼 / 电话 / 备注 / 收货地址 /
 *   交期 / 优惠码 / 支付方式 + 提交
 *
 * 没登录时**不摆表单** —— 工单要挂在账号名下,模型文件也落到用户自己的 R2
 * 分区里。弹窗里给一个「去登录」入口。
 *
 * ## 报价状态住在这一层
 *
 * 报价 / 交期比例 / 优惠码的结果都在弹窗里 —— **外面不留一份旧的**。留着就会
 * 出现「弹窗里摆的是上一次的价」那种不一致(改完尺寸再打开,总额还是旧的)。
 *
 * 重算期间(`input` 变了 → 重新问服务端)报价是 `null`:表单里不摆总额、提交
 * 按钮置灰。**交期比例不跟着清空** —— 它是服务端的配置,清空了整块交期选择
 * 器会闪一下。
 *
 * ## 弹窗的配色挂在 `.atelier-root` 上
 *
 * atelier 路由组把颜色 token 重定义在 `.atelier-root` 子树上,Radix 的 Dialog
 * 默认 portal 到 `document.body` —— 落在子树外面就是全站默认主题(Spruce +
 * 1.25rem 圆角),跟页面不是一个产品。所以 portal 指回 `.atelier-root`
 * (`useAtelierContainer`)。
 */

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AddressView } from "@/features/address/types";
import type {
  CouponErrorCode,
  CouponView,
} from "@/features/coupon/lib/coupon-calc";
import type { PrintServiceOrderValues } from "@/features/print-quote/components/print-service-order-form";
import { PrintServiceOrderForm } from "@/features/print-quote/components/print-service-order-form";
import { PrintServiceQuotePreview } from "@/features/print-quote/components/print-service-quote-preview";
import type {
  DeliveryRates,
  DeliveryTierId,
} from "@/features/print-quote/lib/delivery-tier";
import type {
  PrintQuote,
  PrintQuoteInput,
} from "@/features/print-quote/lib/quote-types";
import { useAtelierContainer } from "@/features/storefront/hooks/use-atelier-container";
import { Link } from "@/i18n/routing";

export type PrintServiceQuoteDialogProps = {
  /** 弹窗开着没有 */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * 当前量着的几何 —— 服务端按这组数报价
   *
   * null = 还没有模型(弹窗里什么都不摆)。
   */
  input: PrintQuoteInput | null;
  /** 选中的交期档位 —— 要带进报价 */
  deliveryTier: DeliveryTierId;
  onDeliveryTierChange: (tier: DeliveryTierId) => void;
  /** 地址簿(服务端查好传进来) */
  addresses: AddressView[];
  /** 选中的地址 id */
  addressId: string | null;
  onAddressChange: (addressId: string) => void;
  /** 当前登录用户 —— 称呼预填,邮箱只读展示 */
  user: { name: string; email: string };
  /** 模型文件名(下单时上传的那个) */
  modelName: string;
  /** 提交进度 */
  phase: "idle" | "submitting";
  /** 上一次失败的文案 */
  error: string | null;
  /** 选中的收款通道 —— null = 让服务端挑第一个可用的 */
  channel: string | null;
  onChannelChange: (channel: string) => void;
  /** 登录了吗 —— 没登录不能建工单 */
  isLoggedIn: boolean;
  /** 登录链接(带 callbackUrl,登录完回到工具页) */
  signInUrl: string;
  /** 提交 —— 父组件负责算支撑 + 上传 + 建单 */
  onSubmit: (values: PrintServiceOrderValues) => void;
};

export function PrintServiceQuoteDialog({
  open,
  onOpenChange,
  input,
  deliveryTier,
  onDeliveryTierChange,
  addresses,
  addressId,
  onAddressChange,
  user,
  modelName,
  phase,
  error,
  channel,
  onChannelChange,
  isLoggedIn,
  signInUrl,
  onSubmit,
}: PrintServiceQuoteDialogProps) {
  const t = useTranslations("PrintQuote");
  const container = useAtelierContainer();

  /**
   * 服务端报价 —— **只在这一层**
   *
   * null = 正在重新问价(或者还没问)⇒ 表单里不摆总额、提交按钮置灰。
   */
  const [quote, setQuote] = useState<PrintQuote | null>(null);

  /**
   * 三档的加价比例 —— 服务端报价里带回来的
   *
   * **重算期间不清空** —— 比例是服务端的配置,清空了整块交期选择器会闪一下。
   */
  const [rates, setRates] = useState<DeliveryRates | null>(null);

  /**
   * 优惠码(2026-11-08)
   *
   * - `couponCode` —— 用户输的码(只是**码**,不带钱)
   * - `coupon` —— 服务端算好的优惠快照(减了多少)
   * - `couponError` —— 券不可用的精确原因码
   *
   * **折扣金额是服务端算的** —— 客户端一个加法都不做(能被改)。
   */
  const [couponCode, setCouponCode] = useState<string | null>(null);
  const [coupon, setCoupon] = useState<CouponView | null>(null);
  const [couponError, setCouponError] = useState<CouponErrorCode | null>(null);

  /**
   * 报价到了 —— 抬给这一层
   *
   * `null` = 正在重新问价 —— **总额要跟着清空**,不然弹窗里会摆着上一次的
   * 价(改完尺寸再打开,总额还是旧的)。
   */
  const handleQuote = useCallback((next: PrintQuote | null) => {
    setQuote(next);
    // 交期比例只在报价到了的时候更新
    if (next) setRates(next.deliveryRates);
  }, []);

  /** 优惠结果 —— 预览组件问价时顺带带回来的 */
  const handleCoupon = useCallback(
    (nextCoupon: CouponView | null, nextError: CouponErrorCode | null) => {
      setCoupon(nextCoupon);
      setCouponError(nextError);
    },
    []
  );

  /**
   * 应用 / 摘掉优惠码
   *
   * **只是把码记下来** —— 真正算钱的是预览组件那一次问价(服务端算)。
   * 码一变,预览组件的 effect 重跑一次,新的优惠结果就回来了。
   *
   * 空串 = 摘掉。
   */
  const handleApplyCoupon = useCallback((code: string) => {
    const trimmed = code.trim();
    if (!trimmed) {
      setCouponCode(null);
      setCoupon(null);
      setCouponError(null);
      return;
    }
    setCouponCode(trimmed);
    // 上一次的结果作废 —— 新码还没问过价
    setCoupon(null);
    setCouponError(null);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        portalContainer={container}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{t("entry.quoteDialogTitle")}</DialogTitle>
          <DialogDescription>
            {isLoggedIn ? t("entry.quoteDialogDesc") : t("entry.descSignIn")}
          </DialogDescription>
        </DialogHeader>

        {/* 预估报价 —— 服务端算的,访客也能看(后台一个开关管着) */}
        <PrintServiceQuotePreview
          input={input}
          deliveryTier={deliveryTier}
          couponCode={couponCode}
          onQuote={handleQuote}
          onCoupon={handleCoupon}
        />

        {isLoggedIn ? (
          <PrintServiceOrderForm
            className="mt-0 rounded-none border-0 bg-transparent p-0 shadow-none"
            // 总额在上面那块**预估报价**里已经摆着 —— 表单头再摆一遍,
            // 两个大字号金额摞在一屏里,用户会以为算了两遍
            showTotal={false}
            quote={quote}
            rates={rates}
            deliveryTier={deliveryTier}
            onDeliveryTierChange={onDeliveryTierChange}
            addresses={addresses}
            addressId={addressId}
            onAddressChange={onAddressChange}
            user={user}
            modelName={modelName}
            phase={phase}
            error={error}
            channel={channel}
            onChannelChange={onChannelChange}
            couponCode={couponCode}
            coupon={coupon}
            couponError={couponError}
            onApplyCoupon={handleApplyCoupon}
            onSubmit={onSubmit}
            onCancel={() => onOpenChange(false)}
          />
        ) : (
          /* 没登录 —— 不摆表单(工单要挂在账号名下),给一个登录入口 */
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <Link
              href={signInUrl}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              {t("entry.signInCta")}
              <ArrowRight className="size-4" />
            </Link>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {t("entry.descSignIn")}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
