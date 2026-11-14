import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 支付**沙箱模式的配置解析** —— provider 那一层
 *
 * 纯函数 + 源码扫描:不碰 DB、不碰网络。跑在 unit project 里
 * (`pnpm vitest run --project=unit`)。
 *
 * ## 这一层跟 `payment-sandbox.test.ts` 守的是**不同的东西**
 *
 * 那一个守的是**纯解析器**(`sandbox.ts`):模式怎么解析、端点怎么解析、
 * 缺哪几个字段、凭据同值检测。
 *
 * **这一个守的是「provider 真的按那个解析结果组装配置」** —— 也就是从
 * `payment_setting` 表 / 环境变量,到 `WechatPayConfig` / `AlipayConfig`
 * 那一段。中间隔着一个 DB,所以这段没法在单测里真跑 ⇒
 *
 * - **行为**:组装的**纯函数**(`buildWechatPayConfig` / `buildAlipayConfig`)
 *   在 `env.ts` 里 —— 零 DB import,直接测
 * - **接线**:哪一套值喂给哪个模式(`config.ts` 里那行三目 + `env.ts` 里
 *   那些环境变量名)靠**源码扫描**钉住 —— 跟仓库里其它「结构扫描」测试一个
 *   路子(见 `single-chrome.test.ts` / `magnet-page.test.ts`)
 *
 * ## 这里守的不变量,每一条都对应一个**真会收错钱**的方向
 *
 * 1. **沙箱模式只读 `*_sandbox_*`** —— 沙箱凭据**没有环境变量入口**。
 *    反了就是「沙箱那一单用正式密钥签名」⇒ 沙箱那边直接拒签,而报错是
 *    「签名错误」,工作室会以为是代码坏了。
 * 2. **正式模式只读环境变量** —— 沙箱值渗进正式通道 = **真客户的钱付到
 *    沙箱**。
 * 3. **沙箱模式永远不产生正式端点;正式模式永远不产生沙箱端点**(端点解析
 *    那条在 `payment-sandbox.test.ts`,这里守的是「provider 真的把解析结果
 *    用上了」)。
 * 4. **缺字段时消息精确到字段** —— 「这个通道没配好」工作室没法照着改。
 * 5. **签名里的 path 跟发请求的 path 是同一个** —— 微信沙箱跟正式**同一个
 *    host**,区别只在 path 前缀,而 **path 要进签名串**。签名用正式 path、
 *    请求用沙箱 path(或者反过来)⇒ `SIGN_ERROR`,报错完全看不出是路径的事。
 *
 * ## 为什么「同值检测」在这一个文件里也测一遍
 *
 * `detectSameCredential` 本身在 `payment-sandbox.test.ts` 里测过(纯人工值)。
 * 这里用**真的** `readWechatProductionValues()` 输出再测一遍 —— 那一份是从
 * 环境变量读的,键空间映射错了的话,人工值测试**照样会过**。
 */

import {
  ALIPAY_PRODUCTION_GATEWAY,
  ALIPAY_SANDBOX_GATEWAY,
  detectSameCredential,
  PAYMENT_SETTING_KEYS,
  WECHAT_PRODUCTION_NATIVE_PATH,
  WECHAT_PRODUCTION_REFUND_PATH,
  WECHAT_SANDBOX_API_BASE,
  WECHAT_SANDBOX_NATIVE_PATH,
} from "@/features/payments/lib/sandbox";
import { PaymentNotConfiguredError } from "@/features/payments/lib/types";
import {
  buildAlipayConfig,
  readAlipayProductionValues,
} from "@/features/payments/providers/alipay/env";
import {
  buildWechatPayConfig,
  readWechatProductionValues,
} from "@/features/payments/providers/wechat/env";
import { createNativeOrder } from "@/features/payments/providers/wechat/native";
import {
  buildSignMessage,
  signWithPrivateKey,
} from "@/features/payments/providers/wechat/signature";

/** 仓库根目录 —— 源码扫描用 */
const ROOT = resolve(process.cwd());

/** 读一份源码文件 */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 现生成一对 RSA 密钥 —— 不依赖仓库里任何固定密钥 */
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

/** 32 字节的 APIv3 密钥(长度不对微信那边解不开) */
const API_V3_KEY = "0123456789abcdef0123456789abcdef";

/* -------------------------------------------------------------------------- */
/*  夹具                                                                       */
/* -------------------------------------------------------------------------- */

/** 微信**沙箱**那一套的值(键是 `*_sandbox_*` 那一套) */
function wechatSandboxValues(
  overrides: Record<string, string> = {}
): Record<string, string> {
  return {
    [PAYMENT_SETTING_KEYS.wechatSandboxMchId]: "1900000109",
    [PAYMENT_SETTING_KEYS.wechatSandboxAppId]: "wxsandboxappid001",
    [PAYMENT_SETTING_KEYS.wechatSandboxApiV3Key]: API_V3_KEY,
    [PAYMENT_SETTING_KEYS.wechatSandboxSerialNo]: "SANDBOXSERIAL01",
    [PAYMENT_SETTING_KEYS.wechatSandboxPrivateKey]: privateKey,
    [PAYMENT_SETTING_KEYS.wechatSandboxPublicKey]: publicKey,
    [PAYMENT_SETTING_KEYS.wechatSandboxPublicKeyId]: "PUBKEYID0001",
    [PAYMENT_SETTING_KEYS.wechatSandboxPlatformCertDir]: "",
    [PAYMENT_SETTING_KEYS.wechatSandboxApiBase]: "",
    [PAYMENT_SETTING_KEYS.wechatSandboxNativePath]: "",
    [PAYMENT_SETTING_KEYS.wechatSandboxNotifyUrl]: "",
    ...overrides,
  };
}

/** 支付宝**沙箱**那一套的值 */
function alipaySandboxValues(
  overrides: Record<string, string> = {}
): Record<string, string> {
  return {
    [PAYMENT_SETTING_KEYS.alipaySandboxAppId]: "2021000000000000",
    [PAYMENT_SETTING_KEYS.alipaySandboxAppPrivateKey]: privateKey,
    [PAYMENT_SETTING_KEYS.alipaySandboxPublicKey]: publicKey,
    [PAYMENT_SETTING_KEYS.alipaySandboxGateway]: "",
    [PAYMENT_SETTING_KEYS.alipaySandboxNotifyUrl]: "",
    ...overrides,
  };
}

/** 把环境变量临时改掉 —— 测完还原 */
const savedEnv = new Map<string, string | undefined>();

function setEnv(name: string, value: string | undefined): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/*  微信配置组装                                                               */
/* -------------------------------------------------------------------------- */

describe("buildWechatPayConfig —— 沙箱 / 正式两套配置", () => {
  it("沙箱标志跟着模式走", () => {
    const sandbox = buildWechatPayConfig({
      mode: "sandbox",
      values: wechatSandboxValues(),
      apiBase: WECHAT_SANDBOX_API_BASE,
      nativePath: WECHAT_SANDBOX_NATIVE_PATH,
      refundPath: WECHAT_PRODUCTION_REFUND_PATH,
      siteUrl: "https://example.com",
    });
    const production = buildWechatPayConfig({
      mode: "production",
      values: wechatSandboxValues(),
      apiBase: WECHAT_SANDBOX_API_BASE,
      nativePath: WECHAT_SANDBOX_NATIVE_PATH,
      refundPath: WECHAT_PRODUCTION_REFUND_PATH,
      siteUrl: "https://example.com",
    });

    expect(sandbox.sandbox).toBe(true);
    expect(production.sandbox).toBe(false);
  });

  it("凭据原样带出来 —— 沙箱那一套的值就是沙箱那一套的值", () => {
    const config = buildWechatPayConfig({
      mode: "sandbox",
      values: wechatSandboxValues(),
      apiBase: WECHAT_SANDBOX_API_BASE,
      nativePath: WECHAT_SANDBOX_NATIVE_PATH,
      refundPath: WECHAT_PRODUCTION_REFUND_PATH,
      siteUrl: "https://example.com",
    });

    expect(config.mchId).toBe("1900000109");
    expect(config.appId).toBe("wxsandboxappid001");
    expect(config.apiV3Key).toBe(API_V3_KEY);
    expect(config.serialNo).toBe("SANDBOXSERIAL01");
  });

  it("端点原样带出去 —— apiBase / nativePath 不许被偷偷改", () => {
    const config = buildWechatPayConfig({
      mode: "sandbox",
      values: wechatSandboxValues(),
      apiBase: WECHAT_SANDBOX_API_BASE,
      nativePath: WECHAT_SANDBOX_NATIVE_PATH,
      refundPath: WECHAT_PRODUCTION_REFUND_PATH,
      siteUrl: "https://example.com",
    });

    expect(config.apiBase).toBe(WECHAT_SANDBOX_API_BASE);
    expect(config.nativePath).toBe(WECHAT_SANDBOX_NATIVE_PATH);
  });

  it("缺字段时消息**精确**说缺哪个 —— 已配好的那个不许出现", () => {
    const values = wechatSandboxValues({
      [PAYMENT_SETTING_KEYS.wechatSandboxMchId]: "",
    });

    let thrown: unknown;
    try {
      buildWechatPayConfig({
        mode: "sandbox",
        values,
        apiBase: WECHAT_SANDBOX_API_BASE,
        nativePath: WECHAT_SANDBOX_NATIVE_PATH,
        refundPath: WECHAT_PRODUCTION_REFUND_PATH,
        siteUrl: "https://example.com",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PaymentNotConfiguredError);
    const error = thrown as PaymentNotConfiguredError;
    expect(error.channel).toBe("wechat");
    expect(error.message).toContain("商户号");
    // 已经配好的那些**不许**出现在缺失提示里
    expect(error.message).not.toContain("AppID");
    expect(error.message).not.toContain("APIv3");
    expect(error.message).not.toContain("序列号");
  });

  it("缺失提示指向**值的来源** —— 沙箱指后台,正式指环境变量", () => {
    const values = wechatSandboxValues({
      [PAYMENT_SETTING_KEYS.wechatSandboxMchId]: "",
    });

    const sandboxError = (() => {
      try {
        buildWechatPayConfig({
          mode: "sandbox",
          values,
          apiBase: WECHAT_SANDBOX_API_BASE,
          nativePath: WECHAT_SANDBOX_NATIVE_PATH,
          refundPath: WECHAT_PRODUCTION_REFUND_PATH,
          siteUrl: "https://example.com",
        });
        return null;
      } catch (error) {
        return error as Error;
      }
    })();

    const productionError = (() => {
      try {
        buildWechatPayConfig({
          mode: "production",
          values,
          apiBase: WECHAT_SANDBOX_API_BASE,
          nativePath: WECHAT_SANDBOX_NATIVE_PATH,
          refundPath: WECHAT_PRODUCTION_REFUND_PATH,
          siteUrl: "https://example.com",
        });
        return null;
      } catch (error) {
        return error as Error;
      }
    })();

    expect(sandboxError?.message).toContain("后台");
    expect(sandboxError?.message).not.toContain("WECHAT_PAY_");
    expect(productionError?.message).toContain("WECHAT_PAY_");
  });

  it("缺失提示**只给方向**不给变量名 —— 精确的变量名在后台那一页列", () => {
    // 这一条消息在服务端日志里 —— 变量名太多的话一行太长;
    // 精确到字段的那份在后台「当前生效状态」里(走 `describeMissingFields`)。
    const error = (() => {
      try {
        buildWechatPayConfig({
          mode: "production",
          values: wechatSandboxValues({
            [PAYMENT_SETTING_KEYS.wechatSandboxMchId]: "",
          }),
          apiBase: WECHAT_SANDBOX_API_BASE,
          nativePath: WECHAT_SANDBOX_NATIVE_PATH,
          refundPath: WECHAT_PRODUCTION_REFUND_PATH,
          siteUrl: "https://example.com",
        });
        return null;
      } catch (e) {
        return e as Error;
      }
    })();

    // 说清楚「缺哪一项」,但用通配符指方向
    expect(error?.message).toContain("缺商户号");
    expect(error?.message).toContain("WECHAT_PAY_*");
    expect(error?.message).not.toContain("WECHAT_PAY_MCH_ID");
  });

  it("APIv3 密钥不是 32 字节 ⇒ 当场拦住(报错是「解密失败」,看不出是长度)", () => {
    let thrown: unknown;
    try {
      buildWechatPayConfig({
        mode: "sandbox",
        values: wechatSandboxValues({
          [PAYMENT_SETTING_KEYS.wechatSandboxApiV3Key]: "太短了",
        }),
        apiBase: WECHAT_SANDBOX_API_BASE,
        nativePath: WECHAT_SANDBOX_NATIVE_PATH,
        refundPath: WECHAT_PRODUCTION_REFUND_PATH,
        siteUrl: "https://example.com",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PaymentNotConfiguredError);
    expect((thrown as Error).message).toContain("32 字节");
  });

  it("验签材料两套都没 ⇒ 拦住(否则钱付了但订单永远不标已付)", () => {
    let thrown: unknown;
    try {
      buildWechatPayConfig({
        mode: "sandbox",
        values: wechatSandboxValues({
          [PAYMENT_SETTING_KEYS.wechatSandboxPublicKey]: "",
          [PAYMENT_SETTING_KEYS.wechatSandboxPublicKeyId]: "",
          [PAYMENT_SETTING_KEYS.wechatSandboxPlatformCertDir]: "",
        }),
        apiBase: WECHAT_SANDBOX_API_BASE,
        nativePath: WECHAT_SANDBOX_NATIVE_PATH,
        refundPath: WECHAT_PRODUCTION_REFUND_PATH,
        siteUrl: "https://example.com",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PaymentNotConfiguredError);
    expect((thrown as Error).message).toContain("验签材料");
  });

  it("只有平台证书目录(公钥模式没配)⇒ 放行 —— 两套验签模式任一套齐了就行", () => {
    const config = buildWechatPayConfig({
      mode: "sandbox",
      values: wechatSandboxValues({
        [PAYMENT_SETTING_KEYS.wechatSandboxPublicKey]: "",
        [PAYMENT_SETTING_KEYS.wechatSandboxPublicKeyId]: "",
        [PAYMENT_SETTING_KEYS.wechatSandboxPlatformCertDir]:
          "/etc/wechat/certs",
      }),
      apiBase: WECHAT_SANDBOX_API_BASE,
      nativePath: WECHAT_SANDBOX_NATIVE_PATH,
      refundPath: WECHAT_PRODUCTION_REFUND_PATH,
      siteUrl: "https://example.com",
    });

    expect(config.publicKeyPem).toBeNull();
    expect(config.publicKeyId).toBeNull();
    expect(config.platformCertDir).toBe("/etc/wechat/certs");
  });

  it("通知地址:显式配了用它;没配就拿站点地址拼", () => {
    const explicit = buildWechatPayConfig({
      mode: "sandbox",
      values: wechatSandboxValues({
        [PAYMENT_SETTING_KEYS.wechatSandboxNotifyUrl]:
          "https://sandbox.example.com/api/webhooks/wechat",
      }),
      apiBase: WECHAT_SANDBOX_API_BASE,
      nativePath: WECHAT_SANDBOX_NATIVE_PATH,
      refundPath: WECHAT_PRODUCTION_REFUND_PATH,
      siteUrl: "https://example.com",
    });
    expect(explicit.notifyUrl).toBe(
      "https://sandbox.example.com/api/webhooks/wechat"
    );

    const derived = buildWechatPayConfig({
      mode: "sandbox",
      values: wechatSandboxValues(),
      apiBase: WECHAT_SANDBOX_API_BASE,
      nativePath: WECHAT_SANDBOX_NATIVE_PATH,
      refundPath: WECHAT_PRODUCTION_REFUND_PATH,
      siteUrl: "https://example.com",
    });
    expect(derived.notifyUrl).toBe("https://example.com/api/webhooks/wechat");
  });

  it("通知地址没配 + 站点地址也没有 ⇒ 拦住(收不到通知 = 收不到钱)", () => {
    let thrown: unknown;
    try {
      buildWechatPayConfig({
        mode: "sandbox",
        values: wechatSandboxValues(),
        apiBase: WECHAT_SANDBOX_API_BASE,
        nativePath: WECHAT_SANDBOX_NATIVE_PATH,
        refundPath: WECHAT_PRODUCTION_REFUND_PATH,
        siteUrl: null,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PaymentNotConfiguredError);
    expect((thrown as Error).message).toContain("/api/webhooks/wechat");
  });

  it("私钥写成一行(\\n 转义)也认 —— 环境变量里一行写不下完整 PEM", () => {
    const oneLine = privateKey.replace(/\n/g, "\\n");
    const config = buildWechatPayConfig({
      mode: "sandbox",
      values: wechatSandboxValues({
        [PAYMENT_SETTING_KEYS.wechatSandboxPrivateKey]: oneLine,
      }),
      apiBase: WECHAT_SANDBOX_API_BASE,
      nativePath: WECHAT_SANDBOX_NATIVE_PATH,
      refundPath: WECHAT_PRODUCTION_REFUND_PATH,
      siteUrl: "https://example.com",
    });

    expect(config.privateKeyPem).toContain("\n-----END");
  });
});

/* -------------------------------------------------------------------------- */
/*  支付宝配置组装                                                             */
/* -------------------------------------------------------------------------- */

describe("buildAlipayConfig —— 沙箱 / 正式两套配置", () => {
  it("沙箱标志跟着模式走", () => {
    const sandbox = buildAlipayConfig({
      mode: "sandbox",
      values: alipaySandboxValues(),
      gateway: ALIPAY_SANDBOX_GATEWAY,
      siteUrl: "https://example.com",
      returnUrl: null,
    });
    const production = buildAlipayConfig({
      mode: "production",
      values: alipaySandboxValues(),
      gateway: ALIPAY_PRODUCTION_GATEWAY,
      siteUrl: "https://example.com",
      returnUrl: null,
    });

    expect(sandbox.sandbox).toBe(true);
    expect(production.sandbox).toBe(false);
  });

  it("网关原样带出去(已经过沙箱 / 正式冲突校验)", () => {
    const config = buildAlipayConfig({
      mode: "sandbox",
      values: alipaySandboxValues(),
      gateway: ALIPAY_SANDBOX_GATEWAY,
      siteUrl: "https://example.com",
      returnUrl: null,
    });

    expect(config.gateway).toBe(ALIPAY_SANDBOX_GATEWAY);
  });

  it("缺字段时消息**精确**说缺哪个", () => {
    let thrown: unknown;
    try {
      buildAlipayConfig({
        mode: "sandbox",
        values: alipaySandboxValues({
          [PAYMENT_SETTING_KEYS.alipaySandboxAppId]: "",
        }),
        gateway: ALIPAY_SANDBOX_GATEWAY,
        siteUrl: "https://example.com",
        returnUrl: null,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PaymentNotConfiguredError);
    const error = thrown as PaymentNotConfiguredError;
    expect(error.channel).toBe("alipay");
    expect(error.message).toContain("APPID");
    expect(error.message).not.toContain("私钥");
  });

  it("缺支付宝公钥 ⇒ 说清「不是应用公钥」(填反了是通知永远验不过)", () => {
    let thrown: unknown;
    try {
      buildAlipayConfig({
        mode: "sandbox",
        values: alipaySandboxValues({
          [PAYMENT_SETTING_KEYS.alipaySandboxPublicKey]: "",
        }),
        gateway: ALIPAY_SANDBOX_GATEWAY,
        siteUrl: "https://example.com",
        returnUrl: null,
      });
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).message).toContain("支付宝公钥");
    expect((thrown as Error).message).toContain("不是应用公钥");
  });

  it("通知地址:显式配了用它;没配就拿站点地址拼", () => {
    const explicit = buildAlipayConfig({
      mode: "sandbox",
      values: alipaySandboxValues({
        [PAYMENT_SETTING_KEYS.alipaySandboxNotifyUrl]:
          "https://sandbox.example.com/api/webhooks/alipay",
      }),
      gateway: ALIPAY_SANDBOX_GATEWAY,
      siteUrl: "https://example.com",
      returnUrl: null,
    });
    expect(explicit.notifyUrl).toBe(
      "https://sandbox.example.com/api/webhooks/alipay"
    );

    const derived = buildAlipayConfig({
      mode: "sandbox",
      values: alipaySandboxValues(),
      gateway: ALIPAY_SANDBOX_GATEWAY,
      siteUrl: "https://example.com",
      returnUrl: null,
    });
    expect(derived.notifyUrl).toBe("https://example.com/api/webhooks/alipay");
  });

  it("通知地址没配 + 站点地址也没有 ⇒ 拦住", () => {
    let thrown: unknown;
    try {
      buildAlipayConfig({
        mode: "sandbox",
        values: alipaySandboxValues(),
        gateway: ALIPAY_SANDBOX_GATEWAY,
        siteUrl: null,
        returnUrl: null,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PaymentNotConfiguredError);
    expect((thrown as Error).message).toContain("/api/webhooks/alipay");
  });
});

/* -------------------------------------------------------------------------- */
/*  正式模式的取值 —— 键空间映射                                               */
/* -------------------------------------------------------------------------- */

describe("readWechatProductionValues —— 正式模式只读环境变量", () => {
  it("环境变量映射到**沙箱那一套的键名** ⇒ 两个模式共用一套诊断", () => {
    setEnv("WECHAT_PAY_MCH_ID", "1900009999");
    setEnv("WECHAT_PAY_APP_ID", "wxprodappid001");

    const values = readWechatProductionValues();

    expect(values[PAYMENT_SETTING_KEYS.wechatSandboxMchId]).toBe("1900009999");
    expect(values[PAYMENT_SETTING_KEYS.wechatSandboxAppId]).toBe(
      "wxprodappid001"
    );
  });

  it("没配的 ⇒ 空串(不是 undefined)—— 诊断那边按「空 = 缺」处理", () => {
    setEnv("WECHAT_PAY_MCH_ID", undefined);
    setEnv("WECHAT_PAY_APP_ID", undefined);

    const values = readWechatProductionValues();

    expect(values[PAYMENT_SETTING_KEYS.wechatSandboxMchId]).toBe("");
    expect(values[PAYMENT_SETTING_KEYS.wechatSandboxAppId]).toBe("");
  });

  it("正式端点**写死** —— 不给任何覆盖口子", () => {
    const values = readWechatProductionValues();

    expect(values[PAYMENT_SETTING_KEYS.wechatSandboxApiBase]).toBe(
      "https://api.mch.weixin.qq.com"
    );
    expect(values[PAYMENT_SETTING_KEYS.wechatSandboxNativePath]).toBe(
      WECHAT_PRODUCTION_NATIVE_PATH
    );
  });

  it("环境变量里的值**优先于**文件路径(内联优先)", () => {
    setEnv("WECHAT_PAY_PRIVATE_KEY", privateKey);
    setEnv("WECHAT_PAY_PRIVATE_KEY_PATH", "/nonexistent/apiclient_key.pem");

    const values = readWechatProductionValues();

    expect(values[PAYMENT_SETTING_KEYS.wechatSandboxPrivateKey]).toContain(
      "BEGIN PRIVATE KEY"
    );
  });
});

describe("readAlipayProductionValues —— 正式模式只读环境变量", () => {
  it("`ALIPAY_GATEWAY` 映射到**沙箱网关那个键**(两个模式共用一个键)", () => {
    setEnv("ALIPAY_GATEWAY", "https://openapi.alipay.com/gateway.do");

    const values = readAlipayProductionValues();

    expect(values[PAYMENT_SETTING_KEYS.alipaySandboxGateway]).toBe(
      "https://openapi.alipay.com/gateway.do"
    );
  });

  it("没配网关 ⇒ 空串(端点解析那边会退回默认的正式网关)", () => {
    setEnv("ALIPAY_GATEWAY", undefined);

    const values = readAlipayProductionValues();

    expect(values[PAYMENT_SETTING_KEYS.alipaySandboxGateway]).toBe("");
  });

  it("APPID / 支付宝公钥也映射到同一套键", () => {
    setEnv("ALIPAY_APP_ID", "2021000000000000");
    setEnv("ALIPAY_PUBLIC_KEY", publicKey);

    const values = readAlipayProductionValues();

    expect(values[PAYMENT_SETTING_KEYS.alipaySandboxAppId]).toBe(
      "2021000000000000"
    );
    // 取值那一层**去掉首尾空白** —— 环境变量里的 PEM 常常多带一个换行
    expect(values[PAYMENT_SETTING_KEYS.alipaySandboxPublicKey]).toBe(
      publicKey.trim()
    );
  });
});

/* -------------------------------------------------------------------------- */
/*  沙箱凭据跟正式同值 = 贴错了                                               */
/* -------------------------------------------------------------------------- */

describe("同值检测 —— 用**真的**正式取值再测一遍", () => {
  it("沙箱的商户号跟正式的一模一样 ⇒ 指出来(大概率贴错了)", () => {
    setEnv("WECHAT_PAY_MCH_ID", "1900000109");

    const production = readWechatProductionValues();
    const sandbox = wechatSandboxValues();

    const same = detectSameCredential({
      sandbox,
      production,
      fields: [
        {
          key: PAYMENT_SETTING_KEYS.wechatSandboxMchId,
          envVar: "WECHAT_PAY_MCH_ID",
          label: "商户号",
        },
      ],
    });

    expect(same.map((field) => field.key)).toEqual([
      PAYMENT_SETTING_KEYS.wechatSandboxMchId,
    ]);
  });

  it("两边不同 ⇒ 不报", () => {
    setEnv("WECHAT_PAY_MCH_ID", "1900009999");

    const same = detectSameCredential({
      sandbox: wechatSandboxValues(),
      production: readWechatProductionValues(),
      fields: [
        {
          key: PAYMENT_SETTING_KEYS.wechatSandboxMchId,
          envVar: "WECHAT_PAY_MCH_ID",
          label: "商户号",
        },
      ],
    });

    expect(same).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/*  接线(源码扫描)                                                             */
/* -------------------------------------------------------------------------- */

describe("接线 —— 沙箱 / 正式两套值不许串", () => {
  it("两个 provider 都按模式分流:沙箱读 raw.sandbox,正式读 raw.production", () => {
    const pattern =
      /mode\s*===\s*"sandbox"\s*\?\s*raw\.sandbox\s*:\s*raw\.production/;

    expect(
      pattern.test(read("src/features/payments/providers/wechat/config.ts"))
    ).toBe(true);
    expect(
      pattern.test(read("src/features/payments/providers/alipay/config.ts"))
    ).toBe(true);
  });

  it("沙箱那一档只从 **DB 行**来,正式那一档只从**环境变量取值**来", () => {
    const source = read("src/features/payments/lib/sandbox-store.ts");

    expect(source).toContain("sandbox: pickChannelValues(requirements, rows)");
    expect(source).toContain(
      "production: pickChannelValues(requirements, productionValues)"
    );
  });

  it("`env.ts` 里**没有**任何沙箱环境变量 —— 沙箱只有后台一个入口", () => {
    for (const file of [
      "src/features/payments/providers/wechat/env.ts",
      "src/features/payments/providers/alipay/env.ts",
    ]) {
      const names = read(file).match(/process\.env\.([A-Z0-9_]+)/g) ?? [];
      expect(names.length, file).toBeGreaterThan(0);
      for (const name of names) {
        expect(name, `${file} → ${name}`).not.toContain("SANDBOX");
      }
    }
  });

  it("`config.ts` **不直接**读凭据环境变量(正式取值只能走 env.ts)", () => {
    const wechat =
      read("src/features/payments/providers/wechat/config.ts").match(
        /process\.env\.([A-Z0-9_]+)/g
      ) ?? [];
    expect(wechat).toEqual([]);

    // 支付宝那个只准留「回跳地址」—— 它是站点级的,不是凭据
    const alipay =
      read("src/features/payments/providers/alipay/config.ts").match(
        /process\.env\.([A-Z0-9_]+)/g
      ) ?? [];
    for (const name of alipay) {
      expect(name).toBe("process.env.ALIPAY_RETURN_URL");
    }
  });

  it("沙箱凭据**不回退到环境变量** —— 沙箱那一套只从 DB 行里挑", () => {
    const source = read("src/features/payments/lib/sandbox-store.ts");

    // 沙箱值 = pickChannelValues(requirements, rows)—— rows 是 DB 读出来的
    expect(source).toMatch(
      /sandbox:\s*pickChannelValues\(\s*requirements,\s*rows\s*\)/
    );
    // 正式值 = pickChannelValues(requirements, productionValues)—— 那是环境变量
    expect(source).toMatch(
      /production:\s*pickChannelValues\(\s*requirements,\s*productionValues\s*\)/
    );
  });
});

/* -------------------------------------------------------------------------- */
/*  签名跟请求同源                                                             */
/* -------------------------------------------------------------------------- */

describe("微信签名 —— 签的 path 跟发的 path 是同一个", () => {
  it("沙箱前缀**进了签名串** —— 拿同一把私钥重算一遍就能对出来", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(
          JSON.stringify({ code_url: "weixin://wxpay/bizpayurl?pr=FAKE" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const result = await createNativeOrder({
      mchId: "1900000109",
      appId: "wxsandboxappid001",
      serialNo: "SANDBOXSERIAL01",
      privateKeyPem: privateKey,
      outTradeNo: "SO-SANDBOX-TEST-1",
      description: "沙箱测试",
      totalCents: 1,
      notifyUrl: "https://example.com/api/webhooks/wechat",
      apiBase: WECHAT_SANDBOX_API_BASE,
      nativePath: WECHAT_SANDBOX_NATIVE_PATH,
    });

    expect(result.codeUrl).toBe("weixin://wxpay/bizpayurl?pr=FAKE");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(
      `${WECHAT_SANDBOX_API_BASE}${WECHAT_SANDBOX_NATIVE_PATH}`
    );

    // 从 Authorization 头里把 nonce / timestamp / signature 解出来
    const auth = new Headers(call?.init.headers).get("Authorization") ?? "";
    const nonce = /nonce_str="([^"]+)"/.exec(auth)?.[1] ?? "";
    const timestamp = /timestamp="([^"]+)"/.exec(auth)?.[1] ?? "";
    const signature = /signature="([^"]+)"/.exec(auth)?.[1] ?? "";
    expect(nonce).not.toBe("");
    expect(timestamp).not.toBe("");
    expect(signature).not.toBe("");

    const body = String(call?.init.body);

    // 用**沙箱 path** 重算签名 ⇒ 必须一模一样(证明签名里带的就是它)
    const withSandboxPath = signWithPrivateKey(
      buildSignMessage({
        method: "POST",
        url: WECHAT_SANDBOX_NATIVE_PATH,
        timestamp,
        nonce,
        body,
      }),
      privateKey
    );
    expect(withSandboxPath).toBe(signature);

    // 用**正式 path** 重算签名 ⇒ 必须**不一样**
    // (反过来证明:签名里带的确实是沙箱前缀,漏了就是微信那边的 SIGN_ERROR)
    const withProductionPath = signWithPrivateKey(
      buildSignMessage({
        method: "POST",
        url: WECHAT_PRODUCTION_NATIVE_PATH,
        timestamp,
        nonce,
        body,
      }),
      privateKey
    );
    expect(withProductionPath).not.toBe(signature);
  });

  it("正式模式:签的 path 就是正式那条", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return new Response(
          JSON.stringify({ code_url: "weixin://wxpay/bizpayurl?pr=FAKE" }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    await createNativeOrder({
      mchId: "1900009999",
      appId: "wxprodappid001",
      serialNo: "PRODSERIAL001",
      privateKeyPem: privateKey,
      outTradeNo: "SO-PRODUCTION-TEST-1",
      description: "正式测试",
      totalCents: 1,
      notifyUrl: "https://example.com/api/webhooks/wechat",
      apiBase: "https://api.mch.weixin.qq.com",
      nativePath: WECHAT_PRODUCTION_NATIVE_PATH,
    });

    const call = calls[0];
    expect(call?.url).toBe(
      "https://api.mch.weixin.qq.com/v3/pay/transactions/native"
    );

    const auth = new Headers(call?.init.headers).get("Authorization") ?? "";
    const nonce = /nonce_str="([^"]+)"/.exec(auth)?.[1] ?? "";
    const timestamp = /timestamp="([^"]+)"/.exec(auth)?.[1] ?? "";
    const signature = /signature="([^"]+)"/.exec(auth)?.[1] ?? "";
    const body = String(call?.init.body);

    const withProductionPath = signWithPrivateKey(
      buildSignMessage({
        method: "POST",
        url: WECHAT_PRODUCTION_NATIVE_PATH,
        timestamp,
        nonce,
        body,
      }),
      privateKey
    );
    expect(withProductionPath).toBe(signature);
  });

  it("沙箱的正式 path 跟请求 URL 不同 ⇒ 两者不可能是同一个 URL", () => {
    // 结构上的前提:沙箱 path 一定带前缀,跟正式那条不一样
    expect(WECHAT_SANDBOX_NATIVE_PATH).not.toBe(WECHAT_PRODUCTION_NATIVE_PATH);
    expect(WECHAT_SANDBOX_NATIVE_PATH).toContain("/sandboxnew/");
  });
});
