import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * PEM 密钥体检测试(2026-11-14)。
 *
 * 纯函数:不碰数据库、不碰网络、不读环境变量。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个必须测
 *
 * 线上真踩过(`SO-20261114-657E4A`):支付宝的应用私钥贴错,`createPrivateKey()`
 * 抛的是一句
 *
 * ```
 * error:1E08010C:DECODER routines::unsupported
 * ```
 *
 * 那句话**一个字都看不出「你贴错了」** —— 缺头尾行?标签贴错?公钥贴进私钥栏?
 * 三种错法在 OpenSSL 那边**报的是同一句话**。
 *
 * 而且那条错原先被包成 `PaymentProviderError` ⇒ 界面说的是「这次调用挂了,
 * 重试一下」⇒ 工作室点一百次也是同一个错。⇒ 现在:
 *
 * 1. **能修的当场修** —— 补头尾行 / 换标签(修完**真的能解析**才用)
 * 2. **修不了的说人话** —— 认出来是「贴的是公钥」还是「看不出来」
 * 3. **归类成「配错了」** —— `PaymentNotConfiguredError` ⇒ 界面回
 *    `PAYMENT_NOT_CONFIGURED`(重试没用,去改配置)
 *
 * 这几条测试钉住的就是上面三件事。
 */

import {
  inspectPrivateKeyPem,
  inspectPublicKeyPem,
  normalizePemText,
} from "@/features/payments/lib/pem";
import { PaymentNotConfiguredError } from "@/features/payments/lib/types";
import {
  signContent,
  verifySign,
} from "@/features/payments/providers/alipay/sign";
import { signWithPrivateKey } from "@/features/payments/providers/wechat/signature";

/** 现生成 RSA 2048 密钥 —— 不依赖仓库里任何固定密钥 */
const pkcs8 = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const pkcs1 = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
});

/** 另一把公钥 —— 用来验「用错公钥」的分支 */
const other = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/**
 * 剥掉 PEM 头尾两行,只留 base64 正文
 *
 * 这就是工作室「只复制了正文」那一栏贴进来的东西。
 */
function bodyOnly(pem: string): string {
  return pem
    .split("\n")
    .filter((line) => line && !/-----[A-Za-z0-9 ]+-----/.test(line))
    .join("\n");
}

/** 把 PKCS#1 的正文标成 PKCS#8 的标签 —— 工作室最容易犯的那一种 */
function mislabeled(pem: string): string {
  return pem.replace(/RSA PRIVATE KEY/g, "PRIVATE KEY");
}

describe("normalizePemText", () => {
  it("把 \\n 转义还原成真换行(环境变量里一行写不下私钥)", () => {
    const oneLine = pkcs8.privateKey.replace(/\n/g, "\\n");

    expect(normalizePemText(oneLine)).toContain("\n-----END");
  });

  it("结尾补一个换行 —— PEM 规范要求最后一行带换行", () => {
    expect(normalizePemText("abc")).toBe("abc\n");
  });
});

describe("inspectPrivateKeyPem", () => {
  it("原样就对的 PKCS#8 私钥 —— 不修", () => {
    const result = inspectPrivateKeyPem(pkcs8.privateKey);

    expect(result.usable).toBe(true);
    expect(result.fix).toBe("none");
    expect(result.problem).toBe("none");
    expect(result.pem).toBe(normalizePemText(pkcs8.privateKey));
  });

  it("原样就对的 PKCS#1 私钥(RSA PRIVATE KEY)—— 不修", () => {
    const result = inspectPrivateKeyPem(pkcs1.privateKey);

    expect(result.usable).toBe(true);
    expect(result.fix).toBe("none");
    expect(result.problem).toBe("none");
  });

  it("只有 base64 正文(缺头尾两行)⇒ 补上", () => {
    const result = inspectPrivateKeyPem(bodyOnly(pkcs8.privateKey));

    expect(result.usable).toBe(true);
    expect(result.fix).toBe("wrapped");
    expect(result.problem).toBe("no-header");
    expect(result.pem).toContain("-----BEGIN PRIVATE KEY-----");
  });

  it("只有 base64 正文 + 正文其实是 PKCS#1 ⇒ 补上(且标签要补对)", () => {
    const result = inspectPrivateKeyPem(bodyOnly(pkcs1.privateKey));

    expect(result.usable).toBe(true);
    expect(result.fix).toBe("wrapped");
    expect(result.problem).toBe("no-header");
    expect(result.pem).toContain("-----BEGIN RSA PRIVATE KEY-----");
  });

  it("PKCS#1 的正文标成了 PRIVATE KEY ⇒ 换标签", () => {
    const result = inspectPrivateKeyPem(mislabeled(pkcs1.privateKey));

    expect(result.usable).toBe(true);
    expect(result.fix).toBe("relabeled");
    expect(result.problem).toBe("mislabeled");
    expect(result.pem).toContain("-----BEGIN RSA PRIVATE KEY-----");
  });

  it("把公钥贴进私钥那一栏 ⇒ 认出来(公钥 / 私钥两栏别贴反)", () => {
    const result = inspectPrivateKeyPem(pkcs8.publicKey);

    expect(result.usable).toBe(false);
    expect(result.problem).toBe("public-key");
    expect(result.pem).toBeNull();
  });

  it("公钥没了头尾行 ⇒ 也认出来是公钥", () => {
    const result = inspectPrivateKeyPem(bodyOnly(pkcs8.publicKey));

    expect(result.usable).toBe(false);
    expect(result.problem).toBe("public-key");
    expect(result.pem).toBeNull();
  });

  it("乱七八糟的东西 ⇒ 看不出来(unparseable)", () => {
    const result = inspectPrivateKeyPem("这不是一把钥匙,只是一段话");

    expect(result.usable).toBe(false);
    expect(result.problem).toBe("unparseable");
    expect(result.pem).toBeNull();
  });

  it("空的 ⇒ 看不出来(unparseable)", () => {
    const result = inspectPrivateKeyPem("   ");

    expect(result.usable).toBe(false);
    expect(result.problem).toBe("unparseable");
  });

  it("诊断是人话(中文)—— 后台那一栏直接摆它", () => {
    expect(inspectPrivateKeyPem(pkcs8.publicKey).detail).toContain("公钥");
    expect(inspectPrivateKeyPem(bodyOnly(pkcs8.privateKey)).detail).toContain(
      "头尾两行"
    );
  });
});

describe("inspectPublicKeyPem", () => {
  it("原样就对的 SPKI 公钥 —— 不修", () => {
    const result = inspectPublicKeyPem(pkcs8.publicKey);

    expect(result.usable).toBe(true);
    expect(result.fix).toBe("none");
    expect(result.problem).toBe("none");
  });

  it("只有 base64 正文 ⇒ 补上", () => {
    const result = inspectPublicKeyPem(bodyOnly(pkcs8.publicKey));

    expect(result.usable).toBe(true);
    expect(result.fix).toBe("wrapped");
    expect(result.problem).toBe("no-header");
  });

  it("把私钥贴进公钥那一栏 ⇒ 认出来", () => {
    const result = inspectPublicKeyPem(pkcs8.privateKey);

    expect(result.usable).toBe(false);
    expect(result.problem).toBe("private-key");
    expect(result.pem).toBeNull();
  });

  it("乱七八糟的东西 ⇒ 看不出来", () => {
    const result = inspectPublicKeyPem("????");

    expect(result.usable).toBe(false);
    expect(result.problem).toBe("unparseable");
  });
});

describe("signContent(支付宝)", () => {
  const content = "app_id=2021000000000000&biz_content=%7B%7D";

  it("修好的私钥 ⇒ 签得出来,而且验得过", () => {
    const signature = signContent(content, bodyOnly(pkcs8.privateKey));

    expect(verifySign(content, signature, pkcs8.publicKey)).toBe(true);
  });

  it("标签贴错的私钥 ⇒ 修好之后签得出来", () => {
    const signature = signContent(content, mislabeled(pkcs1.privateKey));

    expect(verifySign(content, signature, pkcs1.publicKey)).toBe(true);
  });

  it("公钥贴进私钥栏 ⇒ 抛 PaymentNotConfiguredError(不是 PaymentProviderError)", () => {
    expect(() => signContent(content, pkcs8.publicKey)).toThrow(
      PaymentNotConfiguredError
    );
  });

  it("公钥贴进私钥栏 ⇒ 错误里说的是 alipay 通道 + 人话", () => {
    try {
      signContent(content, pkcs8.publicKey);
      expect.unreachable("应该抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentNotConfiguredError);
      const notConfigured = error as PaymentNotConfiguredError;
      expect(notConfigured.channel).toBe("alipay");
      expect(notConfigured.message).toContain("私钥不可用");
    }
  });

  it("解析不了 ⇒ 也是「配错了」(重试没用)", () => {
    expect(() => signContent(content, "一坨乱码")).toThrow(
      PaymentNotConfiguredError
    );
  });
});

describe("signWithPrivateKey(微信)", () => {
  const message = "POST\n/v3/pay/transactions/native\n1700000000\nnonce\n{}\n";

  it("修好的私钥 ⇒ 签得出来", () => {
    const signature = signWithPrivateKey(message, bodyOnly(pkcs8.privateKey));

    expect(signature).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("公钥贴进私钥栏 ⇒ 抛 PaymentNotConfiguredError,channel = wechat", () => {
    try {
      signWithPrivateKey(message, pkcs8.publicKey);
      expect.unreachable("应该抛错");
    } catch (error) {
      expect(error).toBeInstanceOf(PaymentNotConfiguredError);
      expect((error as PaymentNotConfiguredError).channel).toBe("wechat");
    }
  });

  it("两个通道的口径一样 —— 同一个坏私钥,同样归类成「配错了」", () => {
    const bad =
      "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n";

    expect(() => signContent("x", bad)).toThrow(PaymentNotConfiguredError);
    expect(() => signWithPrivateKey("x", bad)).toThrow(
      PaymentNotConfiguredError
    );
  });
});

describe("verifySign(支付宝)", () => {
  it("公钥那一栏贴的是私钥 ⇒ 验不过(不是抛错)", () => {
    const signature = signContent("content", pkcs8.privateKey);

    expect(verifySign("content", signature, pkcs8.privateKey)).toBe(false);
  });

  it("用错公钥 ⇒ 验不过", () => {
    const signature = signContent("content", pkcs8.privateKey);

    expect(verifySign("content", signature, other.publicKey)).toBe(false);
  });
});
