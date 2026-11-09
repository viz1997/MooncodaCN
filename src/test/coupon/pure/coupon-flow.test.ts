import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 优惠码的**接线** —— 扫描式守卫(2026-11-08)
 *
 * ## 为什么是这个形状
 *
 * 优惠码横跨三个模块:商城、支付通道、打印工单。纯数学那一半在
 * `coupon-calc.test.ts` 里测过了;这里守的是**接线** —— 「哪个文件负责
 * 干什么」这条分工。
 *
 * 接线写错了,单测是**测不出来**的:
 *
 * - 「重新获取付款入口」少传了优惠 → 用户被**多收钱**(金额对不上账)
 * - 购物袋抽屉自己算合计 → 抽屉跟结算页显示**两个数**
 * - 结算忘了读车上的码 → 用户输的码**静默失效**
 *
 * 这些都不报错,只是数字不对 —— 所以要用**扫描**钉在源码上。
 *
 * ## 扫描的规矩
 *
 * **断言的字符串不许出现在注释里** —— `stripComments()` 会把注释去掉,
 * 但如果断言的串只存在于注释里,测试会**假通过**。所以下面每个被断言的
 * 串都是真实代码里的片段。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着「以前读常量」不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

const PAYMENT_TYPES = "src/features/payments/lib/types.ts";
const PAYMENT_TOTAL = "src/features/payments/lib/total.ts";
const WECHAT = "src/features/payments/providers/wechat/index.ts";
const ALIPAY = "src/features/payments/providers/alipay/page-pay.ts";
const SHOPIFY_DRAFT = "src/features/payments/providers/shopify/draft-order.ts";
const ORDER_PAYMENT = "src/features/storefront/lib/order-payment.ts";
const CHECKOUT = "src/features/storefront/lib/checkout.ts";
const CART_TOTALS = "src/features/storefront/lib/cart-totals.ts";
const CART_STORE = "src/features/storefront/lib/cart-store.ts";
const PENDING_ORDER = "src/features/storefront/lib/pending-order.ts";
const COUPON_CALC = "src/features/coupon/lib/coupon-calc.ts";
const COUPON_SERVICE = "src/features/coupon/lib/coupon-service.ts";
const COUPON_STORE = "src/features/coupon/lib/coupon-store.ts";
const PRINT_ORDER_ERROR = "src/features/print-quote/lib/print-order-error.ts";
const PRINT_ORDERS_ROUTE = "src/app/api/print-orders/route.ts";
const CART_DRAWER = "src/features/storefront/components/cart-drawer.tsx";
const USE_CART = "src/features/storefront/hooks/use-cart.ts";

/* -------------------------------------------------------------------------- */
/*  扫描式守卫                                                                 */
/* -------------------------------------------------------------------------- */

describe("优惠码的接线 —— 扫描式守卫", () => {
  it("① 两个 provider 的 `computeTotalCents` **共用一份**实现", () => {
    // 算式在 `payments/lib/total.ts` —— 微信和支付宝都 import 它。
    // 两份一样的代码看着省事,实则是个雷:改了一份忘了另一份,逐分相等
    // 就只在一条通道上破了 —— 而那种 bug 要等到真收钱那天才看得出来。
    const shared = stripComments(read(PAYMENT_TOTAL));

    expect(shared).toContain(
      "const discount = Math.round(request.discountCents ?? 0);"
    );
    expect(shared).toContain("return itemsTotal + shipping - discount;");
    // 两道闸也在
    expect(shared).toContain("if (discount < 0)");
    expect(shared).toContain("if (discount > itemsTotal + shipping)");

    for (const rel of [WECHAT, ALIPAY]) {
      const code = stripComments(read(rel));

      // provider **不许**再自己写一份
      expect(code, rel).not.toContain(
        "export function computeTotalCents(request: PaymentRequest): number"
      );
    }
  });

  it("② `PaymentRequest` 有 `discountCents`", () => {
    const code = stripComments(read(PAYMENT_TYPES));

    expect(code).toContain("discountCents?: number;");
  });

  it("③ `order-payment.ts` 传了 `order.couponDiscountCents`", () => {
    const code = stripComments(read(ORDER_PAYMENT));

    // 少了它,「重新获取付款入口」重建出来的总额**比订单应付多出优惠那一份**
    // ⇒ 用户被多收钱
    expect(code).toContain("discountCents: order.couponDiscountCents ?? 0,");
  });

  it("④ `checkout.ts` 读 `cart.coupon_code`", () => {
    const code = stripComments(read(CHECKOUT));

    // 码住在车上,不在结算的 body 里 —— 服务端从 DB 读
    expect(code).toContain("code: cart.couponCode,");
    // 结算时**重新校验、重新算** —— 不信车上的旧结果
    expect(code).toContain("evaluateCoupon({");
    expect(code).toContain('"COUPON_INVALID"');
  });

  it("⑤ `cart-totals.ts` **不** import `@/db`", () => {
    const code = stripComments(read(CART_TOTALS));

    // 购物袋详情页 / 结算页都是客户端组件 —— 引了 `@/db` 就炸构建
    expect(code).not.toContain("@/db");
  });

  it("⑥ `coupon-calc.ts` **零 import**", () => {
    const code = stripComments(read(COUPON_CALC));

    // 纯函数文件 —— 客户端组件也安全 import 它的类型
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/from\s+"[^"]+"/);
  });

  it("⑦ `print-order-error.ts` 含优惠码错误码", () => {
    const code = stripComments(read(PRINT_ORDER_ERROR));

    const codes = [
      "COUPON_NOT_FOUND",
      "COUPON_INACTIVE",
      "COUPON_NOT_STARTED",
      "COUPON_EXPIRED",
      "COUPON_SCOPE_MISMATCH",
      "COUPON_NOT_APPLICABLE",
      "COUPON_MIN_AMOUNT_NOT_MET",
      "COUPON_LIMIT_REACHED",
      "COUPON_PER_USER_LIMIT_REACHED",
      "COUPON_NOT_FIRST_ORDER",
    ];
    for (const c of codes) {
      expect(code, c).toContain(`${c}: "coupon.errors.${c}"`);
    }
  });

  it("⑧ `pending-order.ts` 比较 `couponCode`", () => {
    const code = stripComments(read(PENDING_ORDER));

    // 两个不同的码可能算出同一个合计 —— 只比合计会把它们当成同一单
    expect(code).toContain(
      "if ((order.couponCode ?? null) !== (params.couponCode ?? null)) continue;"
    );
  });

  it("⑨ `removeOrderedLinesFromCarts` 清 `coupon_code`", () => {
    const src = read(CART_STORE);
    const start = src.indexOf(
      "export async function removeOrderedLinesFromCarts"
    );
    expect(start, "找不到 removeOrderedLinesFromCarts").toBeGreaterThan(-1);

    // 摘行的同时清券 —— 车空了还留着上一张券,下一单就带着它
    const body = stripComments(src.slice(start));
    expect(body).toContain(".set({ couponCode: null, updatedAt: now })");
  });

  it("⑩ `shopify/draft-order.ts` 对 `discountCents > 0` 抛错", () => {
    const code = stripComments(read(SHOPIFY_DRAFT));

    // 草稿单没有折扣的概念 —— 我们减了折扣、Shopify 按原价建单 ⇒ 对不上账
    expect(code).toContain("if ((request.discountCents ?? 0) > 0) {");
    expect(code).toContain("throw new PaymentProviderError(");
  });

  it("⑪ `cart-drawer.tsx` **不自己算**合计", () => {
    const drawer = stripComments(read(CART_DRAWER));

    // 抽屉自己加一遍 → 用了券的购物袋跟结算页必然对不上
    expect(drawer).not.toContain("subtotalCents + shippingCents");
    // 合计从 hook 里拿
    expect(drawer).toContain("totalCents,");

    const hook = stripComments(read(USE_CART));
    expect(hook).toContain("totalCents: totals.totalCents,");
    // hook 用的是**同一份**口径
    expect(hook).toContain("computeCartTotals(items, coupon)");
  });

  /* ---------------------------------------------------------------------- */
  /*  2026-11-08 复查补的四条                                                 */
  /* ---------------------------------------------------------------------- */

  it("⑫ `checkout.ts` **复用排在判资格之前**", () => {
    const code = stripComments(read(CHECKOUT));

    const reuseIdx = code.indexOf("findReusablePendingOrder({");
    const checkIdx = code.indexOf("evaluateCoupon({");

    expect(reuseIdx, "找不到复用那一步").toBeGreaterThan(-1);
    expect(checkIdx, "找不到判资格那一步").toBeGreaterThan(-1);

    // 顺序反了会出事:首单券建的那张单已经算作「下过单」⇒ 再判一次就是
    // `NOT_FIRST_ORDER` ⇒ **用户连自己那张单都付不了**
    expect(reuseIdx, "复用必须排在判资格之前").toBeLessThan(checkIdx);
  });

  it("⑬ `checkout.ts` 记用券在**建单的事务里**", () => {
    const code = stripComments(read(CHECKOUT));

    const txIdx = code.indexOf("db.transaction(async (tx) => {");
    const redeemIdx = code.indexOf("redeemCoupon({");

    expect(txIdx, "找不到建单事务").toBeGreaterThan(-1);
    expect(redeemIdx, "找不到记用券那一步").toBeGreaterThan(txIdx);

    // 记账跟建单**必须同生共死** —— 额度是硬闸,超发要能回滚订单
    const call = code.slice(redeemIdx, redeemIdx + 400);
    expect(call).toContain("tx,");
  });

  it("⑭ 券的总量上限是**硬闸** —— 超发就抛", () => {
    const code = stripComments(read(COUPON_STORE));

    expect(code).toContain("export class CouponUsageLimitError");
    // 记下了用券但额度没加上 = 超发 ⇒ 这一单不能成立
    expect(code).toContain(
      "if (!usageIncremented && params.usageLimit != null) {"
    );
    expect(code).toContain("throw new CouponUsageLimitError();");
    // 不传 tx 时自己开一个事务 —— 插入和自增同生共死
    expect(code).toContain("params.tx ? run(params.tx) : db.transaction(run)");
  });

  it("⑮ 打印工单那条路:建单 + 记用券**同一个事务**,额度满了回 400", () => {
    const code = stripComments(read(PRINT_ORDERS_ROUTE));

    expect(code).toContain("row = await db.transaction(async (tx) => {");
    expect(code).toContain("usageLimit: coupon.coupon.usageLimit,");
    expect(code).toContain('error: "COUPON_LIMIT_REACHED"');
    // 折扣 0 的券**也记账** —— 两个口子口径必须一样
    expect(code).not.toContain("couponDiscountCents > 0");
  });

  it("⑯ `evaluateCouponEffect` **不判资格**", () => {
    const code = stripComments(read(COUPON_SERVICE));

    const start = code.indexOf("export async function evaluateCouponEffect");
    expect(start, "找不到 evaluateCouponEffect").toBeGreaterThan(-1);
    const body = code.slice(start, start + 1500);

    // 它只回答「这张券能减多少」—— 判资格是 `evaluateCoupon` 的事
    expect(body).not.toContain("checkCouponApplicable");
    expect(body).not.toContain("countUserCouponRedemptions");
    expect(body).not.toContain("userHasAnyOrder");
  });

  it("⑰ 购物袋兜底价**保留阶梯折扣**", () => {
    const code = stripComments(read(CART_STORE));

    // `row.unit_price_cents` 存的是**折前**单价 —— 直接拿来当折后单价,
    // 「买 10 件减 10%」那一档就丢了 ⇒ 购物袋摆的价比结算收的价高
    expect(code).toContain("computeQuantityDiscount(");
  });
});
