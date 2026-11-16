import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { verifyPaidAmount } from "@/features/payments/lib/amount-guard";

/**
 * 收款回调的**金额核对**(2026-11-16)
 *
 * ## 这是上线前的一个真风险
 *
 * 沙箱里所有单都是 1 分 ⇒ **金额对不对根本看不出来**。正式环境就不一样了:
 * 一条**验签通过但金额不对**的通知,照样能把订单标成「已付」⇒
 * **收了不该收的钱、发了不该发的货**。
 *
 * ## 验签过了 ≠ 金额对
 *
 * 签名的作用是「这条通知确实是平台发的」,它**管不了**「平台记的这笔钱
 * 是不是我们收的那笔钱」。⇒ 金额核对是**另一道闸**,跟验签并列。
 *
 * ## 判定层是纯函数(零 import)
 *
 * 照 `providers/alipay/reconcile-rules.ts` 的形状 —— 判定层不碰 DB、不碰
 * 网络 ⇒ 能进 vitest `unit` project 直接测。
 *
 * ## 三种「通知里的金额」—— 语义**不能混**
 *
 * | 值 | 意思 | 判定 |
 * |---|---|---|
 * | `undefined` | 这个通道**不核对**(旧路 Shopify 的回调不带金额) | 放行 |
 * | `null` | 读了但**解析不出来** | **拦住**(fail closed) |
 * | 数字 | 平台报了这个数 | 一分不差才算过 |
 *
 * ⚠️ 「解析不出来 ⇒ 拦住」是关键 —— **核不了 ≠ 核过了**。
 */

/* -------------------------------------------------------------------------- */
/*  纯函数                                                                     */
/* -------------------------------------------------------------------------- */

describe("verifyPaidAmount —— 通知金额跟订单应付一对一", () => {
  it("一分不差 ⇒ 放行", () => {
    const check = verifyPaidAmount({
      expectedCents: 24700,
      notifiedCents: 24700,
    });
    expect(check.ok).toBe(true);
  });

  it("0 元订单(应付 0 分)也放行 —— 通知报 0 就是对上了", () => {
    const check = verifyPaidAmount({
      expectedCents: 0,
      notifiedCents: 0,
    });
    expect(check.ok).toBe(true);
  });

  it("通知金额**小于**应付 ⇒ AMOUNT_MISMATCH", () => {
    const check = verifyPaidAmount({
      expectedCents: 24700,
      notifiedCents: 100,
    });
    expect(check.ok).toBe(false);
    if (check.ok) throw new Error("不该放行");
    expect(check.code).toBe("AMOUNT_MISMATCH");
    expect(check.expectedCents).toBe(24700);
    expect(check.notifiedCents).toBe(100);
  });

  it("通知金额**大于**应付 ⇒ AMOUNT_MISMATCH", () => {
    const check = verifyPaidAmount({
      expectedCents: 24700,
      notifiedCents: 24701,
    });
    expect(check.ok).toBe(false);
    if (check.ok) throw new Error("不该放行");
    expect(check.code).toBe("AMOUNT_MISMATCH");
  });

  it("差**一分**也拒 —— 逐分相等就是逐分相等", () => {
    const check = verifyPaidAmount({
      expectedCents: 24700,
      notifiedCents: 24699,
    });
    expect(check.ok).toBe(false);
  });

  it("通知金额读不出来(null)⇒ AMOUNT_MISSING(fail closed)", () => {
    const check = verifyPaidAmount({
      expectedCents: 24700,
      notifiedCents: null,
    });
    expect(check.ok).toBe(false);
    if (check.ok) throw new Error("不该放行");
    expect(check.code).toBe("AMOUNT_MISSING");
    expect(check.notifiedCents).toBeNull();
  });

  it("**不传**(undefined)⇒ 放行 —— 这个通道压根不核对", () => {
    const check = verifyPaidAmount({ expectedCents: 24700 });
    expect(check.ok).toBe(true);
  });

  it("应付金额不是一个正常的数 ⇒ AMOUNT_MISSING(核不了不放行)", () => {
    for (const expectedCents of [-1, 1.5, Number.NaN]) {
      const check = verifyPaidAmount({
        expectedCents,
        notifiedCents: 24700,
      });
      expect(check.ok, String(expectedCents)).toBe(false);
      if (check.ok) throw new Error("不该放行");
      expect(check.code).toBe("AMOUNT_MISSING");
    }
  });

  it("通知金额不是整数 / 是负数 ⇒ AMOUNT_MISSING", () => {
    for (const notifiedCents of [247.5, -100]) {
      const check = verifyPaidAmount({
        expectedCents: 24700,
        notifiedCents,
      });
      expect(check.ok, String(notifiedCents)).toBe(false);
      if (check.ok) throw new Error("不该放行");
      expect(check.code).toBe("AMOUNT_MISSING");
    }
  });

  it("每条失败都带一句**人话**(给工作室看日志)", () => {
    const mismatch = verifyPaidAmount({
      expectedCents: 24700,
      notifiedCents: 100,
    });
    const missing = verifyPaidAmount({
      expectedCents: 24700,
      notifiedCents: null,
    });
    if (mismatch.ok || missing.ok) throw new Error("不该放行");
    expect(mismatch.message.length).toBeGreaterThan(0);
    expect(missing.message.length).toBeGreaterThan(0);
    // 人话里要点出「不敢改状态」
    expect(mismatch.message).toContain("不敢");
    expect(missing.message).toContain("不敢");
  });
});

/* -------------------------------------------------------------------------- */
/*  源码扫描 —— 守住「只在标已付那一档核对」这个结构                         */
/* -------------------------------------------------------------------------- */

const ROOT = resolve(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

/**
 * 去掉注释 —— 「这个东西不许出现在源码里」的断言必须跑在**去掉注释**的源码上
 *
 * 不然文件头那些解释性注释(里面会提到 `payer_total` 这种词)会让断言变成
 * 假阳性。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

describe("金额核对接在哪儿", () => {
  it("判定层是一个**独立**的纯模块(零 import)", () => {
    const source = stripComments(
      readSource("src/features/payments/lib/amount-guard.ts")
    );
    // 纯函数 ⇒ 不许 import 任何东西
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toContain("@/db");
  });

  it("落库那一层 import 共享的判定模块", () => {
    const source = stripComments(
      readSource("src/features/payments/lib/settle.ts")
    );
    expect(source).toContain(
      'import { verifyPaidAmount } from "./amount-guard"'
    );
  });

  it("**只在 `mark_paid` 那一档核对** —— 退款那一腿不核金额", () => {
    const source = stripComments(
      readSource("src/features/payments/lib/settle.ts")
    );
    expect(source).toContain('params.action === "mark_paid"');
    // 核对块被包在 mark_paid 那一档里
    expect(source).toMatch(
      /params\.action === "mark_paid"[\s\S]{0,900}?verifyPaidAmount\(/
    );
  });

  it("核对基准是订单上**存下来的应付金额**那一列", () => {
    const source = stripComments(
      readSource("src/features/payments/lib/settle.ts")
    );
    expect(source).toContain("payableCents: storefrontOrder.totalCents");
    expect(source).toContain("payableCents: printOrder.totalPriceCents");
  });

  it("核对不过 ⇒ **一格都不改**(不改 payment_status)", () => {
    const source = stripComments(
      readSource("src/features/payments/lib/settle.ts")
    );
    // 核对块里 return 的那一档必须带着 changed: false
    expect(source).toMatch(/verifyPaidAmount\([\s\S]{0,900}?changed: false/);
  });
});

describe("两个新通道都把通知里的金额带下去", () => {
  it("微信:取 `amount.total`,**不是** `payer_total`", () => {
    const source = stripComments(
      readSource("src/features/payments/providers/wechat/webhook.ts")
    );
    expect(source).toContain("transaction.amount?.total");
    // payer_total 是「用户实付」—— 微信侧优惠会让它**小于**订单金额,
    // 拿它比会把每一笔正常付款都拒掉
    expect(source).not.toContain("transaction.amount?.payer_total");
    expect(source).toContain("paidAmountCents,");
  });

  it("支付宝:付款通知用 `total_amount`(元 → 分)", () => {
    const source = stripComments(
      readSource("src/features/payments/providers/alipay/webhook.ts")
    );
    expect(source).toContain("parseAlipayAmountCents(params.total_amount)");
    expect(source).toContain("paidAmountCents,");
  });

  it("支付宝主动查单那一腿也带金额 —— 跟异步通知**同一个口径**", () => {
    const source = stripComments(
      readSource("src/features/payments/providers/alipay/reconcile.ts")
    );
    expect(source).toContain("paidAmountCents: amountToPass");
    // 判定层压根没核金额的时候 ⇒ 这一层也不核 ⇒ 传 undefined
    expect(source).toContain(
      "expectedAmountCents === null ? undefined : paidAmountCents"
    );
  });

  it("旧路(Shopify)维持原样 —— **不传**金额 ⇒ 不核对", () => {
    const source = stripComments(
      readSource("src/features/payments/providers/shopify/webhook.ts")
    );
    expect(source).toContain("settleByOrderNo(");
    expect(source).not.toContain("paidAmountCents");
  });
});
