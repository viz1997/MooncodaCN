/**
 * CheckoutView —— 商城结算页
 *
 * ## 金额**不在这里算**
 *
 * 页面显示的每一个数都是服务端算好传进来的(`cart.items[].discountedUnitPriceCents`
 * 那一列)。客户端不重算 —— 客户端算的数只配用来显示,收多少钱由
 * `POST /api/store/checkout` 在服务端重算一遍决定。
 *
 * ## 「新建地址」是**展开**不是弹窗
 *
 * 结算页上打断一下去弹个窗,用户填完还要再点一次回来。展开一块表单就地填,
 * 填完自动选中,少一次来回。
 *
 * ## 支付失败要说清楚
 *
 * `paymentUrl` 是 null 表示「订单建好了,但支付链接没生成」(Sellbase 那边挂了)。
 * 这时候**不是**失败 —— 订单在,状态 unpaid,用户可以在「我的订单」里重取
 * 链接。所以文案是「订单已创建,支付链接生成失败」,并给出订单号。
 */

"use client";

import { ChevronUp, Loader2, Plus, Zap } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { createAddressAction } from "@/features/address/actions";
import type { AddressErrorCode, AddressView } from "@/features/address/types";
import { formatPriceCNY } from "@/features/marketing/components/storefront/wjp-store-data";
import { Link } from "@/i18n/routing";

import { findAccessoryVariant } from "../lib/mock-catalog";
import { formatSizeWithInches } from "../lib/size-format";
import type { Cart, CartLineItem } from "../types";

/** 地址表单的失败文案 */
const ADDRESS_ERROR_TEXT: Record<AddressErrorCode, string> = {
  ADDRESS_NOT_FOUND: "地址不存在",
  INVALID_INPUT: "填写的信息不合法",
  TOO_MANY_ADDRESSES: "保存的地址太多了(最多 20 个)",
  FAILED: "保存失败,请稍后重试",
};

export function CheckoutView({
  cart,
  addresses,
  isLoggedIn,
  signInUrl,
}: {
  cart: Cart | null;
  addresses: AddressView[];
  isLoggedIn: boolean;
  /** 登录链接(带 callbackUrl) */
  signInUrl: string;
}) {
  const items = cart?.items ?? [];

  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id ?? null
  );
  const [addressList, setAddressList] = useState<AddressView[]>(addresses);
  const [showForm, setShowForm] = useState(addresses.length === 0);
  const [form, setForm] = useState(emptyAddressForm());
  const [addressError, setAddressError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const [isPaying, setIsPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [createdOrderNo, setCreatedOrderNo] = useState<string | null>(null);

  // 金额 —— 全部来自服务端算好的数
  const subtotalCents = useMemo(
    () =>
      items.reduce(
        (sum, it) => sum + it.discountedUnitPriceCents * it.quantity,
        0
      ),
    [items]
  );
  const rawSubtotalCents = useMemo(
    () => items.reduce((sum, it) => sum + it.unitPriceCents * it.quantity, 0),
    [items]
  );
  const discountCents = rawSubtotalCents - subtotalCents;
  const shippingCents = subtotalCents >= 9900 ? 0 : 800;

  const createAddress = useAction(createAddressAction, {
    onSuccess: ({ data }) => {
      if (data?.ok) {
        setAddressError(null);
        setForm(emptyAddressForm());
        setShowForm(false);
        // 新建的地址直接选中 —— 用户刚填完,意图很明确
        setSelectedAddressId(data.addressId);
        setAddressList((prev) => [
          {
            id: data.addressId,
            ...form,
            isDefault: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        return;
      }
      setAddressError(
        ADDRESS_ERROR_TEXT[(data?.code ?? "FAILED") as AddressErrorCode]
      );
    },
    onError: ({ error }) => {
      setAddressError(error.serverError ?? "保存失败,请稍后重试");
    },
  });

  const handlePay = async () => {
    if (!selectedAddressId) {
      setPayError("请先选择收货地址");
      return;
    }
    setIsPaying(true);
    setPayError(null);

    try {
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addressId: selectedAddressId,
          note: note.trim() ? note.trim() : null,
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setPayError(body?.message ?? `结算失败(HTTP ${res.status})`);
        setIsPaying(false);
        return;
      }

      if (body?.paymentUrl) {
        // 跳 Stripe —— 全页跳转,不能用 router.push(那是站内路由)
        window.location.href = body.paymentUrl;
        return;
      }

      // 订单建好了但没有支付链接 —— 给出订单号,让用户去订单页重取
      setCreatedOrderNo(body?.orderNo ?? null);
      setPayError(
        "订单已创建,但支付链接生成失败。请到「我的订单」里重新获取支付链接。"
      );
      setIsPaying(false);
    } catch {
      setPayError("结算失败,请稍后重试");
      setIsPaying(false);
    }
  };

  /* ---------------------------------------------------------------------- */
  /*  空购物车                                                                */
  /* ---------------------------------------------------------------------- */

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h1 className="font-serif text-3xl mb-3">购物袋是空的</h1>
        <p className="text-sm text-muted-foreground mb-8">
          还没有要结算的作品 —— 去挑一个吧。
        </p>
        <Button asChild className="rounded-full px-7">
          <Link href="/products">浏览作品</Link>
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
        <h1 className="font-serif text-3xl mb-3">结算需要先登录</h1>
        <p className="text-sm text-muted-foreground mb-8 max-w-md mx-auto">
          订单要挂在你的账号名下,登录后购物袋里的东西还在,可以直接继续。
        </p>
        <Button asChild className="rounded-full px-7">
          <Link href={signInUrl}>去登录</Link>
        </Button>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /*  结算                                                                    */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="font-serif text-3xl mb-8">结算</h1>

      <div className="grid lg:grid-cols-[1fr_360px] gap-8 lg:gap-12 items-start">
        {/* 左栏:商品 + 地址 */}
        <div className="space-y-10">
          {/* 商品行 */}
          <section>
            <h2 className="eyebrow text-muted-foreground mb-4">商品</h2>
            <ul className="divide-y divide-border border-y border-border">
              {items.map((item) => (
                <CheckoutLineItem key={item.id} item={item} />
              ))}
            </ul>
          </section>

          {/* 收货地址 */}
          <section>
            <h2 className="eyebrow text-muted-foreground mb-4">收货地址</h2>

            {addressList.length > 0 && (
              <ul className="space-y-3">
                {addressList.map((address) => (
                  <li key={address.id}>
                    <label
                      className={`flex gap-3 p-4 border rounded-sm cursor-pointer transition-colors ${
                        selectedAddressId === address.id
                          ? "border-primary bg-secondary/40"
                          : "border-border hover:bg-secondary/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="checkout-address"
                        value={address.id}
                        checked={selectedAddressId === address.id}
                        onChange={() => setSelectedAddressId(address.id)}
                        className="mt-1 accent-[var(--primary)]"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          {address.recipientName}
                          <span className="text-muted-foreground font-normal">
                            {address.phone}
                          </span>
                          {address.isDefault && (
                            <span className="text-[10px] uppercase tracking-[0.12em] text-accent">
                              默认
                            </span>
                          )}
                        </span>
                        <span className="block mt-1 text-xs text-muted-foreground">
                          {[
                            address.province,
                            address.city,
                            address.district,
                            address.detail,
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {/* 新建地址 —— 展开,不弹窗 */}
            <div className="mt-4">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => setShowForm((v) => !v)}
                className="rounded-full"
              >
                {showForm ? (
                  <ChevronUp className="size-4" />
                ) : (
                  <Plus className="size-4" />
                )}
                {showForm ? "收起" : "新建收货地址"}
              </Button>

              {showForm && (
                <form
                  className="mt-4 p-5 border border-border rounded-sm space-y-3 bg-secondary/20"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void createAddress.execute(form);
                  }}
                >
                  <div className="grid sm:grid-cols-2 gap-3">
                    <AddressField
                      label="收件人"
                      value={form.recipientName}
                      onChange={(v) => setForm({ ...form, recipientName: v })}
                      placeholder="张三"
                    />
                    <AddressField
                      label="手机号"
                      value={form.phone}
                      onChange={(v) => setForm({ ...form, phone: v })}
                      placeholder="13800000000"
                    />
                  </div>
                  <div className="grid sm:grid-cols-3 gap-3">
                    <AddressField
                      label="省"
                      value={form.province}
                      onChange={(v) => setForm({ ...form, province: v })}
                      placeholder="广东省"
                    />
                    <AddressField
                      label="市"
                      value={form.city}
                      onChange={(v) => setForm({ ...form, city: v })}
                      placeholder="深圳市"
                    />
                    <AddressField
                      label="区"
                      value={form.district}
                      onChange={(v) => setForm({ ...form, district: v })}
                      placeholder="南山区"
                    />
                  </div>
                  <AddressField
                    label="详细地址"
                    value={form.detail}
                    onChange={(v) => setForm({ ...form, detail: v })}
                    placeholder="科技园路 1 号 3 栋 502"
                  />

                  {addressError && (
                    <p className="text-xs text-destructive">{addressError}</p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={createAddress.isPending}
                      className="rounded-full"
                    >
                      {createAddress.isPending && (
                        <Loader2 className="size-3.5 animate-spin" />
                      )}
                      保存地址
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="rounded-full"
                      onClick={() => {
                        setForm(emptyAddressForm());
                        setAddressError(null);
                        setShowForm(false);
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </form>
              )}
            </div>

            {addressError && !showForm && (
              <p className="mt-3 text-xs text-destructive">{addressError}</p>
            )}
          </section>

          {/* 留言 */}
          <section>
            <h2 className="eyebrow text-muted-foreground mb-4">留言(选填)</h2>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="给工作室的说明,比如收货时间偏好"
              className="w-full px-3 py-2 border border-border rounded-sm bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </section>
        </div>

        {/* 右栏:金额 + 去支付 */}
        <aside className="lg:sticky lg:top-6 border border-border rounded-sm p-6 bg-card">
          <h2 className="eyebrow text-muted-foreground mb-4">订单金额</h2>

          <dl className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">小计</dt>
              <dd className="font-medium">
                {formatPriceCNY(subtotalCents / 100)}
              </dd>
            </div>
            {discountCents > 0 && (
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">数量折扣</dt>
                <dd className="font-medium text-accent">
                  -{formatPriceCNY(discountCents / 100)}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">运费</dt>
              <dd className="font-medium">
                {shippingCents === 0
                  ? "免运费"
                  : formatPriceCNY(shippingCents / 100)}
              </dd>
            </div>
            <div className="border-t pt-3 mt-3 flex items-center justify-between">
              <dt className="uppercase tracking-[0.12em]">合计</dt>
              <dd className="font-serif text-2xl">
                {formatPriceCNY((subtotalCents + shippingCents) / 100)}
              </dd>
            </div>
          </dl>

          {payError && (
            <div className="mt-4 p-3 border border-destructive/40 bg-destructive/5 rounded-sm text-xs text-destructive">
              {payError}
              {createdOrderNo && (
                <p className="mt-1 text-muted-foreground">
                  订单号:{createdOrderNo}
                </p>
              )}
            </div>
          )}

          <Button
            size="lg"
            onClick={handlePay}
            disabled={isPaying || !selectedAddressId}
            className="w-full mt-5 rounded-full h-12 uppercase tracking-[0.14em] text-[12px] font-medium"
            type="button"
          >
            {isPaying && <Loader2 className="size-4 animate-spin" />}
            去支付
          </Button>

          <p className="text-[11px] text-muted-foreground text-center mt-3">
            提交后跳转在线支付,付款完成才开始制作。
          </p>
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  子组件                                                                     */
/* -------------------------------------------------------------------------- */

function CheckoutLineItem({ item }: { item: CartLineItem }) {
  const accessoryNames = (item.metadata.accessoryVariantIds ?? [])
    .map((id) => findAccessoryVariant(id)?.name)
    .filter((n): n is string => Boolean(n));

  return (
    <li className="flex gap-4 py-5">
      <img
        src={item.productThumbnail}
        alt={item.productTitle}
        className="size-24 object-cover rounded-sm bg-muted shrink-0"
        loading="lazy"
      />
      <div className="flex-1 min-w-0">
        <p className="font-serif text-[15px] leading-tight">
          {item.productTitle}
        </p>
        <div className="mt-1 space-y-0.5">
          {item.metadata.sizeCm > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {formatSizeWithInches(item.metadata.sizeCm)}
            </p>
          )}
          {accessoryNames.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {accessoryNames.join(" · ")}
            </p>
          )}
          {item.metadata.engravingText && (
            <p className="text-[11px] text-muted-foreground italic">
              &ldquo;{item.metadata.engravingText}&rdquo;
            </p>
          )}
          {item.metadata.rushOrder && (
            <p className="text-[10px] uppercase tracking-[0.12em] text-accent mt-1 inline-flex items-center gap-1">
              <Zap className="size-3" />
              加急
            </p>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">× {item.quantity}</p>
      </div>
      <p className="text-sm font-medium shrink-0">
        {formatPriceCNY((item.discountedUnitPriceCents * item.quantity) / 100)}
      </p>
    </li>
  );
}

function AddressField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.12em] text-muted-foreground mb-1">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-border rounded-sm bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/*  工具                                                                       */
/* -------------------------------------------------------------------------- */

function emptyAddressForm() {
  return {
    recipientName: "",
    phone: "",
    province: "",
    city: "",
    district: "",
    detail: "",
  };
}
