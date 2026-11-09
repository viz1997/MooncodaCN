import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { computeTotalCents } from "@/features/payments/lib/total";
import type { PaymentRequest } from "@/features/payments/lib/types";
import { computeTotalCents as computeAlipayTotal } from "@/features/payments/providers/alipay/page-pay";

/**
 * 优惠码的**逐分相等**(2026-11-08)
 *
 * ## 为什么这是最要紧的一条
 *
 * 优惠码是**订单级**的:折扣不减在任何一行的单价上,而是减整单。而收银台
 * 的总额是**从各行算出来的**:
 *
 * - 微信 Native 只发 `amount.total`(没有 `goods_detail`)
 * - 支付宝的 `biz_content` 只有 `total_amount`(没有 `goods_detail`)
 *
 * ⇒ 通道只能从**总额**里减一次:
 *
 * ```
 * total = Σ(折后单价 × 数量) + 运费 − discountCents
 * ```
 *
 * 而订单那一侧记的是:
 *
 * ```
 * storefront_order.total_cents = 折后小计 − 数量折扣 − 优惠 + 运费
 * ```
 *
 * 两边**必须一分不差** —— 差一分钱就是对不上账。
 *
 * ## 两个通道是**一份实现**(2026-11-08 改的)
 *
 * 这个算式以前在微信和支付宝的 provider 文件里**各写了一份**。两份一样的
 * 代码看着省事,实则是个雷:改了一份忘了另一份,逐分相等就只在一条通道上破了
 * —— 而那种 bug 要等到真收钱那天才看得出来。
 *
 * ⇒ 算式拎到 `payments/lib/total.ts`,两个 provider 都 import 它。
 * **「两个通道一致」这条不变式从「两份代码要手动同步」变成「结构上只有一份」。**
 *
 * 这也是这个测试文件**只 import 共享模块**的原因 —— 微信那一支的 provider
 * 入口会把 `@/db` 拖进来(`./webhook` → `settle.ts` → `@/db`),而 `unit`
 * project 没有 `DATABASE_URL`,import 就炸。共享模块是纯的,能直接测。
 *
 * ## 为什么不按比例摊到各行单价上
 *
 * 行小计 = 单价 × 数量,摊完要除回单价,**除不尽**(100 分摊到 3 件 =
 * 33.33),单价必须是整数 ⇒ 摊不平。而且摊分会引入 `round` 误差,
 * `Σ round(xᵢ)` 跟 `round(Σ xᵢ)` 不一定相等。
 *
 * 纯函数,不需要 DB / 网络。
 */

/* -------------------------------------------------------------------------- */
/*  夹具                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 一次支付请求 —— 只有跟金额有关的字段要紧
 *
 * `discountCents` **不传就整个键都不带**(`exactOptionalPropertyTypes` 下
 * 一个「出现了但值是 undefined」的可选属性是不合法的)。
 */
function request(opts: {
  items?: PaymentRequest["items"];
  shippingCents?: number;
  discountCents?: number;
}): PaymentRequest {
  const base: PaymentRequest = {
    orderNo: "SO-20261108-ABCDEF",
    email: "buyer@example.com",
    items: opts.items ?? [
      { title: "钥匙扣", quantity: 2, unitPriceCents: 1990 },
      { title: "冰箱贴", quantity: 1, unitPriceCents: 3900 },
    ],
    shippingCents: opts.shippingCents ?? 800,
    shippingAddress: null,
    note: "",
    successUrl: "https://example.com/checkout/success",
    currency: "CNY",
  };

  return opts.discountCents === undefined
    ? base
    : { ...base, discountCents: opts.discountCents };
}

/* -------------------------------------------------------------------------- */
/*  逐分相等                                                                   */
/* -------------------------------------------------------------------------- */

describe("订单级优惠 —— 逐分相等", () => {
  it("总额 = Σ(折后单价 × 数量) + 运费 − 优惠", () => {
    const req = request({ discountCents: 2000 });

    // 1990 × 2 + 3900 = 7880
    const itemsTotal = 7880;
    expect(computeTotalCents(req)).toBe(itemsTotal + 800 - 2000);
  });

  it("总额 ≡ 订单那一侧记的 `total_cents`", () => {
    // 订单事实:小计 − 数量折扣 − 优惠 + 运费
    const subtotalCents = 7880;
    const tierDiscountCents = 0;
    const couponDiscountCents = 2000;
    const shippingCents = 800;

    const orderTotalCents =
      subtotalCents - tierDiscountCents - couponDiscountCents + shippingCents;

    const req = request({ discountCents: couponDiscountCents });
    expect(computeTotalCents(req)).toBe(orderTotalCents);
  });

  it("带优惠的单子,收银台收的就是订单应付", () => {
    const req = request({ discountCents: 1000 });

    expect(computeTotalCents(req)).toBe(7680);
  });

  it("不传 `discountCents` → 跟以前一样(不减)", () => {
    const req = request({});

    expect(computeTotalCents(req)).toBe(7880 + 800);
  });

  it("优惠 0 → 跟不传一样", () => {
    const withZero = request({ discountCents: 0 });
    const without = request({});

    expect(computeTotalCents(withZero)).toBe(computeTotalCents(without));
  });

  it("免运费券:运费行本来就是 0,优惠也是 0 —— 总额就是商品小计", () => {
    const req = request({ shippingCents: 0, discountCents: 0 });

    expect(computeTotalCents(req)).toBe(7880);
  });

  it("一组请求算出来的总额都对得上各自的算式", () => {
    const cases: PaymentRequest[] = [
      request({ discountCents: 0 }),
      request({ discountCents: 1 }),
      request({ discountCents: 1990 }),
      request({ items: [], shippingCents: 0, discountCents: 0 }),
      request({
        items: [{ title: "相框", quantity: 3, unitPriceCents: 4900 }],
        shippingCents: 0,
        discountCents: 1470,
      }),
    ];

    for (const req of cases) {
      const itemsTotal = req.items.reduce(
        (sum, item) => sum + Math.round(item.unitPriceCents * item.quantity),
        0
      );
      const expected =
        itemsTotal +
        Math.round(req.shippingCents) -
        Math.round(req.discountCents ?? 0);

      expect(computeTotalCents(req), req.orderNo).toBe(expected);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  闸                                                                         */
/* -------------------------------------------------------------------------- */

describe("订单级优惠 —— 两道闸", () => {
  it("负折扣 → 抛错", () => {
    const req = request({ discountCents: -1 });

    expect(() => computeTotalCents(req)).toThrow();
  });

  it("折扣超过订单总额 → 抛错", () => {
    // 总额 = 7880 + 800 = 8680
    const req = request({ discountCents: 8681 });

    expect(() => computeTotalCents(req)).toThrow();
  });

  it("折扣刚好等于总额 → 允许(全额免单),总额 0", () => {
    const req = request({ discountCents: 8680 });

    expect(computeTotalCents(req)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/*  两个通道用的是**同一份**实现                                               */
/* -------------------------------------------------------------------------- */

describe("两个通道共用一份实现", () => {
  /** 仓库根目录 */
  const ROOT = resolve(process.cwd());

  function readSource(relativePath: string): string {
    return readFileSync(join(ROOT, relativePath), "utf8");
  }

  /** 把注释去掉 —— 注释里写着公式不算「自己写了一份」 */
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/)/.test(line))
      .join("\n");
  }

  it("支付宝那一支转出来的就是共享模块那一个", () => {
    // 支付宝的 provider 入口不拖 `@/db`,能直接 import
    expect(computeAlipayTotal).toBe(computeTotalCents);
  });

  it("两个 provider 都 import 共享模块,不再各写一份", () => {
    for (const provider of [
      "src/features/payments/providers/wechat/index.ts",
      "src/features/payments/providers/alipay/page-pay.ts",
    ]) {
      const source = stripComments(readSource(provider));

      expect(source, provider).toContain(
        'from "@/features/payments/lib/total"'
      );
      // provider 里**不许**再出现一份自己的实现
      expect(source, provider).not.toContain(
        "export function computeTotalCents(request: PaymentRequest): number"
      );
    }
  });

  it("共享模块里那份实现减 `discountCents`,并带两道闸", () => {
    const source = stripComments(
      readSource("src/features/payments/lib/total.ts")
    );

    expect(source).toContain("request.discountCents ?? 0");
    expect(source).toContain("itemsTotal + shipping - discount");
    expect(source).toContain("discount < 0");
    expect(source).toContain("discount > itemsTotal + shipping");
  });
});
