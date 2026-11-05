import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * 支付宝签名测试。
 *
 * 纯函数:不碰数据库、不碰网络、不读环境变量。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个必须测
 *
 * 签名是支付宝这一条通道里**最容易错、又最不容易看出来**的地方:
 *
 * 1. **排序**。待签字符串必须按 key 的 ASCII 升序拼。传进去的顺序无所谓 ——
 *    拼错的话支付宝只会回一句 `Invalid signature`,不会告诉你是哪儿错了。
 * 2. **`sign_type` 排不排进去,两种场景不一样**。发请求时**要**留着,验通知
 *    时**不**要。排错了就是「怎么算都对不上」。
 * 3. **改一个字节就验不过**。这条钉住的是「验签真的在校验」—— 如果实现
 *    写成了永远返 true,前两条测试照样会过,但线上就是「谁都能伪造已付款」。
 * 4. **金额是两位小数的元字符串**。本仓库内部是分,这里错一个数量级就是
 *    收一万倍的钱。
 */

import type { PaymentRequest } from "@/features/payments/lib/types";
import type { AlipayConfig } from "@/features/payments/providers/alipay/env";
import {
  buildPagePayRedirectUrl,
  computeTotalCents,
} from "@/features/payments/providers/alipay/page-pay";
import {
  buildSignContent,
  normalizePemKey,
  signContent,
  verifySign,
} from "@/features/payments/providers/alipay/sign";

/** 现生成一对 RSA 2048 密钥 —— 不依赖仓库里任何固定密钥 */
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** 另一把公钥 —— 用来验「用错公钥」的分支 */
const otherKeys = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const config: AlipayConfig = {
  appId: "2021000000000000",
  appPrivateKey: privateKey,
  alipayPublicKey: publicKey,
  gateway: "https://openapi.alipay.com/gateway.do",
  notifyUrl: "https://example.com/api/webhooks/alipay",
  returnUrl: null,
  siteUrl: "https://example.com",
};

const request: PaymentRequest = {
  orderNo: "SO-20261105-ABCDEF",
  email: "buyer@example.com",
  items: [{ title: "冰箱贴 定制款", quantity: 2, unitPriceCents: 1000 }],
  shippingCents: 300,
  shippingAddress: null,
  note: "",
  successUrl: "https://example.com/checkout/success",
  currency: "CNY",
};

describe("buildSignContent", () => {
  it("按 key 的 ASCII 升序拼 —— 传进去的顺序无所谓", () => {
    const content = buildSignContent(
      {
        method: "alipay.trade.page.pay",
        app_id: "2021000000000000",
        biz_content: "{}",
      },
      "request"
    );

    expect(content).toBe(
      "app_id=2021000000000000&biz_content={}&method=alipay.trade.page.pay"
    );
  });

  it("排除 sign 和空值(空串 / undefined / null)", () => {
    const content = buildSignContent(
      {
        app_id: "2021000000000000",
        sign: "不该出现",
        empty: "",
        missing: undefined,
        nothing: null,
      },
      "request"
    );

    expect(content).toBe("app_id=2021000000000000");
  });

  it("请求签名保留 sign_type", () => {
    const params = {
      app_id: "2021000000000000",
      sign_type: "RSA2",
      sign: "签名本身",
      method: "alipay.trade.page.pay",
    };

    expect(buildSignContent(params, "request")).toBe(
      "app_id=2021000000000000&method=alipay.trade.page.pay&sign_type=RSA2"
    );
  });

  it("验签(通知)排除 sign_type", () => {
    const params = {
      app_id: "2021000000000000",
      sign_type: "RSA2",
      sign: "签名本身",
      method: "alipay.trade.page.pay",
    };

    expect(buildSignContent(params, "notify")).toBe(
      "app_id=2021000000000000&method=alipay.trade.page.pay"
    );
  });

  it("value 原样 —— 不做 URL 编码", () => {
    const content = buildSignContent(
      { biz_content: '{"total_amount":"24.30"}' },
      "request"
    );

    expect(content).toBe('biz_content={"total_amount":"24.30"}');
  });
});

describe("signContent / verifySign", () => {
  const content = "app_id=2021000000000000&biz_content=%7B%7D";

  it("私钥签、公钥验 —— 对得上", () => {
    const signature = signContent(content, privateKey);

    expect(verifySign(content, signature, publicKey)).toBe(true);
  });

  it("内容改一个字节就验不过", () => {
    const signature = signContent(content, privateKey);

    expect(verifySign(`${content}X`, signature, publicKey)).toBe(false);
  });

  it("签名改一个字节就验不过", () => {
    const signature = signContent(content, privateKey);
    const index = 10;
    const original = signature[index] ?? "A";
    const replacement = original === "A" ? "B" : "A";
    const tampered =
      signature.slice(0, index) + replacement + signature.slice(index + 1);

    expect(tampered).not.toBe(signature);
    expect(verifySign(content, tampered, publicKey)).toBe(false);
  });

  it("用错公钥验不过", () => {
    const signature = signContent(content, privateKey);

    expect(verifySign(content, signature, otherKeys.publicKey)).toBe(false);
  });

  it("签名不是合法 base64 → 验不过(不是抛错)", () => {
    expect(verifySign(content, "不是 base64 !!!", publicKey)).toBe(false);
  });

  it("内联私钥写成一行(\\n 转义)也能签", () => {
    const oneLine = privateKey.replace(/\n/g, "\\n");
    const signature = signContent(content, oneLine);

    expect(verifySign(content, signature, publicKey)).toBe(true);
    expect(normalizePemKey(oneLine)).toContain("\n-----END");
  });
});

describe("buildPagePayRedirectUrl", () => {
  const url = new URL(buildPagePayRedirectUrl(config, request));

  it("指向支付宝网关", () => {
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://openapi.alipay.com/gateway.do"
    );
  });

  it("带 sign 参数", () => {
    const sign = url.searchParams.get("sign");

    expect(sign).toBeTruthy();
    expect(sign).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("URL 里的 sign 真的验得过(用配置里的支付宝公钥)", () => {
    const params: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      params[key] = value;
    }
    const signature = params.sign ?? "";
    delete params.sign;

    const content = buildSignContent(params, "request");
    expect(verifySign(content, signature, config.alipayPublicKey)).toBe(true);
  });

  it("biz_content 是合法 JSON,total_amount 是两位小数的元", () => {
    const raw = url.searchParams.get("biz_content");
    expect(raw).toBeTruthy();

    const bizContent = JSON.parse(raw ?? "{}") as {
      out_trade_no: string;
      total_amount: string;
      subject: string;
      product_code: string;
      timeout_express: string;
    };

    expect(bizContent.out_trade_no).toBe("SO-20261105-ABCDEF");
    expect(bizContent.total_amount).toBe("23.00");
    expect(bizContent.total_amount).toMatch(/^\d+\.\d{2}$/);
    expect(bizContent.product_code).toBe("FAST_INSTANT_TRADE_PAY");
    expect(bizContent.timeout_express).toBe("30m");
  });

  it("公共参数齐了 —— method / sign_type / notify_url / return_url", () => {
    expect(url.searchParams.get("app_id")).toBe("2021000000000000");
    expect(url.searchParams.get("method")).toBe("alipay.trade.page.pay");
    expect(url.searchParams.get("format")).toBe("JSON");
    expect(url.searchParams.get("charset")).toBe("utf-8");
    expect(url.searchParams.get("sign_type")).toBe("RSA2");
    expect(url.searchParams.get("version")).toBe("1.0");
    expect(url.searchParams.get("notify_url")).toBe(
      "https://example.com/api/webhooks/alipay"
    );
    expect(url.searchParams.get("return_url")).toBe(
      "https://example.com/checkout/success"
    );
    expect(url.searchParams.get("timestamp")).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
    );
  });
});

describe("computeTotalCents", () => {
  it("每行「折后单价 × 数量」加起来,再加运费", () => {
    const total = computeTotalCents({
      ...request,
      items: [
        { title: "A", quantity: 3, unitPriceCents: 1050 },
        { title: "B", quantity: 1, unitPriceCents: 999 },
      ],
      shippingCents: 250,
    });

    expect(total).toBe(3 * 1050 + 999 + 250);
  });

  it("运费为 0 时就是各行之和", () => {
    const total = computeTotalCents({
      ...request,
      items: [{ title: "A", quantity: 2, unitPriceCents: 1215 }],
      shippingCents: 0,
    });

    expect(total).toBe(2430);
  });
});
