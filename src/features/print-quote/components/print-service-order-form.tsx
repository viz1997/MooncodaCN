"use client";

/**
 * 打印服务的下单表单 —— **展开在工作台下面**,不是弹窗
 *
 * ## 为什么在下面,不在这张卡里
 *
 * 这张卡在右栏,只有 320px 宽。表单要装的东西不少:称呼 / 电话 / 备注 /
 * 收货地址(还要能新建)/ 交期三档 / 支付方式 / 打印须知 —— 塞进 320px 会挤
 * 成一列窄输入框。展开在工作台下面,一屏能看完。
 *
 * ## 表单自己不碰网络
 *
 * 收集 + 校验而已。提交时把值交给父组件(父组件负责算支撑 → 打包模型 → 直传
 * R2 → 建工单)。这里**不自己算价**,也不自己上传。
 *
 * ## 收货地址是**必填**
 *
 * 工作室照着单子寄出去 —— 没有收货地址的单子没法开工(2026-11-06 工作室自己
 * 提的:旧那条路只收称呼 + 电话,「照着单子寄不出去」)。
 *
 * **只把地址 id 交上去** —— 地址内容由服务端从地址簿解析,归属校验在数据
 * 层(`address/queries.ts` 的 `getUserAddress` 按 userId 过滤)。客户端带来
 * 什么地址内容都不采信。
 *
 * ## 交期加价:比例由服务端给
 *
 * 三档的比例在报价里带回来(`quote.deliveryRates`),前端不自己认一份 ——
 * 服务端的比例可以用环境变量改,两边各认一份就会出现「页面写 +¥20.65、实际
 * 收 ¥19.85」。选档位之后要**重新去服务端报价**(父组件做)。
 */

import { AlertCircle, Loader2, Lock, Package, ShieldAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AddressSection } from "@/features/address/components/address-section";
import type { AddressView } from "@/features/address/types";
import type {
  CouponErrorCode,
  CouponView,
} from "@/features/coupon/lib/coupon-calc";
import { PaymentChannelPicker } from "@/features/payments/components/payment-channel-picker";
import { DeliveryTierPicker } from "@/features/print-quote/components/delivery-tier-picker";
import type {
  DeliveryRates,
  DeliveryTierId,
} from "@/features/print-quote/lib/delivery-tier";
import { formatCents } from "@/features/print-quote/lib/format";
import type { PrintQuote } from "@/features/print-quote/lib/quote-types";
import { Link } from "@/i18n/routing";

/** 表单收集到的那些值 */
export type PrintServiceOrderValues = {
  contactName: string;
  contactPhone: string;
  note: string;
  addressId: string;
  deliveryTier: DeliveryTierId;
  channel: string | null;
  /**
   * 优惠码(2026-11-08)
   *
   * 只传**码** —— 折扣是服务端算的(能被改)。空 = 不用券。
   */
  couponCode: string;
};

export type PrintServiceOrderFormProps = {
  /** 服务端算的报价 —— null = 还没报价 */
  quote: PrintQuote | null;
  /** 三档的加价比例 —— 服务端报价里带回来的 */
  rates: DeliveryRates | null;
  /** 选中的交期档位 */
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
  /**
   * 优惠码(2026-11-08)—— 用户输的码
   *
   * null = 还没输 / 摘掉了。
   */
  couponCode: string | null;
  /**
   * 优惠效果 —— **服务端算好的快照**
   *
   * null = 没有码,或者券不可用。
   */
  coupon: CouponView | null;
  /**
   * 券不可用的精确原因码 —— null = 没有码,或者券完全可用
   */
  couponError: CouponErrorCode | null;
  /**
   * 应用 / 摘掉优惠码 —— 父组件去问服务端要新的报价
   *
   * 传空串 = 摘掉。
   */
  onApplyCoupon: (code: string) => void;
  /** 提交 —— 父组件负责算支撑 + 上传 + 建单 */
  onSubmit: (values: PrintServiceOrderValues) => void;
  /** 收起表单 */
  onCancel: () => void;
};

export function PrintServiceOrderForm({
  quote,
  rates,
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
  couponCode,
  coupon,
  couponError,
  onApplyCoupon,
  onSubmit,
  onCancel,
}: PrintServiceOrderFormProps) {
  const t = useTranslations("PrintQuote");

  // 称呼预填账号名(用户可以改),邮箱用账号邮箱且**不可改** ——
  // 服务端也只认账号邮箱,这里只是让用户看清工单会发到哪。
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  /**
   * 优惠码输入框里的内容(2026-11-08)
   *
   * **只是输入框里的字** —— 真正的码在父组件那儿(`couponCode`),折扣是
   * 服务端算的。点「应用」才把它交上去。
   */
  const [couponInput, setCouponInput] = useState(couponCode ?? "");

  const busy = phase !== "idle";

  // 下单前该读的几份 —— 打印须知 / 设计规范 / 下单提示 / 售后
  const policies = [
    { href: "/legal/print-notice", label: t("order.policyPrintNotice") },
    { href: "/legal/design-spec", label: t("order.policyDesignSpec") },
    { href: "/legal/print-order-notice", label: t("order.policyOrderNotice") },
    { href: "/legal/after-sales", label: t("order.policyAfterSales") },
  ] as const;

  /**
   * 报价小计 —— 加价的基数
   *
   * 交期加价按**小计**的比例收(不是合计 —— 拿合计当基数就是「加价里套加
   * 价」)。小计 = 合计 − 交期加价。
   */
  const subtotalCents = quote
    ? quote.totalPriceCents - quote.deliveryFeeCents
    : null;

  /**
   * 应付净额(2026-11-08)
   *
   * 报价合计 − 优惠。**折扣是服务端算的**(`coupon.discountCents`),
   * 客户端只做这一个减法 —— 减的是服务端给的数,不是自己算的价。
   */
  const couponDiscountCents = coupon?.discountCents ?? 0;
  const payableCents = quote
    ? Math.max(0, quote.totalPriceCents - couponDiscountCents)
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    if (!name.trim()) {
      setFieldError(t("order.errors.name"));
      return;
    }
    if (!addressId) {
      setFieldError(t("order.errors.address"));
      return;
    }
    setFieldError(null);
    onSubmit({
      contactName: name.trim(),
      contactPhone: phone.trim(),
      note: note.trim(),
      addressId,
      deliveryTier,
      channel,
      couponCode: couponCode ?? "",
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-xl border border-border bg-card p-5 shadow-sm"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {t("order.formTitle")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("order.formSubtitle")}
          </p>
        </div>
        {quote && (
          <div className="text-right">
            <p className="text-[11px] text-muted-foreground">
              {t("quote.total")}
            </p>
            <p className="font-mono text-lg font-semibold text-foreground">
              {formatCents(payableCents ?? quote.totalPriceCents)}
            </p>
            {couponDiscountCents > 0 ? (
              <p className="font-mono text-[11px] text-muted-foreground">
                {t("coupon.row")} -{formatCents(couponDiscountCents)}
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/*
        优惠码(2026-11-08)—— **就地展开,不开弹窗**
        - 输入框 + 「应用」/「去掉」
        - 服务端算好的折扣 / 用不了的原因,直接摆在下面
      */}
      <div className="mb-4 rounded-lg border border-border bg-muted/40 p-3">
        <label
          htmlFor="pq-coupon"
          className="mb-1.5 block text-xs font-medium text-foreground"
        >
          {t("coupon.label")}
        </label>
        <div className="flex gap-2">
          <input
            id="pq-coupon"
            type="text"
            value={couponInput}
            onChange={(e) => setCouponInput(e.target.value)}
            maxLength={64}
            disabled={busy}
            placeholder={t("coupon.placeholder")}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm uppercase outline-none transition-colors focus:border-foreground disabled:bg-muted/40"
          />
          {couponCode ? (
            <button
              type="button"
              onClick={() => {
                setCouponInput("");
                onApplyCoupon("");
              }}
              disabled={busy}
              className="shrink-0 rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
            >
              {t("coupon.remove")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onApplyCoupon(couponInput)}
            disabled={busy || !couponInput.trim()}
            className="shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {t("coupon.apply")}
          </button>
        </div>
        {couponError ? (
          <p className="mt-1.5 text-[11px] text-destructive">
            {t(`coupon.errors.${couponError}`)}
          </p>
        ) : coupon ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {t("coupon.applied", { code: coupon.code })}
            {coupon.discountCents > 0
              ? ` · ${t("coupon.row")} -${formatCents(coupon.discountCents)}`
              : ""}
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {t("coupon.hint")}
          </p>
        )}
      </div>

      {/* 模型文件 —— 让用户看清楚要上传的是什么 */}
      <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
        <Package className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">
            {modelName}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {t("order.modelUploadHint")}
          </p>
        </div>
      </div>

      {/* 交期 —— 三档的加价直接摆出来,用户确认的是「这个交期、这个价」 */}
      {rates && (
        <div className="mb-4">
          <DeliveryTierPicker
            value={deliveryTier}
            rates={rates}
            subtotalCents={subtotalCents}
            onChange={onDeliveryTierChange}
            disabled={busy}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="pq-name" label={t("order.name")} required>
          <input
            id="pq-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            disabled={busy}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-foreground disabled:bg-muted/40"
          />
        </Field>

        <Field id="pq-email" label={t("order.email")}>
          <div className="relative">
            <input
              id="pq-email"
              type="email"
              value={user.email}
              readOnly
              disabled={busy}
              className="w-full rounded-md border border-border bg-muted/40 px-3 py-2 pr-9 text-sm text-muted-foreground outline-none"
            />
            <Lock
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("order.emailLockedHint")}
          </p>
        </Field>

        <Field id="pq-phone" label={t("order.phone")}>
          <input
            id="pq-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={40}
            disabled={busy}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-foreground disabled:bg-muted/40"
          />
        </Field>

        <Field id="pq-note" label={t("order.note")}>
          <input
            id="pq-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            disabled={busy}
            placeholder={t("order.notePlaceholder")}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-foreground disabled:bg-muted/40"
          />
        </Field>
      </div>

      {/* 收货地址 —— 必填,归属校验在服务端数据层 */}
      <div className="mt-5">
        <p className="mb-2 text-xs font-medium text-foreground">
          {t("order.addressLabel")}
          <span className="ml-0.5 text-destructive">*</span>
        </p>
        <AddressSection
          addresses={addresses}
          value={addressId}
          onChange={onAddressChange}
        />
      </div>

      {(fieldError || error) && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-px size-3.5 shrink-0" />
          {fieldError ?? error}
        </p>
      )}

      {/* 支付方式 —— 没配好的通道不显示 */}
      <PaymentChannelPicker
        value={channel}
        onChange={onChannelChange}
        disabled={busy}
      />

      {/* 下单前的须知 —— 打印服务的硬性要求,不合规的模型会被退回来返工 */}
      <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900">
        <p className="flex items-start gap-1.5">
          <ShieldAlert className="mt-px size-3.5 shrink-0" />
          <span>{t("order.policyNotice")}</span>
        </p>
        <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-5">
          {policies.map((policy) => (
            <Link
              key={policy.href}
              href={policy.href}
              className="underline underline-offset-2 hover:no-underline"
            >
              {policy.label}
            </Link>
          ))}
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || !quote}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {phase === "submitting" ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t("order.submitting")}
            </>
          ) : (
            <>
              <Package className="size-4" />
              {t("order.submit")}
            </>
          )}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-border px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 disabled:opacity-50"
        >
          {t("order.cancel")}
        </button>
        <p className="text-[11px] text-muted-foreground">
          {t("order.payHint")}
        </p>
      </div>
    </form>
  );
}

/**
 * 带标签的表单字段
 *
 * label 用 `htmlFor` 显式关联输入框(而不是把 input 塞进 label 里)——
 * 读屏软件认的是显式关联,点标签也能聚焦。
 */
function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-medium text-muted-foreground"
      >
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}
