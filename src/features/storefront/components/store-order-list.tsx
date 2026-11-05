/**
 * StoreOrderList —— 「我的商城订单」
 *
 * ## 为什么这个列表在 dashboard 而不是商城里
 *
 * 商城是匿名的(逛 → 加购 → 结算要登录),订单却**必须**挂在账号名下 ——
 * Sellbase 按 email upsert customer,订单归属账号才查得回来。所以订单页
 * 放在 dashboard 这一侧。
 *
 * ## 「去支付」要能重取链接
 *
 * 未支付的订单给一个「去支付」按钮 —— 链接过期了(Sellbase 那边会换新的)
 * 或者结算时压根没生成链接(建单失败),都能在这里重新拿到。
 */

"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { formatPriceCNY } from "@/features/marketing/components/storefront/wjp-store-data";

/** 列表里的一行(可序列化的形状) */
export interface StoreOrderListItem {
  orderNo: string;
  /** 订单状态 —— 单子走到哪一步了 */
  status: "unpaid" | "paid" | "fulfilled" | "cancelled";
  /** 支付状态 —— 钱怎么样了 */
  paymentStatus: "unpaid" | "paid" | "refunded" | "failed";
  totalCents: number;
  createdAt: string;
  itemCount: number;
  /** 商品名(最多展示两个) */
  titles: string[];
  thumbnail: string | null;
}

/** 状态的显示文案 + 颜色 */
const STATUS_META: Record<
  StoreOrderListItem["status"],
  { label: string; className: string }
> = {
  unpaid: { label: "待支付", className: "text-accent" },
  paid: { label: "已支付", className: "text-primary" },
  fulfilled: { label: "已发货", className: "text-primary" },
  cancelled: { label: "已取消", className: "text-muted-foreground" },
};

/** 支付状态里那些「订单状态表达不了」的情况 */
const PAYMENT_META: Record<
  Extract<
    StoreOrderListItem["paymentStatus"],
    "refunded" | "failed" | "unpaid"
  >,
  { label: string; className: string }
> = {
  refunded: { label: "已退款", className: "text-muted-foreground" },
  failed: { label: "支付失败", className: "text-destructive" },
  unpaid: { label: "待支付", className: "text-accent" },
};

/**
 * 显示哪个标签 —— **支付状态优先**
 *
 * 一单退了款,订单状态还是「已支付」(单子还在),但用户要看到的是「已退款」。
 * 反过来一单支付失败了,订单状态是「未支付」,但文案该说「支付失败」。
 */
function resolveOrderMeta(order: StoreOrderListItem): {
  label: string;
  className: string;
} {
  if (order.paymentStatus !== "paid") {
    return PAYMENT_META[order.paymentStatus];
  }
  return STATUS_META[order.status];
}

export function StoreOrderList({ orders }: { orders: StoreOrderListItem[] }) {
  if (orders.length === 0) {
    return (
      <div className="text-center py-16">
        <h2 className="font-serif text-xl mb-2">还没有订单</h2>
        <p className="text-sm text-muted-foreground">
          在商城里挑一个作品,付完款就能在这里看到进度。
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-4">
      {orders.map((order) => (
        <OrderRow key={order.orderNo} order={order} />
      ))}
    </ul>
  );
}

function OrderRow({ order }: { order: StoreOrderListItem }) {
  const meta = resolveOrderMeta(order);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePay = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/store/orders/${encodeURIComponent(order.orderNo)}/payment-link`,
        { method: "POST", credentials: "include" }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.message ?? "生成支付链接失败");
        setIsLoading(false);
        return;
      }
      setPaymentUrl(body.paymentUrl ?? null);
      if (body.paymentUrl) {
        window.location.href = body.paymentUrl;
        return;
      }
      setError("没有拿到支付链接");
      setIsLoading(false);
    } catch {
      setError("生成支付链接失败");
      setIsLoading(false);
    }
  };

  return (
    <li className="border border-border rounded-sm p-4 flex gap-4 items-start">
      {order.thumbnail ? (
        <img
          src={order.thumbnail}
          alt=""
          className="size-16 object-cover rounded-sm bg-muted shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="size-16 rounded-sm bg-muted shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{order.orderNo}</span>
          <span className={`text-xs ${meta.className}`}>{meta.label}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground truncate">
          {order.titles.join(" · ")}
          {order.itemCount > order.titles.length ? " 等" : ""}
          <span className="ml-2">共 {order.itemCount} 件</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {new Date(order.createdAt).toLocaleString("zh-CN")}
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>

      <div className="text-right shrink-0">
        <p className="font-medium">{formatPriceCNY(order.totalCents / 100)}</p>
        {order.paymentStatus === "unpaid" && order.status === "unpaid" && (
          <Button
            size="sm"
            className="mt-2 rounded-full"
            onClick={handlePay}
            disabled={isLoading}
            type="button"
          >
            {isLoading && <Loader2 className="size-3.5 animate-spin" />}
            去支付
          </Button>
        )}
        {paymentUrl && (
          <a
            href={paymentUrl}
            className="mt-2 block text-xs underline text-muted-foreground"
          >
            打开支付链接
          </a>
        )}
      </div>
    </li>
  );
}
