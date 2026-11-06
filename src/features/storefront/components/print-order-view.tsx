"use client";

/**
 * PrintOrderView —— **打印单**页(`/print-order`)
 *
 * ## 打印服务不走商城购物袋
 *
 * 工作室的要求:「模型打印是不走商城正常的购物车的,而是走打印下单,即展示
 * 打印列表和下单金额」。所以打印服务有**另一张车**(另一个 cookie
 * `wjp_print_cart_id`、另一种性质 `kind = "print"`),界面上也是**另一个
 * 页面** —— 商城购物袋(`/cart`)、抽屉、结算页里**一行打印服务都不会出现**。
 *
 * ## 这一页摆三样东西
 *
 * 1. **打印列表** —— 每个模型一行:尺寸、克重、交期档位、单价、删一行
 * 2. **下单金额** —— Σ 每行的报价(**没有运费**)
 * 3. **提交打印单** —— 一次付款,钱到了才开工单
 *
 * ## 模型的来路:克重工具
 *
 * 2026-11-06 起流程收成两步 —— 报价台(`/quote`)整页删掉,只留一个重定向到
 * 这一页:
 *
 *   /tools/weight(量重量的工具)→ 点「加入打印单」→ /print-order(这一页)
 *
 * 所以这一页的「再加一个模型」指向 `/tools/weight`,空打印单的引导也是它。
 *
 * ## 金额口径:没有运费
 *
 * 打印服务的价**就是报价本身** —— 服务端重算出来多少、工单上写多少、这里
 * 显示多少、实际收多少,是同一个数(见 `print-quote/lib/payment.ts`:工单的
 * 支付金额恒等于 `total_price_cents`)。结算时再加一笔运费,用户在打印单上
 * 看到的总价就跟实际收的钱对不上了。
 *
 * ## 付款那一块跟商城结算共用一份
 *
 * `<CheckoutPaymentPanel cartKind="print">` —— 选通道、扫码、轮询、钱到了
 * 作废缓存,都跟 `/checkout` 一套代码,只是 `cartKind` 不同。
 *
 * ## 文案:中文硬编码(跟商城那一整套一致)
 *
 * 商城这一整套交易界面(`/cart` / `/checkout` / 购物袋抽屉)目前只有中文
 * 一版 —— 仓库里从来没有过 `Cart` / `Checkout` 这样的 i18n 命名空间。
 * 这一页跟着走,别单独开一套(那会让「中文抽屉 → 英文打印单 → 中文结算页」
 * 更割裂)。
 *
 * 唯一跟着 locale 变的是两处小组件:**交期档位选择器**
 * (`PrintQuote.delivery.*`)和顶部的须知 / 规范 / 售后链接
 * (`PrintQuote.order.policy*`)—— 它们是报价台留下来的组件。跟结算页里的
 * `Payment.*` 收款文案是同一个情况:嵌在中文页面里的本地化小组件。
 */

import { Package, Printer, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { AddressSection } from "@/features/address/components/address-section";
import type { AddressView } from "@/features/address/types";
import { DeliveryTierPicker } from "@/features/print-quote/components/delivery-tier-picker";
import { DEFAULT_DELIVERY_RATES } from "@/features/print-quote/lib/delivery-tier";
import { Link } from "@/i18n/routing";
import { formatCents } from "@/lib/money";

import { usePrintCart } from "../hooks/use-print-cart";
import { PRINT_CART_KIND } from "../lib/cart-kind";
import { computeCartTotals } from "../lib/cart-totals";
import { getPrintServiceSpec } from "../lib/print-service";
import type { Cart, CartLineItem } from "../types";
import { CheckoutPaymentPanel } from "./checkout-payment-panel";

export function PrintOrderView({
  initialCart,
  addresses,
  isLoggedIn,
  signInUrl,
}: {
  /** 服务端渲染好的打印单(首屏)—— 缓存还没回来的那一瞬间用它 */
  initialCart: Cart | null;
  /** 地址簿(服务端查好传进来) */
  addresses: AddressView[];
  /** 登录了吗 —— 没登录不能提交(工单要挂在账号名下) */
  isLoggedIn: boolean;
  /** 登录链接(带 callbackUrl) */
  signInUrl: string;
}) {
  const t = useTranslations("PrintQuote");

  /**
   * 打印服务的须知 / 规范 / 售后
   *
   * 报价台(`/quote`)2026-11-06 整页删掉,这几条链接跟着挪到打印单上 ——
   * 它们是打印服务的硬性要求,下单之前就该让人看到。
   */
  const policies = [
    { href: "/legal/print-notice", label: t("order.policyPrintNotice") },
    { href: "/legal/design-spec", label: t("order.policyDesignSpec") },
    { href: "/legal/print-order-notice", label: t("order.policyOrderNotice") },
    { href: "/legal/after-sales", label: t("order.policyAfterSales") },
  ] as const;

  const {
    cart: cachedCart,
    items: cachedItems,
    isLoading,
    error,
    updateDeliveryTier,
    removePrintLine,
  } = usePrintCart();

  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? null
  );
  const [note, setNote] = useState("");

  /**
   * 缓存里的行优先,缓存还没回来就用服务端渲染好的那份
   *
   * 跟购物袋详情页一个口径(见 `cart-page-view.tsx`)。
   */
  const items = cachedCart ? cachedItems : (initialCart?.items ?? []);

  /**
   * 打印单里**只有打印服务行**
   *
   * 服务端读车的时候已经按性质过滤过了(见 `cart-store.ts` 的 `toCart()`)。
   * 这里再筛一次是防御性的 —— 万一有一行不是打印服务(老数据),它没有
   * printSpec,渲染出来会是一个没有尺寸没有交期的空行。
   */
  const printItems = useMemo(
    () => items.filter((item) => getPrintServiceSpec(item.metadata) !== null),
    [items]
  );

  /**
   * 下单金额 —— Σ 折后单价 × 数量,**没有运费**
   *
   * 在这里算而不是用 hook 里的 `totalCents`:首屏那一瞬间行可能来自服务端
   * 渲染的那份,合计也得跟着那批行走 —— 两边不一致的话,用户会看到「列了
   * 两行、合计 ¥0」。
   *
   * 口径跟结算页共用 `lib/cart-totals.ts` 的 `computeCartTotals()` ——
   * 传 `kind = "print"` 就是「打印单没有运费」那一条(跟服务端结算同一份
   * 规则,见 `pricing-constants.ts` 的 `shippingCentsForCart()`)。
   */
  const totals = useMemo(
    () => computeCartTotals(printItems, PRINT_CART_KIND),
    [printItems]
  );

  const totalCents = totals.totalCents;
  const itemCount = totals.itemCount;

  /* ---------------------------------------------------------------------- */
  /*  空打印单                                                                */
  /* ---------------------------------------------------------------------- */

  if (!isLoading && printItems.length === 0) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-20 text-center">
        <div className="size-16 rounded-full bg-secondary flex items-center justify-center mx-auto mb-5">
          <Printer className="size-7 text-muted-foreground" />
        </div>
        <h1 className="font-serif text-3xl mb-3">打印单是空的</h1>
        <p className="text-sm text-muted-foreground mb-8 max-w-xs mx-auto text-pretty">
          还没有要打印的模型 —— 去克重工具量一个,点「加入打印单」就能下单。
        </p>
        <Button asChild className="rounded-full px-7">
          <Link href="/tools/weight">去量一个模型</Link>
        </Button>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  未登录                                                                  */
  /* ---------------------------------------------------------------------- */

  if (!isLoggedIn) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h1 className="font-serif text-3xl mb-3">提交打印单需要先登录</h1>
        <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
          打印工单要挂在你的账号名下,登录后打印单里的东西还在,可以直接继续。
        </p>
        <Button asChild className="rounded-full px-7">
          <Link href={signInUrl}>去登录</Link>
        </Button>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  打印单                                                                  */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-serif text-3xl">打印单</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {itemCount} 个模型待打印
          </p>
        </div>
        {/* 想再加一个模型 —— 回克重工具量 */}
        <Button asChild variant="ghost" size="sm" className="rounded-full">
          <Link href="/tools/weight">再加一个模型</Link>
        </Button>
      </div>

      {/* 打印服务的须知 / 规范 / 售后 —— 报价台删掉后,这些挪到打印单上 */}
      <div className="mb-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
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

      <div className="grid lg:grid-cols-[1fr_360px] gap-8 lg:gap-12 items-start">
        {/* 左栏:打印列表 + 地址 */}
        <div className="space-y-10">
          {/* 打印列表 */}
          <section>
            <h2 className="eyebrow text-muted-foreground mb-4">打印列表</h2>

            {isLoading && printItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                加载中…
              </p>
            ) : (
              <ul className="divide-y divide-border border-y border-border">
                {printItems.map((item) => (
                  <PrintLineRow
                    key={item.id}
                    item={item}
                    busy={
                      updateDeliveryTier.isPending || removePrintLine.isPending
                    }
                    onTierChange={(deliveryTier) =>
                      updateDeliveryTier.mutate({
                        lineItemId: item.id,
                        deliveryTier,
                      })
                    }
                    onRemove={() =>
                      removePrintLine.mutate({ lineItemId: item.id })
                    }
                  />
                ))}
              </ul>
            )}

            {error && (
              <p className="mt-3 text-xs text-destructive">{error.message}</p>
            )}
            {(updateDeliveryTier.error || removePrintLine.error) && (
              <p className="mt-3 text-xs text-destructive">
                {(updateDeliveryTier.error ?? removePrintLine.error)?.message}
              </p>
            )}
          </section>

          {/* 收货地址 —— 跟商城结算共用一份 */}
          <section>
            <h2 className="eyebrow text-muted-foreground mb-4">收货地址</h2>
            <AddressSection
              addresses={addresses}
              value={selectedAddressId}
              onChange={setSelectedAddressId}
            />
          </section>

          {/* 留言 */}
          <section>
            <h2 className="eyebrow text-muted-foreground mb-4">留言(选填)</h2>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="材质、颜色、特殊要求…"
              className="w-full px-3 py-2 border border-border rounded-sm bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </section>
        </div>

        {/* 右栏:下单金额 + 提交 */}
        <aside className="lg:sticky lg:top-6 border border-border rounded-sm p-6 bg-card">
          <h2 className="eyebrow text-muted-foreground mb-4">下单金额</h2>

          <dl className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">小计</dt>
              <dd className="font-medium">{formatCents(totalCents)}</dd>
            </div>
            {/* 打印服务没有运费 —— 价就是报价本身 */}
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">运费</dt>
              <dd className="font-medium">
                {totals.shippingCents === 0
                  ? "无"
                  : formatCents(totals.shippingCents)}
              </dd>
            </div>
            <div className="border-t pt-3 mt-3 flex items-center justify-between">
              <dt className="uppercase tracking-[0.12em]">合计</dt>
              <dd className="font-serif text-2xl">{formatCents(totalCents)}</dd>
            </div>
          </dl>

          {/* 付款 —— 跟商城结算共用一份,只是 cartKind 不同 */}
          <CheckoutPaymentPanel
            cartKind="print"
            addressId={selectedAddressId}
            note={note}
            submitLabel="提交打印单"
          />
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  打印列表里的一行                                                            */
/* -------------------------------------------------------------------------- */

function PrintLineRow({
  item,
  busy,
  onTierChange,
  onRemove,
}: {
  item: CartLineItem;
  /** 有请求在飞 —— 按钮先禁用,免得连点 */
  busy: boolean;
  /** 切交期档位 */
  onTierChange: (tier: "standard" | "express" | "urgent") => void;
  /** 删掉这一行 */
  onRemove: () => void;
}) {
  const printSpec = getPrintServiceSpec(item.metadata);
  if (!printSpec) return null;

  const lineTotalCents = item.discountedUnitPriceCents * item.quantity;

  /**
   * 不含加价的小计 —— 三档加价的基数
   *
   * 服务端重算的时候回填了 `deliveryFeeCents`(见 `cart-store.ts` 的
   * `repriceLineItem()`),减掉就是小计。有了它才能把「48 小时 +¥20.65」这种
   * 加价摆出来 —— 用户点加急之前就知道要加多少钱。
   */
  const subtotalCents = lineTotalCents - (printSpec.deliveryFeeCents ?? 0);

  return (
    <li className="py-6">
      <div className="flex gap-4">
        {/* 打印服务行没有封面图 —— 手上有的是模型文件(一个 zip),不是图片 */}
        <div className="size-20 shrink-0 rounded-sm bg-secondary flex items-center justify-center">
          <Package className="size-7 text-muted-foreground" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="font-serif text-base leading-tight truncate">
                {printSpec.modelFileName}
              </p>
              <div className="mt-1 space-y-0.5">
                <p className="text-[11px] text-muted-foreground">
                  {printSpec.dims[0]} × {printSpec.dims[1]} ×{" "}
                  {printSpec.dims[2]} mm
                </p>
                {printSpec.materialWeightG != null && (
                  <p className="text-[11px] text-muted-foreground">
                    耗材 {printSpec.materialWeightG.toFixed(1)} g
                    {printSpec.supportWeightG != null &&
                      ` · 支撑 ${printSpec.supportWeightG.toFixed(1)} g`}
                  </p>
                )}
                {/*
                  支撑加价 —— **分段**收(工作室的规则:超 1:1 的按 0.5 元/g,
                  超 1:2 的按 1 元/g)。摆出「哪一段按哪个价收的」,用户不用
                  猜这一笔是怎么来的。

                  数字全是服务端回填的(`cart-store.ts` 的 `repriceLineItem()`),
                  客户端不重算 —— 各档 `feeCents` 之和恒等于这一行的支撑
                  加价,不会出现「加起来 ≠ 合计」。
                */}
                {(printSpec.supportFeeCents ?? 0) > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    支撑加价 {formatCents(printSpec.supportFeeCents ?? 0)}
                    {printSpec.supportFeeBands?.length
                      ? `（${printSpec.supportFeeBands
                          .map(
                            (band) =>
                              `${band.weightG.toFixed(1)} g × ${formatCents(band.priceCentsPerGram)}/g`
                          )
                          .join(" + ")}）`
                      : null}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3 shrink-0">
              <p className="text-sm font-medium">
                {formatCents(lineTotalCents)}
              </p>
              <button
                type="button"
                onClick={onRemove}
                disabled={busy}
                aria-label={`移除 ${printSpec.modelFileName}`}
                className="text-muted-foreground hover:text-destructive transition-colors p-1 disabled:opacity-50 shrink-0"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>

          {/* 交期档位 —— 跟报价台共用一个选择器 */}
          <div className="mt-4 max-w-md">
            <DeliveryTierPicker
              value={printSpec.deliveryTier}
              rates={printSpec.deliveryRates ?? DEFAULT_DELIVERY_RATES}
              subtotalCents={subtotalCents}
              onChange={onTierChange}
              disabled={busy}
            />
          </div>
        </div>
      </div>
    </li>
  );
}
