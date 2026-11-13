import { describe, expect, it } from "vitest";

/**
 * 支付**沙箱模式**的纯逻辑。
 *
 * 纯计算:不碰 DB、不碰网络。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个值得测
 *
 * 工作室 2026-11-13 的要求:「支付宝、微信支付先用沙盒测试验证」+「可以后台
 * 配置」。这一层是整个沙箱模式的**地基** —— 键名表、模式解析、端点解析、
 * 缺字段诊断。
 *
 * 这里守的不变量,每一条都对应一个**真出过事**的方向:
 *
 * 1. **沙箱模式永远不产生正式端点** —— 反了就是「沙箱这一单收的是真钱」
 * 2. **正式模式永远不产生沙箱端点** —— 反了就是「真单白发,钱收不到」
 * 3. **未知模式值不猜** —— 「默默当正式」= 真收钱,「默默当沙箱」= 白测一次
 * 4. **缺字段精确到字段** —— 「这个通道没配好」工作室没法照着改
 * 5. **沙箱凭据跟正式同值 = 贴错了** —— 沙箱那单根本发不出去,报错还看不出
 *    是「签名错误」
 */

import {
  ALIPAY_PRODUCTION_GATEWAY,
  ALIPAY_REQUIREMENTS,
  ALIPAY_SANDBOX_GATEWAY,
  ALIPAY_SANDBOX_GATEWAY_LEGACY,
  type ChannelRequirements,
  describeMissingFields,
  detectSameCredential,
  evaluateChannel,
  isAlipayProductionHost,
  isAlipaySandboxHost,
  maskSecret,
  PAYMENT_SETTING_KEYS,
  resolveAlipayEndpoint,
  resolveSandboxMode,
  resolveWechatEndpoint,
  WECHAT_PRODUCTION_NATIVE_PATH,
  WECHAT_REQUIREMENTS,
  WECHAT_SANDBOX_NATIVE_PATH,
  WECHAT_SANDBOX_NATIVE_PATH_ALT,
} from "@/features/payments/lib/sandbox";

/* -------------------------------------------------------------------------- */
/*  模式解析                                                                    */
/* -------------------------------------------------------------------------- */

describe("resolveSandboxMode —— 模式开关严格解析", () => {
  it("没这一行 / 空串 = 正式(默认)", () => {
    expect(resolveSandboxMode(null).mode).toBe("production");
    expect(resolveSandboxMode(undefined).mode).toBe("production");
    expect(resolveSandboxMode("").mode).toBe("production");
    expect(resolveSandboxMode("   ").mode).toBe("production");
    expect(resolveSandboxMode(null).invalid).toBe(false);
  });

  it("true / 1 / yes / on = 沙箱(大小写不敏感、去空白)", () => {
    for (const raw of ["true", "TRUE", "True", " 1 ", "yes", "YES", "on"]) {
      const resolved = resolveSandboxMode(raw);
      expect(resolved.mode, raw).toBe("sandbox");
      expect(resolved.invalid, raw).toBe(false);
    }
  });

  it("false / 0 / no / off = 正式", () => {
    for (const raw of ["false", "FALSE", " 0 ", "no", "off"]) {
      const resolved = resolveSandboxMode(raw);
      expect(resolved.mode, raw).toBe("production");
      expect(resolved.invalid, raw).toBe(false);
    }
  });

  it("认不出来的值 ⇒ invalid(不猜)", () => {
    for (const raw of ["maybe", "sandbox", "开启", "2", "tru", "y"]) {
      const resolved = resolveSandboxMode(raw);
      expect(resolved.invalid, raw).toBe(true);
      expect(resolved.raw, raw).toBe(raw);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  支付宝端点                                                                  */
/* -------------------------------------------------------------------------- */

describe("resolveAlipayEndpoint —— 支付宝网关", () => {
  it("沙箱模式:默认走**新**沙箱", () => {
    const result = resolveAlipayEndpoint({ mode: "sandbox" });
    expect(result.ok).toBe(true);
    expect(result.ok && result.endpoint).toBe(ALIPAY_SANDBOX_GATEWAY);
  });

  it("沙箱模式:旧沙箱也能填(APPID 不通用 ⇒ 网关必须可配)", () => {
    const result = resolveAlipayEndpoint({
      mode: "sandbox",
      sandboxGateway: ALIPAY_SANDBOX_GATEWAY_LEGACY,
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.endpoint).toBe(ALIPAY_SANDBOX_GATEWAY_LEGACY);
  });

  it("沙箱模式**永远不产生正式端点**", () => {
    const result = resolveAlipayEndpoint({
      mode: "sandbox",
      sandboxGateway: ALIPAY_PRODUCTION_GATEWAY,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("SANDBOX_GATEWAY_IS_PRODUCTION");
  });

  it("正式模式:默认走正式网关", () => {
    const result = resolveAlipayEndpoint({ mode: "production" });
    expect(result.ok).toBe(true);
    expect(result.ok && result.endpoint).toBe(ALIPAY_PRODUCTION_GATEWAY);
  });

  it("正式模式**永远不产生沙箱端点**", () => {
    for (const gateway of [
      ALIPAY_SANDBOX_GATEWAY,
      ALIPAY_SANDBOX_GATEWAY_LEGACY,
    ]) {
      const result = resolveAlipayEndpoint({
        mode: "production",
        productionGateway: gateway,
      });
      expect(result.ok, gateway).toBe(false);
      expect(!result.ok && result.code, gateway).toBe(
        "PRODUCTION_GATEWAY_IS_SANDBOX"
      );
    }
  });

  it("不是合法 URL ⇒ 报 INVALID_GATEWAY_URL", () => {
    const result = resolveAlipayEndpoint({
      mode: "sandbox",
      sandboxGateway: "不是地址",
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("INVALID_GATEWAY_URL");
  });

  it("host 判定:新旧沙箱都算沙箱,正式域名才算正式", () => {
    expect(isAlipaySandboxHost("openapi.alipaydev.com")).toBe(true);
    expect(isAlipaySandboxHost("openapi-sandbox.dl.alipaydev.com")).toBe(true);
    expect(isAlipaySandboxHost("openapi.alipay.com")).toBe(false);
    expect(isAlipayProductionHost("openapi.alipay.com")).toBe(true);
    expect(isAlipayProductionHost("openapi.alipaydev.com")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*  微信端点                                                                    */
/* -------------------------------------------------------------------------- */

describe("resolveWechatEndpoint —— 微信 base + path", () => {
  it("沙箱模式:默认 path 带沙箱前缀", () => {
    const result = resolveWechatEndpoint({ mode: "sandbox" });
    expect(result.ok).toBe(true);
    expect(result.ok && result.endpoint).toBe(
      `https://api.mch.weixin.qq.com${WECHAT_SANDBOX_NATIVE_PATH}`
    );
  });

  it("沙箱模式:path 覆盖生效", () => {
    const result = resolveWechatEndpoint({
      mode: "sandbox",
      sandboxNativePath: WECHAT_SANDBOX_NATIVE_PATH_ALT,
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.endpoint).toBe(
      `https://api.mch.weixin.qq.com${WECHAT_SANDBOX_NATIVE_PATH_ALT}`
    );
  });

  it("沙箱 path 必须以 /pay/transactions/native 结尾", () => {
    const result = resolveWechatEndpoint({
      mode: "sandbox",
      sandboxNativePath: "/sandboxnew/v3/pay/transactions/jsapi",
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("NATIVE_PATH_NOT_NATIVE");
  });

  it("沙箱 path 不能跟正式那条一样(那就是正式端点)", () => {
    const result = resolveWechatEndpoint({
      mode: "sandbox",
      sandboxNativePath: WECHAT_PRODUCTION_NATIVE_PATH,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("NATIVE_PATH_IS_PRODUCTION");
  });

  it("沙箱 base 必须是 https、不能带路径", () => {
    const notHttps = resolveWechatEndpoint({
      mode: "sandbox",
      sandboxApiBase: "http://api.mch.weixin.qq.com",
    });
    expect(notHttps.ok).toBe(false);
    expect(!notHttps.ok && notHttps.code).toBe("INVALID_API_BASE");

    const withPath = resolveWechatEndpoint({
      mode: "sandbox",
      sandboxApiBase: "https://api.mch.weixin.qq.com/sandboxnew",
    });
    expect(withPath.ok).toBe(false);
    expect(!withPath.ok && withPath.code).toBe("INVALID_API_BASE");
  });

  it("沙箱 path 必须以 / 开头", () => {
    const result = resolveWechatEndpoint({
      mode: "sandbox",
      sandboxNativePath: "sandboxnew/v3/pay/transactions/native",
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe("INVALID_NATIVE_PATH");
  });

  it("正式模式:端点写死,没有任何覆盖口子", () => {
    const result = resolveWechatEndpoint({
      mode: "production",
      sandboxApiBase: "https://evil.example.com",
      sandboxNativePath: "/sandboxnew/v3/pay/transactions/native",
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.endpoint).toBe(
      "https://api.mch.weixin.qq.com/v3/pay/transactions/native"
    );
  });

  it("正式模式**永远不产生沙箱端点**", () => {
    const result = resolveWechatEndpoint({ mode: "production" });
    expect(result.ok && result.endpoint).not.toContain("/sandboxnew/");
    expect(result.ok && result.endpoint).not.toContain("/v3/sandbox/");
  });
});

/* -------------------------------------------------------------------------- */
/*  缺字段诊断                                                                  */
/* -------------------------------------------------------------------------- */

/** 造一份「全都有」的值 */
function fullValues(requirements: ChannelRequirements): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of requirements.required) values[field.key] = "有值";
  for (const group of requirements.verifyAlternatives) {
    for (const field of group) values[field.key] = "有值";
  }
  return values;
}

describe("describeMissingFields —— 精确到字段", () => {
  it("全配齐 ⇒ 没有缺失", () => {
    const result = describeMissingFields(
      WECHAT_REQUIREMENTS,
      fullValues(WECHAT_REQUIREMENTS)
    );
    expect(result.missing).toEqual([]);
    expect(result.missingVerify).toEqual([]);
  });

  it("缺的那几个精确列出来,已配好的**不许出现**在缺失列表里", () => {
    const values = fullValues(WECHAT_REQUIREMENTS);
    values[PAYMENT_SETTING_KEYS.wechatSandboxMchId] = "";
    values[PAYMENT_SETTING_KEYS.wechatSandboxAppId] = "   ";

    const result = describeMissingFields(WECHAT_REQUIREMENTS, values);
    expect(result.missing.map((f) => f.key)).toEqual([
      PAYMENT_SETTING_KEYS.wechatSandboxMchId,
      PAYMENT_SETTING_KEYS.wechatSandboxAppId,
    ]);
    // 已配好的那个不在列表里
    expect(result.missing.map((f) => f.key)).not.toContain(
      PAYMENT_SETTING_KEYS.wechatSandboxSerialNo
    );
  });

  it("每个缺失字段都带得上环境变量名(正式模式要靠它)", () => {
    const values = fullValues(WECHAT_REQUIREMENTS);
    values[PAYMENT_SETTING_KEYS.wechatSandboxMchId] = "";

    const result = describeMissingFields(WECHAT_REQUIREMENTS, values);
    expect(result.missing[0]?.envVar).toBe("WECHAT_PAY_MCH_ID");
    expect(result.missing[0]?.label.length).toBeGreaterThan(0);
  });

  it("验签材料取「缺得最少」的那一组", () => {
    // 公钥模式:公钥有、ID 缺;平台证书目录也没有 ⇒ 提示补公钥 ID
    const values = fullValues(WECHAT_REQUIREMENTS);
    values[PAYMENT_SETTING_KEYS.wechatSandboxPublicKeyId] = "";
    values[PAYMENT_SETTING_KEYS.wechatSandboxPlatformCertDir] = "";

    const result = describeMissingFields(WECHAT_REQUIREMENTS, values);
    expect(result.missingVerify.map((f) => f.key)).toEqual([
      PAYMENT_SETTING_KEYS.wechatSandboxPublicKeyId,
    ]);
  });

  it("验签材料任一组齐了 ⇒ 没有缺失", () => {
    const values = fullValues(WECHAT_REQUIREMENTS);
    // 只留平台证书目录那一组,公钥模式那组清空
    values[PAYMENT_SETTING_KEYS.wechatSandboxPublicKey] = "";
    values[PAYMENT_SETTING_KEYS.wechatSandboxPublicKeyId] = "";
    values[PAYMENT_SETTING_KEYS.wechatSandboxPlatformCertDir] = "/tmp/certs";

    const result = describeMissingFields(WECHAT_REQUIREMENTS, values);
    expect(result.missingVerify).toEqual([]);
  });

  it("支付宝的公钥在 required 里(它验通知要用)", () => {
    const values = fullValues(ALIPAY_REQUIREMENTS);
    values[PAYMENT_SETTING_KEYS.alipaySandboxPublicKey] = "";

    const result = describeMissingFields(ALIPAY_REQUIREMENTS, values);
    expect(result.missing.map((f) => f.key)).toEqual([
      PAYMENT_SETTING_KEYS.alipaySandboxPublicKey,
    ]);
    expect(result.missingVerify).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/*  凭据同值检测                                                                */
/* -------------------------------------------------------------------------- */

describe("detectSameCredential —— 沙箱凭据跟正式同值 = 贴错了", () => {
  it("同值的字段被指出来", () => {
    const same = detectSameCredential({
      sandbox: { [PAYMENT_SETTING_KEYS.wechatSandboxMchId]: "1900000109" },
      production: { [PAYMENT_SETTING_KEYS.wechatSandboxMchId]: "1900000109" },
      fields: WECHAT_REQUIREMENTS.required,
    });
    expect(same.map((f) => f.key)).toEqual([
      PAYMENT_SETTING_KEYS.wechatSandboxMchId,
    ]);
  });

  it("不同值不算", () => {
    const same = detectSameCredential({
      sandbox: { [PAYMENT_SETTING_KEYS.wechatSandboxMchId]: "sandbox-1" },
      production: { [PAYMENT_SETTING_KEYS.wechatSandboxMchId]: "prod-1" },
      fields: WECHAT_REQUIREMENTS.required,
    });
    expect(same).toEqual([]);
  });

  it("一边没配就不算(没配的那边没东西可比)", () => {
    const same = detectSameCredential({
      sandbox: { [PAYMENT_SETTING_KEYS.wechatSandboxMchId]: "1900000109" },
      production: { [PAYMENT_SETTING_KEYS.wechatSandboxMchId]: "" },
      fields: WECHAT_REQUIREMENTS.required,
    });
    expect(same).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/*  通道评估                                                                    */
/* -------------------------------------------------------------------------- */

describe("evaluateChannel —— 通道能不能用", () => {
  const wechatEndpoint = resolveWechatEndpoint({ mode: "sandbox" });

  it("端点有问题 ⇒ 用不了", () => {
    const bad = resolveWechatEndpoint({
      mode: "sandbox",
      sandboxNativePath: WECHAT_PRODUCTION_NATIVE_PATH,
    });
    const result = evaluateChannel({
      requirements: WECHAT_REQUIREMENTS,
      modeRaw: "true",
      values: fullValues(WECHAT_REQUIREMENTS),
      endpoint: bad,
    });
    expect(result.canTransact).toBe(false);
    expect(result.configured).toBe(false);
  });

  it("模式值认不出来 ⇒ 用不了(**不猜**)", () => {
    const result = evaluateChannel({
      requirements: WECHAT_REQUIREMENTS,
      modeRaw: "也许吧",
      values: fullValues(WECHAT_REQUIREMENTS),
      endpoint: wechatEndpoint,
    });
    expect(result.modeInvalid).toBe(true);
    expect(result.canTransact).toBe(false);
    expect(result.configured).toBe(false);
  });

  it("缺下单字段 ⇒ 不能收钱", () => {
    const values = fullValues(WECHAT_REQUIREMENTS);
    values[PAYMENT_SETTING_KEYS.wechatSandboxMchId] = "";
    const result = evaluateChannel({
      requirements: WECHAT_REQUIREMENTS,
      modeRaw: "true",
      values,
      endpoint: wechatEndpoint,
    });
    expect(result.canTransact).toBe(false);
    expect(result.configured).toBe(false);
    expect(result.missing.map((f) => f.key)).toEqual([
      PAYMENT_SETTING_KEYS.wechatSandboxMchId,
    ]);
  });

  it("缺验签材料 ⇒ 能下单,但**不算完全配好**(通知验不过)", () => {
    const values = fullValues(WECHAT_REQUIREMENTS);
    values[PAYMENT_SETTING_KEYS.wechatSandboxPublicKey] = "";
    values[PAYMENT_SETTING_KEYS.wechatSandboxPublicKeyId] = "";
    values[PAYMENT_SETTING_KEYS.wechatSandboxPlatformCertDir] = "";

    const result = evaluateChannel({
      requirements: WECHAT_REQUIREMENTS,
      modeRaw: "true",
      values,
      endpoint: wechatEndpoint,
    });
    expect(result.canTransact).toBe(true);
    expect(result.configured).toBe(false);
    expect(result.missingVerify.length).toBeGreaterThan(0);
  });

  it("全齐 ⇒ 配好了", () => {
    const result = evaluateChannel({
      requirements: WECHAT_REQUIREMENTS,
      modeRaw: "true",
      values: fullValues(WECHAT_REQUIREMENTS),
      endpoint: wechatEndpoint,
    });
    expect(result.mode).toBe("sandbox");
    expect(result.configured).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*  密钥回显                                                                    */
/* -------------------------------------------------------------------------- */

describe("maskSecret —— 密钥不回显", () => {
  it("PEM ⇒ 显示密钥类型(尾四个字符永远是 `----`,没信息量)", () => {
    expect(maskSecret("-----BEGIN RSA PRIVATE KEY-----\nABCD")).toBe(
      "已配置(RSA PRIVATE KEY)"
    );
    expect(maskSecret("-----BEGIN PUBLIC KEY-----\nABCD")).toBe(
      "已配置(PUBLIC KEY)"
    );
  });

  it("普通值 ⇒ 只露尾四位", () => {
    expect(maskSecret("1900000109")).toBe("已配置(…0109)");
  });

  it("原文不整段出现在结果里", () => {
    const pem =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nIBAAKC\n-----END RSA PRIVATE KEY-----";
    const masked = maskSecret(pem);
    expect(masked).not.toContain("MIIEow");
    expect(masked).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("空 ⇒ null(没配)", () => {
    expect(maskSecret("")).toBe(null);
    expect(maskSecret(null)).toBe(null);
    expect(maskSecret("   ")).toBe(null);
  });

  it("太短 ⇒ 不露(露了等于没掩)", () => {
    expect(maskSecret("ab")).toBe("已配置");
  });
});

/* -------------------------------------------------------------------------- */
/*  键名表                                                                      */
/* -------------------------------------------------------------------------- */

describe("PAYMENT_SETTING_KEYS —— 键名表", () => {
  it("两个通道的开关都在", () => {
    expect(PAYMENT_SETTING_KEYS.wechatSandboxEnabled).toBe(
      "wechat_sandbox_enabled"
    );
    expect(PAYMENT_SETTING_KEYS.alipaySandboxEnabled).toBe(
      "alipay_sandbox_enabled"
    );
  });

  it("沙箱键一律带 _sandbox_ 前缀(跟正式环境变量不会撞)", () => {
    for (const key of Object.values(PAYMENT_SETTING_KEYS)) {
      if (key.endsWith("_enabled")) continue;
      expect(key, key).toContain("_sandbox_");
    }
  });

  it("没有重名", () => {
    const values = Object.values(PAYMENT_SETTING_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });
});
