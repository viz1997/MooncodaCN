import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 支付宝**同步接口响应**的验签口径(2026-11-14 线上事故的回归测试)
 *
 * ## 出了什么事
 *
 * 三笔支付宝订单的钱都到了,订单却一直停在 `unpaid`:
 *
 * | 订单号 | 金额 |
 * |---|---|
 * | `SO-20261114-657E4A` | ¥247 |
 * | `SO-20261114-137332` | ¥249 |
 * | `SO-20261114-E58728` | ¥228 |
 *
 * 买家侧看到的是:
 *
 * > ⚠️ 支付宝那边显示这笔已经付款成功,但我们核对不上(签名验不过)——
 * > 请不要重复付款,工作室会人工确认 —— 支付宝说:code=10000
 *
 * ## 根因
 *
 * 查单响应的验签,原来把待签字符串拼成了
 * `alipay_trade_query_response={…}` —— **多了一个键名前缀**。
 *
 * 支付宝签的其实只是**内层那个对象的 JSON 原文**(官方《同步接口验签》:
 * `open.alipay.com/200/106120`)⇒ 每一笔查单响应都验不过 ⇒ 判定层永远落在
 * `signature_invalid` ⇒ 订单永远 `unpaid`。
 *
 * ⇒ 三单全是同一个错,跟公钥没关系(公钥是对的 —— 异步通知那条腿验得过)。
 *
 * ## 这个文件钉住三条
 *
 * 1. **待签字符串就是内层那段原文,不带 `key=` 前缀**
 * 2. **必须用原文,不能重新序列化**(键序 / `\/` 转义 / 数字格式都会变)
 * 3. **查单 + 判定层串起来 ⇒ 能落库**(直接对着「订单卡在 unpaid」这个症状)
 *
 * 另外扫一遍 `query.ts` 的源码 —— 那个前缀是硬编码的错,别让人再写回去。
 *
 * 纯函数:不碰数据库、不碰网络、不读环境变量。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 */

import { decideAlipayReconcile } from "@/features/payments/providers/alipay/reconcile-rules";
import {
  ALIPAY_TRADE_QUERY_RESPONSE_KEY,
  buildAlipayResponseSignContent,
  verifyAlipayResponseSignature,
} from "@/features/payments/providers/alipay/response-sign";
import {
  signContent,
  verifySign,
} from "@/features/payments/providers/alipay/sign";

/** 现生成一对 RSA 2048 密钥 —— 不依赖仓库里任何固定密钥 */
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * 把注释去掉 —— 注释里**提到**那个名字不算违规
 *
 * (那儿恰恰要解释「为什么不能拼那个前缀」。)
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/**
 * 拼一份**支付宝形状**的原始响应
 *
 * @param inner 内层对象的 JSON 原文(**不带**外层键名)
 * @param signature 响应里的 `sign`
 */
function buildRawResponse(inner: string, signature: string): string {
  return `{"${ALIPAY_TRADE_QUERY_RESPONSE_KEY}":${inner},"sign":"${signature}"}`;
}

/** 一份付款成功的查单响应内层对象(支付宝自己吐出来的原文) */
const PAID_INNER =
  '{"code":"10000","msg":"Success","trade_no":"2026111422001ABCDEF",' +
  '"out_trade_no":"SO-20261114-E58728","trade_status":"TRADE_SUCCESS",' +
  '"total_amount":"228.00"}';

describe("buildAlipayResponseSignContent", () => {
  it("返回的是内层那段原文 —— 不带 `alipay_trade_query_response=` 前缀", () => {
    const content = buildAlipayResponseSignContent(
      buildRawResponse(PAID_INNER, "sig"),
      ALIPAY_TRADE_QUERY_RESPONSE_KEY
    );

    expect(content).toBe(PAID_INNER);
    // ⭐ 这条是 2026-11-14 那个 bug 的正面钉子:
    // 前缀拼上去 ⇒ 每一笔都验不过 ⇒ 订单永远停在 `unpaid`
    expect(content).not.toContain(`${ALIPAY_TRADE_QUERY_RESPONSE_KEY}=`);
    expect(content?.startsWith("{")).toBe(true);
    expect(content?.endsWith("}")).toBe(true);
  });

  it("带前缀的那一版验不过 —— 钉住原来的错法", () => {
    const signature = signContent(PAID_INNER, privateKey);

    // 正确口径(内层原文)⇒ 验得过
    expect(verifySign(PAID_INNER, signature, publicKey)).toBe(true);

    // 原来的错法(多了键名前缀)⇒ 验不过
    expect(
      verifySign(
        `${ALIPAY_TRADE_QUERY_RESPONSE_KEY}=${PAID_INNER}`,
        signature,
        publicKey
      )
    ).toBe(false);
  });

  it("用**原文**抠 —— 重新序列化会改掉 `\\/`,签名就对不上了", () => {
    // 支付宝吐出来的原文里,斜杠是转义的(`https:\/\/…`)
    const rawInner =
      '{"code":"10000","qr_code":"https:\\/\\/qr.alipay.com\\/bax123",' +
      '"total_amount":"228.00"}';
    const raw = buildRawResponse(rawInner, "sig");

    const signature = signContent(rawInner, privateKey);

    // 用原文抠出来的那段 ⇒ 验得过
    expect(
      verifyAlipayResponseSignature({
        raw,
        key: ALIPAY_TRADE_QUERY_RESPONSE_KEY,
        signature,
        alipayPublicKeyPem: publicKey,
      })
    ).toBe(true);

    // 重新序列化一遍(`\/` 变成 `/`)⇒ 验不过 —— 所以必须抠原文
    const reparsed = JSON.parse(raw) as Record<string, unknown>;
    const reserialized = JSON.stringify(
      reparsed[ALIPAY_TRADE_QUERY_RESPONSE_KEY]
    );
    expect(reserialized).not.toBe(rawInner);
    expect(verifySign(reserialized, signature, publicKey)).toBe(false);
  });

  it("嵌套对象 / 数组里的括号不会把抠取带偏", () => {
    const rawInner =
      '{"code":"10000","fund_bill_list":[{"amount":"228.00","detail":"a}b"}],' +
      '"note":"含 } 和 { 的字符串"}';
    const raw = buildRawResponse(rawInner, "sig");

    expect(
      buildAlipayResponseSignContent(raw, ALIPAY_TRADE_QUERY_RESPONSE_KEY)
    ).toBe(rawInner);
  });

  it("响应里没有那个键 / 值不是对象 ⇒ 返 null(不抛)", () => {
    expect(
      buildAlipayResponseSignContent(
        '{"sign":"x"}',
        "alipay_trade_query_response"
      )
    ).toBeNull();
    expect(
      buildAlipayResponseSignContent(
        '{"alipay_trade_query_response":"不是对象"}',
        "alipay_trade_query_response"
      )
    ).toBeNull();
  });
});

describe("verifyAlipayResponseSignature", () => {
  it("验得过 —— 支付宝签的内层原文就是待签字符串", () => {
    const signature = signContent(PAID_INNER, privateKey);
    const raw = buildRawResponse(PAID_INNER, signature);

    expect(
      verifyAlipayResponseSignature({
        raw,
        key: ALIPAY_TRADE_QUERY_RESPONSE_KEY,
        signature,
        alipayPublicKeyPem: publicKey,
      })
    ).toBe(true);
  });

  it("签名不对 ⇒ 返 false(不是抛错)", () => {
    const raw = buildRawResponse(PAID_INNER, "这不是一个合法的签名");

    expect(
      verifyAlipayResponseSignature({
        raw,
        key: ALIPAY_TRADE_QUERY_RESPONSE_KEY,
        signature: "这不是一个合法的签名",
        alipayPublicKeyPem: publicKey,
      })
    ).toBe(false);
  });

  it("没有 sign / sign 是空的 ⇒ 返 false", () => {
    const raw = buildRawResponse(PAID_INNER, "");

    expect(
      verifyAlipayResponseSignature({
        raw,
        key: ALIPAY_TRADE_QUERY_RESPONSE_KEY,
        signature: null,
        alipayPublicKeyPem: publicKey,
      })
    ).toBe(false);
    expect(
      verifyAlipayResponseSignature({
        raw,
        key: ALIPAY_TRADE_QUERY_RESPONSE_KEY,
        signature: "",
        alipayPublicKeyPem: publicKey,
      })
    ).toBe(false);
  });

  it("用错公钥 ⇒ 返 false", () => {
    const other = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const signature = signContent(PAID_INNER, privateKey);
    const raw = buildRawResponse(PAID_INNER, signature);

    expect(
      verifyAlipayResponseSignature({
        raw,
        key: ALIPAY_TRADE_QUERY_RESPONSE_KEY,
        signature,
        alipayPublicKeyPem: other.publicKey,
      })
    ).toBe(false);
  });
});

describe("查单 + 判定层串起来", () => {
  it("支付宝说付了 + 我们验过了 + 金额对得上 ⇒ 落库", () => {
    const signature = signContent(PAID_INNER, privateKey);
    const raw = buildRawResponse(PAID_INNER, signature);

    // 走一遍查单那边做的同一件事
    const verified = verifyAlipayResponseSignature({
      raw,
      key: ALIPAY_TRADE_QUERY_RESPONSE_KEY,
      signature,
      alipayPublicKeyPem: publicKey,
    });
    const parsed = JSON.parse(raw) as {
      alipay_trade_query_response: {
        code: string;
        out_trade_no: string;
        trade_no: string;
        trade_status: string;
        total_amount: string;
      };
    };
    const node = parsed.alipay_trade_query_response;

    const decision = decideAlipayReconcile({
      queryOk: node.code === "10000",
      verified,
      tradeStatus: node.trade_status,
      paidAmountCents: 22800,
      expectedAmountCents: 22800,
      alreadyPaid: false,
      queryCode: node.code,
      querySubCode: null,
      queryMessage: null,
    });

    expect(decision.code).toBe("settled");
    expect(decision.paid).toBe(true);
    expect(decision.shouldSettle).toBe(true);
  });

  it("验不过 ⇒ 绝不落库,但要拦住「再付一次」", () => {
    const decision = decideAlipayReconcile({
      queryOk: true,
      verified: false,
      tradeStatus: "TRADE_SUCCESS",
      paidAmountCents: 22800,
      expectedAmountCents: 22800,
      alreadyPaid: false,
      queryCode: "10000",
      querySubCode: null,
      queryMessage: null,
    });

    expect(decision.code).toBe("signature_invalid");
    expect(decision.shouldSettle).toBe(false);
    // 「支付宝说付了」和「我们核对过了」是两件事
    expect(decision.reportedPaid).toBe(true);
    expect(decision.paid).toBe(false);
    expect(decision.message).toContain("请不要重复付款");
  });
});

describe("query.ts 的源码", () => {
  const QUERY_TS = "src/features/payments/providers/alipay/query.ts";

  it("待签字符串**不许**拼 `alipay_trade_query_response=` 前缀", () => {
    const src = stripComments(read(QUERY_TS));

    // 原来的错法:verifySign(`${KEY}=${rawInner}`, …)
    //
    // ⭐ 字符串**拼接**出来的 —— 直接写字面量会被 Biome 的
    // `noTemplateCurlyInString` 拦(它以为那是个忘了加反引号的模板串)
    const prefixedForm = "${" + "ALIPAY_TRADE_QUERY_RESPONSE_KEY}=";
    expect(src).not.toContain(prefixedForm);
    expect(src).not.toContain("alipay_trade_query_response=");
  });

  it("验签走 `response-sign.ts` 那一份(不自己拼字符串)", () => {
    const src = stripComments(read(QUERY_TS));

    expect(src).toContain("verifyAlipayResponseSignature");
    // 自己抠原文的那份逻辑搬走了 —— 两处抠一遍迟早漂
    expect(src).not.toContain("extractRawObject");
  });

  it("`error_response` 也要认 —— 请求被拒不是「查不到」", () => {
    const src = stripComments(read(QUERY_TS));

    expect(src).toContain("error_response");
    // 「查到了」只看查单节点里的 `code === "10000"`
    expect(src).toContain('queryNode?.code === "10000"');
  });
});
