/**
 * `/checkout/success` —— 支付成功页
 *
 * ## 为什么不是「跳回来就显示成功」
 *
 * Stripe 跳回来的那一刻,钱不一定已经到账 —— 确认消息要经过
 * 「Stripe → Sellbase → webhook → 本仓库」这一圈。落地时本地状态可能还是
 * `unpaid`。所以页面读一次初始状态,然后交给 `<CheckoutSuccessView />`
 * 轮询到状态明确为止。
 *
 * ## 订单号是**必填**的
 *
 * 没有 `?order=` 就没东西可查 —— 直接显示「缺少订单号」,不要瞎猜。
 * 订单号是本仓库和 Sellbase 之间的唯一关联标记。
 */

import { CheckoutSuccessView } from "@/features/storefront/components/checkout-success-view";
import { getUserStorefrontOrderByOrderNo } from "@/features/storefront/lib/orders";
import { getServerSession } from "@/lib/auth/server";

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: orderNo } = await searchParams;

  if (!orderNo) {
    return (
      <div className="mx-auto max-w-[560px] px-4 sm:px-6 py-16 text-center">
        <h1 className="font-serif text-3xl mb-2">缺少订单号</h1>
        <p className="text-sm text-muted-foreground">
          这个页面需要订单号才能查订单状态。
        </p>
      </div>
    );
  }

  const session = await getServerSession();
  const userId = session?.user?.id;

  // 未登录 —— 查不了(归属校验在数据层)。也让用户去登录,登录后回来。
  if (!userId) {
    return (
      <div className="mx-auto max-w-[560px] px-4 sm:px-6 py-16 text-center">
        <h1 className="font-serif text-3xl mb-2">需要登录</h1>
        <p className="text-sm text-muted-foreground">
          订单挂在你的账号名下 —— 登录后就能看到支付状态。
        </p>
      </div>
    );
  }

  const result = await getUserStorefrontOrderByOrderNo(userId, orderNo);

  if (!result) {
    return (
      <div className="mx-auto max-w-[560px] px-4 sm:px-6 py-16 text-center">
        <h1 className="font-serif text-3xl mb-2">订单不存在</h1>
        <p className="text-sm text-muted-foreground">
          订单号 {orderNo} —— 找不到这笔订单。
        </p>
      </div>
    );
  }

  const order = result.order;

  return (
    <CheckoutSuccessView
      orderNo={order.orderNo}
      initialStatus={order.status}
      initialPaymentStatus={order.paymentStatus}
      initialTotalCents={order.totalCents}
      initialPaymentUrl={order.paymentUrl}
    />
  );
}
