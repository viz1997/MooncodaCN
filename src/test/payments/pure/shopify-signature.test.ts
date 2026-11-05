/**
 * Shopify 通道 —— 纯函数测试
 *
 * 三件事被钉住:
 *
 * 1. **验签** —— 伪造的「已付款」事件是最坏的情况,验签必须只认原始字节。
 * 2. **逐分相等** —— 我们算出来的价必须原样落到 Shopify 草稿单的行上,
 *    而且 Shopify 那边算出来的总额要跟我们的一样(对不上就当失败)。
 * 3. **认订单** —— 回调里要从 tags / note / 行项目属性里把我们的订单号
 *    挖出来;三个来源挨个试。
 */

import { describe, expect, it } from "vitest";
import type { PaymentRequest } from "@/features/payments/lib/types";
import {
  buildDraftOrderInput,
  computeRequestTotalCents,
} from "@/features/payments/providers/shopify/draft-order";
import {
  classifyShopifyTopic,
  extractShopifyOrderNo,
  toOrderReference,
} from "@/features/payments/providers/shopify/order-reference";
import {
  computeShopifyHmac,
  verifyShopifyHmac,
} from "@/features/payments/providers/shopify/signature";

const SECRET = "hush-secret-value";

const request: PaymentRequest = {
  orderNo: "SO-20261105-942D88",
  email: "buyer@example.com",
  items: [
    {
      title: "冰箱贴",
      quantity: 2,
      unitPriceCents: 1250,
      sku: "RM-01",
    },
  ],
  shippingCents: 600,
  shippingAddress: {
    recipientName: "张三",
    phone: "13800000000",
    province: "广东省",
    city: "深圳市",
    district: "南山区",
    detail: "科技园 1 号",
  },
  note: "",
  successUrl: "https://example.com/checkout/success",
  currency: "CNY",
};

describe("Shopify webhook 验签", () => {
  it("原始字节算出来的签名能验过", () => {
    const body = JSON.stringify({ id: 1, note: "SO-20261105-942D88" });
    const signature = computeShopifyHmac(body, SECRET);
    expect(verifyShopifyHmac(body, signature, SECRET)).toBe(true);
  });

  it("body 改一个字节就验不过", () => {
    const body = JSON.stringify({ id: 1, note: "SO-20261105-942D88" });
    const signature = computeShopifyHmac(body, SECRET);
    const tampered = JSON.stringify({ id: 1, note: "SO-20261105-942D89" });
    expect(verifyShopifyHmac(tampered, signature, SECRET)).toBe(false);
  });

  it("密钥不对就验不过", () => {
    const body = "{}";
    const signature = computeShopifyHmac(body, SECRET);
    expect(verifyShopifyHmac(body, signature, "另一个密钥")).toBe(false);
  });

  it("头缺失 → false", () => {
    expect(verifyShopifyHmac("{}", null, SECRET)).toBe(false);
  });

  it("长度不对的签名 → false(不能拿去比)", () => {
    expect(verifyShopifyHmac("{}", "abcd", SECRET)).toBe(false);
  });

  it("Buffer 和同内容的字符串算出来一样", () => {
    const body = '{"id":1}';
    expect(computeShopifyHmac(body, SECRET)).toBe(
      computeShopifyHmac(Buffer.from(body, "utf8"), SECRET)
    );
  });
});

describe("Shopify 草稿单 —— 逐分相等", () => {
  it("行价就是我们算出来的折后单价,原样搬过去", () => {
    const input = buildDraftOrderInput({ request, currencyCode: "CNY" });
    const line = input.lineItems[0];
    expect(line).toBeDefined();
    expect(line?.title).toBe("冰箱贴");
    expect(line?.quantity).toBe(2);
    // 行价字段叫 `originalUnitPrice`(`Money` 标量,纯字符串)——
    // `price` 那个字段压根不存在,送过去整条 mutation 验证不过
    // (2026-11-05 线上踩过)
    expect(line?.originalUnitPrice).toBe("12.50");
    // 不给 Shopify 留打折的空间 —— 走 `acceptAutomaticDiscounts: false`
    expect(input.acceptAutomaticDiscounts).toBe(false);
    // 币种由展示币种定 —— 行价标量不带币种
    expect(input.presentmentCurrencyCode).toBe("CNY");
  });

  it("运费是我们给的一行,不是 Shopify 算的", () => {
    const input = buildDraftOrderInput({ request, currencyCode: "CNY" });
    // `ShippingLineInput.price` 是 `Money` 标量 —— 字符串,不是对象
    expect(input.shippingLine?.price).toBe("6.00");
    // 不带 `handle` —— 带了会被店铺的运费费率覆盖掉
    expect(input.shippingLine).not.toHaveProperty("handle");
  });

  it("总额 = 行价 × 数量 + 运费", () => {
    expect(computeRequestTotalCents(request)).toBe(1250 * 2 + 600);
  });

  it("订单号写在 tags / note / 行项目属性里(回调要靠它认单)", () => {
    const input = buildDraftOrderInput({ request, currencyCode: "CNY" });
    expect(input.tags).toContain("mooncoda:SO-20261105-942D88");
    expect(input.note).toContain("SO-20261105-942D88");
    const properties = input.lineItems[0]?.customAttributes ?? [];
    expect(
      properties.some(
        (property) =>
          property.key === "订单号" && property.value === "SO-20261105-942D88"
      )
    ).toBe(true);
  });

  it("税自己算过了 —— 草稿单标成免税,别让 Shopify 再叠一层", () => {
    const input = buildDraftOrderInput({ request, currencyCode: "CNY" });
    expect(input.taxExempt).toBe(true);
  });
});

describe("Shopify 回调 —— 认订单号", () => {
  it("从 tags 里挖出来", () => {
    const found = extractShopifyOrderNo({
      note: null,
      tags: "mooncoda:SO-20261105-942D88",
      properties: [],
    });
    expect(found).toBe("SO-20261105-942D88");
  });

  it("从行项目属性里挖出来", () => {
    const found = extractShopifyOrderNo({
      note: null,
      tags: "",
      properties: [{ name: "订单号", value: "PO-20261105-AABBCC" }],
    });
    expect(found).toBe("PO-20261105-AABBCC");
  });

  it("从 note 里挖出来", () => {
    const found = extractShopifyOrderNo({
      note: "mooncoda:SO-20261105-942D88",
      tags: "",
      properties: [],
    });
    expect(found).toBe("SO-20261105-942D88");
  });

  it("挖不出来就是 null(不瞎猜)", () => {
    const found = extractShopifyOrderNo({
      note: "手工在后台建的单",
      tags: "vip",
      properties: [],
    });
    expect(found).toBeNull();
  });

  it("REST 报文的形状能转成「找订单号」的形状", () => {
    const reference = toOrderReference({
      id: 123,
      note: "mooncoda:SO-20261105-942D88",
      tags: "mooncoda:SO-20261105-942D88",
      line_items: [
        {
          title: "冰箱贴",
          quantity: 2,
          price: "12.50",
          properties: [{ name: "订单号", value: "SO-20261105-942D88" }],
        },
      ],
    });
    expect(reference.tags).toBe("mooncoda:SO-20261105-942D88");
    expect(reference.properties).toHaveLength(1);
    expect(extractShopifyOrderNo(reference)).toBe("SO-20261105-942D88");
  });
});

describe("Shopify 回调 —— 认 topic", () => {
  it("orders/paid → 标已付", () => {
    expect(
      classifyShopifyTopic("orders/paid", { financial_status: "paid" })
    ).toEqual({ kind: "mark_paid" });
  });

  it("orders/paid 但钱还没到账 → 忽略", () => {
    const action = classifyShopifyTopic("orders/paid", {
      financial_status: "pending",
    });
    expect(action.kind).toBe("ignore");
  });

  it("refunds/create → 标退款", () => {
    expect(classifyShopifyTopic("refunds/create", {})).toEqual({
      kind: "mark_refunded",
    });
  });

  it("orders/cancelled → 标取消", () => {
    expect(classifyShopifyTopic("orders/cancelled", {})).toEqual({
      kind: "mark_cancelled",
    });
  });

  it("不关心的 topic → 忽略", () => {
    const action = classifyShopifyTopic("orders/updated", {});
    expect(action.kind).toBe("ignore");
  });
});
