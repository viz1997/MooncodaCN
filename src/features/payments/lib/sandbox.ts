/**
 * 支付**沙箱模式**的纯逻辑 —— 零 import(能进 `unit` project 跑单测)
 *
 * ## 这一层管什么
 *
 * 工作室 2026-11-13 的要求:**「支付宝、微信支付先用沙盒测试验证」**,补一句
 * **「可以后台配置」**。
 *
 * 两个通道的代码都写好了,但**一次真单都没跑过** —— 商户号 / 应用还在走开通
 * 流程,`WECHAT_PAY_*` / `ALIPAY_*` 那几组环境变量一行都没配。沙箱就是那一步:
 * 用两个平台自己的测试环境把「下单 → 付款 → 平台推通知 → 验签 → 订单变已付
 * → 购物袋摘掉买掉的那几行」整条链路跑通。
 *
 * 这一层是**纯函数**:键名表、模式解析、端点解析、缺字段诊断、凭据同值检测。
 * **零 import** —— 不引 `@/db`、不引 `server-only` ⇒ 后台页面、provider、
 * 命令行自检脚本都能安全 import 它。
 *
 * ## 三条硬规矩(方向不对称 —— 「误收真钱」的代价远大于「白测一次」)
 *
 * 1. **默认正式** —— 迁移脚本**不写任何一行配置** ⇒ 部署这个改动,线上行为
 *    **一个字都不变**。
 * 2. **沙箱模式永远不产生正式端点** —— 沙箱网关指向 `openapi.alipay.com`
 *    ⇒ 报冲突,通道判「没配好」。
 * 3. **正式模式永远不产生沙箱端点** —— `ALIPAY_GATEWAY` 指向 `*alipaydev.com`
 *    ⇒ 报冲突,通道判「没配好」。微信正式端点**写死**,没有覆盖口子。
 *
 * ## 为什么「沙箱凭据」和「正式凭据」是两套命名空间
 *
 * | | 沙箱模式 | 正式模式 |
 * |---|---|---|
 * | 微信 | **只**读 `payment_setting` 里的 `wechat_sandbox_*` | **只**读环境变量 `WECHAT_PAY_*` |
 * | 支付宝 | **只**读 `payment_setting` 里的 `alipay_sandbox_*` | **只**读环境变量 `ALIPAY_*` |
 *
 * 半配置不会变成「一半沙箱一半正式」的混合签名;而且工作室**还没正式资质**
 * 这件事**完全不影响**沙箱自检。
 *
 * ⚠️ **沙箱凭据不回退到环境变量** —— 少一个来源 = 少一处能传错的地方。
 * 后台那一页就是沙箱凭据的**唯一**配置处。
 */

/* -------------------------------------------------------------------------- */
/*  常量                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 支付宝**正式**网关
 *
 * 正式端点**只有这一个** —— 不提供覆盖口子(要改就改代码)。
 */
export const ALIPAY_PRODUCTION_GATEWAY =
  "https://openapi.alipay.com/gateway.do";

/**
 * 支付宝**新**沙箱网关(当前官方那套)
 *
 * ⚠️ 支付宝有**两套**沙箱,而且 **APPID 完全不通用**:
 *
 * | 沙箱 | 网关 | APPID |
 * |---|---|---|
 * | **新**(当前官方) | `openapi-sandbox.dl.alipaydev.com` | 新沙箱应用 |
 * | **旧**(legacy) | `openapi.alipaydev.com` | 旧沙箱应用 |
 *
 * ⇒ 沙箱网关**必须可配**,不能写死 —— 用新沙箱的 APPID 打旧网关会返回
 * `40002 invalid-app-id`,而用旧 APPID 打新网关也一样。
 */
export const ALIPAY_SANDBOX_GATEWAY =
  "https://openapi-sandbox.dl.alipaydev.com/gateway.do";

/** 支付宝**旧**沙箱网关(legacy)—— 后台能填,但别跟新沙箱的 APPID 混用 */
export const ALIPAY_SANDBOX_GATEWAY_LEGACY =
  "https://openapi.alipaydev.com/gateway.do";

/** 微信支付 API 根地址 —— 正式端点**写死** */
export const WECHAT_PRODUCTION_API_BASE = "https://api.mch.weixin.qq.com";

/** 微信支付**正式** Native 下单路径 */
export const WECHAT_PRODUCTION_NATIVE_PATH = "/v3/pay/transactions/native";

/**
 * 微信**沙箱** API 根地址
 *
 * ⚠️ **跟正式是同一个 host** —— 沙箱的区别**只在 path 前缀**。
 * 校验对象是 **path 不是 host**;而且 path **要进签名**(见 `native.ts`)。
 */
export const WECHAT_SANDBOX_API_BASE = "https://api.mch.weixin.qq.com";

/**
 * 微信**沙箱** Native 下单路径(默认那档)
 *
 * 微信沙箱的路径**没有权威文档** —— 至少有两个说法:
 * `/sandboxnew/v3/pay/transactions/native`(多数资料用这个)跟
 * `/v3/sandbox/pay/transactions/native`。
 *
 * ⇒ 路径**可配**,而且自检脚本(`scripts/payment-sandbox-check.ts`)**两个都探**,
 * 靠返回码区分(404 = 路径不存在 → 换下一个)。
 */
export const WECHAT_SANDBOX_NATIVE_PATH =
  "/sandboxnew/v3/pay/transactions/native";

/** 微信沙箱 Native 的**备用**路径 —— 自检脚本第二个要探的 */
export const WECHAT_SANDBOX_NATIVE_PATH_ALT =
  "/v3/sandbox/pay/transactions/native";

/**
 * 微信沙箱路径必须以这个结尾
 *
 * 防止工作室把路径填成别的接口(`/v3/pay/transactions/jsapi`、`/v3/certificates`
 * …)。签名和请求都会因此对不上,报错是「签名错误」,看不出是路径填错了。
 */
export const WECHAT_NATIVE_PATH_SUFFIX = "/pay/transactions/native";

/* -------------------------------------------------------------------------- */
/*  键名表                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 支付设置的键 —— 一行一个键
 *
 * **键名写在代码里**,不写在 DB 里 —— 键是接口,DB 里多出来的行没人认领。
 *
 * 跟 `site_setting` 同形(一张 key/value 表),但**独立一张表**
 * (`payment_setting`):支付设置跟站点设置是两码事,后台也是两个页面。
 */
export const PAYMENT_SETTING_KEYS = {
  /* ---- 微信 ---- */
  /** 微信沙箱开关 —— `true` = 沙箱,`false` = 正式 */
  wechatSandboxEnabled: "wechat_sandbox_enabled",
  /** 微信沙箱 API 根地址(默认 `https://api.mch.weixin.qq.com`) */
  wechatSandboxApiBase: "wechat_sandbox_api_base",
  /** 微信沙箱 Native 下单路径(默认 `/sandboxnew/v3/pay/transactions/native`) */
  wechatSandboxNativePath: "wechat_sandbox_native_path",
  /** 沙箱商户号 */
  wechatSandboxMchId: "wechat_sandbox_mch_id",
  /** 沙箱 AppID */
  wechatSandboxAppId: "wechat_sandbox_app_id",
  /** 沙箱 APIv3 密钥(32 字节) */
  wechatSandboxApiV3Key: "wechat_sandbox_api_v3_key",
  /** 沙箱商户证书序列号 */
  wechatSandboxSerialNo: "wechat_sandbox_serial_no",
  /** 沙箱商户私钥(PEM) */
  wechatSandboxPrivateKey: "wechat_sandbox_private_key",
  /** 沙箱微信支付公钥(PEM)—— 公钥模式验回调用 */
  wechatSandboxPublicKey: "wechat_sandbox_public_key",
  /** 沙箱微信支付公钥 ID */
  wechatSandboxPublicKeyId: "wechat_sandbox_public_key_id",
  /** 沙箱平台证书目录 */
  wechatSandboxPlatformCertDir: "wechat_sandbox_platform_cert_dir",
  /** 沙箱通知地址(留空 = 用站点地址拼 `/api/webhooks/wechat`) */
  wechatSandboxNotifyUrl: "wechat_sandbox_notify_url",

  /* ---- 支付宝 ---- */
  /** 支付宝沙箱开关 —— `true` = 沙箱,`false` = 正式 */
  alipaySandboxEnabled: "alipay_sandbox_enabled",
  /** 支付宝沙箱网关(默认新沙箱) */
  alipaySandboxGateway: "alipay_sandbox_gateway",
  /** 沙箱 APPID */
  alipaySandboxAppId: "alipay_sandbox_app_id",
  /** 沙箱应用私钥(PEM) */
  alipaySandboxAppPrivateKey: "alipay_sandbox_app_private_key",
  /** 沙箱支付宝公钥(PEM) */
  alipaySandboxPublicKey: "alipay_sandbox_public_key",
  /** 沙箱通知地址(留空 = 用站点地址拼 `/api/webhooks/alipay`) */
  alipaySandboxNotifyUrl: "alipay_sandbox_notify_url",
} as const;

export type PaymentSettingKey =
  (typeof PAYMENT_SETTING_KEYS)[keyof typeof PAYMENT_SETTING_KEYS];

/** 全部键 —— 迁移脚本 / 后台「重置」用 */
export const ALL_PAYMENT_SETTING_KEYS: PaymentSettingKey[] =
  Object.values(PAYMENT_SETTING_KEYS);

/**
 * **有沙箱模式**的两个通道
 *
 * `shopify` / `stripe` / `offline` 没有沙箱 —— 它们不在这套设置里。
 */
export type SandboxChannel = "wechat" | "alipay";

/* -------------------------------------------------------------------------- */
/*  模式                                                                        */
/* -------------------------------------------------------------------------- */

/** 通道当前跑在哪个环境 */
export type PaymentRuntimeMode = "sandbox" | "production";

/** 解析模式的结果 */
export interface ResolvedMode {
  /** 生效的模式 —— 存着的值是垃圾时是 `production`(但 `invalid` 为真) */
  mode: PaymentRuntimeMode;
  /**
   * 存着的那个值**认不出来** ⇒ 通道判「没配好」
   *
   * **不猜** —— 「默默当正式」= 真收钱,「默默当沙箱」= 白测一次。
   * 两个都比猜更糟,所以宁可让这个通道选不了。
   */
  invalid: boolean;
  /** 存着的原始值(后台要显示「你存的是这个,认不出来」) */
  raw: string | null;
}

/**
 * 解析模式开关 —— **严格**
 *
 * | 存着的值 | 结果 |
 * |---|---|
 * | `true` / `1` / `yes` / `on`(大小写不敏感、去空白) | **沙箱** |
 * | `false` / `0` / `no` / `off` / 空串 / 没这一行 | **正式** |
 * | 其它任何值 | **`invalid`** —— 通道判「没配好」 |
 */
export function resolveSandboxMode(
  raw: string | null | undefined
): ResolvedMode {
  const trimmed = (raw ?? "").trim();

  // 没这一行 / 空串 = 明确走正式(默认值)
  if (!trimmed) return { mode: "production", invalid: false, raw: raw ?? null };

  const lowered = trimmed.toLowerCase();
  if (
    lowered === "true" ||
    lowered === "1" ||
    lowered === "yes" ||
    lowered === "on"
  ) {
    return { mode: "sandbox", invalid: false, raw: trimmed };
  }
  if (
    lowered === "false" ||
    lowered === "0" ||
    lowered === "no" ||
    lowered === "off"
  ) {
    return { mode: "production", invalid: false, raw: trimmed };
  }

  // 认不出来 ⇒ 不猜
  return { mode: "production", invalid: true, raw: trimmed };
}

/* -------------------------------------------------------------------------- */
/*  端点                                                                        */
/* -------------------------------------------------------------------------- */

/** 端点解析失败的码 */
export type SandboxEndpointErrorCode =
  /** 沙箱模式的网关指向了**正式**地址 —— 会收真钱 */
  | "SANDBOX_GATEWAY_IS_PRODUCTION"
  /** 正式模式的网关指向了**沙箱**地址 —— 白测一次 */
  | "PRODUCTION_GATEWAY_IS_SANDBOX"
  /** 网关不是一个合法 URL */
  | "INVALID_GATEWAY_URL"
  /** 微信沙箱的 API 根地址不合法(必须是 https、不能带路径) */
  | "INVALID_API_BASE"
  /** 微信沙箱的下单路径不合法(不以 `/` 开头) */
  | "INVALID_NATIVE_PATH"
  /** 微信沙箱的下单路径**不是** Native 下单接口 */
  | "NATIVE_PATH_NOT_NATIVE"
  /** 微信沙箱的下单路径跟正式那条一模一样 */
  | "NATIVE_PATH_IS_PRODUCTION";

/** 端点解析的结果 */
export type ResolvedEndpoint =
  | { ok: true; endpoint: string }
  | { ok: false; code: SandboxEndpointErrorCode; message: string };

/**
 * 端点解析失败 —— **两种返回类型共用这一个**
 *
 * 支付宝的 `ResolvedEndpoint` 和微信的 `ResolvedWechatEndpoint` 的**失败分支
 * 完全一样**(只有成功分支不一样:微信要多给 base + path)⇒ 失败时只写一遍。
 */
function endpointError(
  code: SandboxEndpointErrorCode,
  message: string
): { ok: false; code: SandboxEndpointErrorCode; message: string } {
  return { ok: false, code, message };
}

/** 取一个 URL 的 host(小写)—— 不是 URL 就返 `null` */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** 是不是支付宝的**正式** host */
export function isAlipayProductionHost(host: string): boolean {
  return host === "openapi.alipay.com";
}

/**
 * 是不是支付宝的**沙箱** host(新旧两个都算)
 *
 * `openapi-sandbox.dl.alipaydev.com` 落在 `.alipaydev.com` 后缀里 ⇒ 一条
 * 判据覆盖两套沙箱。
 */
export function isAlipaySandboxHost(host: string): boolean {
  return host === "openapi.alipaydev.com" || host.endsWith(".alipaydev.com");
}

/**
 * 解析支付宝**网关**
 *
 * ## 两道硬闸
 *
 * - 沙箱模式 ⇒ 网关**不许**是正式地址(否则「沙箱」这一单收的是真钱)
 * - 正式模式 ⇒ 网关**不许**是沙箱地址(否则真单白发,钱收不到)
 *
 * ## 端点是什么
 *
 * 支付宝是**整页跳转** —— 端点就是网关本身,查询参数(`method` / `app_id` /
 * `sign` …)由 `providers/alipay/page-pay.ts` 在后面拼。
 */
export function resolveAlipayEndpoint(input: {
  mode: PaymentRuntimeMode;
  /** 沙箱网关(DB 里那个)—— 留空用默认的新沙箱 */
  sandboxGateway?: string | null;
  /** 正式网关(环境变量 `ALIPAY_GATEWAY`)—— 留空用默认的正式网关 */
  productionGateway?: string | null;
}): ResolvedEndpoint {
  if (input.mode === "production") {
    const raw = input.productionGateway?.trim() || ALIPAY_PRODUCTION_GATEWAY;
    const host = hostOf(raw);
    if (!host) {
      return endpointError(
        "INVALID_GATEWAY_URL",
        `支付宝网关不是一个合法的 URL:${raw}`
      );
    }
    if (isAlipaySandboxHost(host)) {
      return endpointError(
        "PRODUCTION_GATEWAY_IS_SANDBOX",
        `正式模式的支付宝网关指向了沙箱地址(${raw})—— 正式通道绝不能打沙箱,那样真单收不到钱`
      );
    }
    return { ok: true, endpoint: raw };
  }

  const raw = input.sandboxGateway?.trim() || ALIPAY_SANDBOX_GATEWAY;
  const host = hostOf(raw);
  if (!host) {
    return endpointError(
      "INVALID_GATEWAY_URL",
      `支付宝沙箱网关不是一个合法的 URL:${raw}`
    );
  }
  if (isAlipayProductionHost(host)) {
    return endpointError(
      "SANDBOX_GATEWAY_IS_PRODUCTION",
      `沙箱模式的支付宝网关指向了正式地址(${raw})—— 沙箱绝不能收真钱`
    );
  }
  return { ok: true, endpoint: raw };
}

/**
 * 解析微信**端点**的结果 —— base 和 path **分开给**
 *
 * ## 为什么要把 path 单独拎出来
 *
 * 微信沙箱跟正式**同一个 host** —— 区别只在 path 前缀。而**微信的签名串里
 * 带的是 path**,所以 path 填错 = 签名对不上 = `SIGNATURE_ERROR`,报错完全
 * 看不出是路径的问题。
 *
 * ⇒ 端点 = base + path,**两件事绑在一起解析**,签名用它、fetch 也用它。
 *
 * ## 为什么要分开返回
 *
 * `native.ts` 要**同一个变量**既进签名串又拼 fetch 地址(改一处忘了另一处
 * 就是 `SIGN_ERROR`)。⇒ 这里把 `apiBase` / `nativePath` 一起给出去,调用方
 * 把这两个**原样**传下去,结构上就不可能不一致。
 */
export type ResolvedWechatEndpoint =
  | { ok: true; apiBase: string; nativePath: string; endpoint: string }
  | { ok: false; code: SandboxEndpointErrorCode; message: string };

/**
 * 解析微信**端点**(base + path)—— 分开返回 base 和 path
 *
 * ## 正式模式是**写死**的
 *
 * 正式端点**不提供任何覆盖口子** —— 少一个能被人改错的地方。
 */
export function resolveWechatEndpointParts(input: {
  mode: PaymentRuntimeMode;
  /** 沙箱 API 根地址(DB 里那个)—— 留空用默认 */
  sandboxApiBase?: string | null;
  /** 沙箱 Native 下单路径(DB 里那个)—— 留空用默认 */
  sandboxNativePath?: string | null;
}): ResolvedWechatEndpoint {
  if (input.mode === "production") {
    return {
      ok: true,
      apiBase: WECHAT_PRODUCTION_API_BASE,
      nativePath: WECHAT_PRODUCTION_NATIVE_PATH,
      endpoint: `${WECHAT_PRODUCTION_API_BASE}${WECHAT_PRODUCTION_NATIVE_PATH}`,
    };
  }

  const base = input.sandboxApiBase?.trim() || WECHAT_SANDBOX_API_BASE;
  const path = input.sandboxNativePath?.trim() || WECHAT_SANDBOX_NATIVE_PATH;

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return endpointError(
      "INVALID_API_BASE",
      `微信沙箱的 API 根地址不是一个合法的 URL:${base}`
    );
  }
  if (parsed.protocol !== "https:") {
    return endpointError(
      "INVALID_API_BASE",
      `微信沙箱的 API 根地址必须是 https:${base}`
    );
  }
  if (parsed.pathname && parsed.pathname !== "/") {
    return endpointError(
      "INVALID_API_BASE",
      `微信沙箱的 API 根地址不能带路径(只填到域名为止):${base}`
    );
  }

  if (!path.startsWith("/")) {
    return endpointError(
      "INVALID_NATIVE_PATH",
      `微信沙箱的下单路径必须以 "/" 开头:${path}`
    );
  }
  if (!path.endsWith(WECHAT_NATIVE_PATH_SUFFIX)) {
    return endpointError(
      "NATIVE_PATH_NOT_NATIVE",
      `微信沙箱的下单路径必须以 ${WECHAT_NATIVE_PATH_SUFFIX} 结尾(那是 Native 下单接口):${path}`
    );
  }
  if (path === WECHAT_PRODUCTION_NATIVE_PATH) {
    return endpointError(
      "NATIVE_PATH_IS_PRODUCTION",
      `微信沙箱的下单路径跟正式那条一模一样(${path})—— 那就是正式端点,收的是真钱`
    );
  }

  return {
    ok: true,
    apiBase: parsed.origin,
    nativePath: path,
    endpoint: `${parsed.origin}${path}`,
  };
}

/**
 * 解析微信**端点** —— 只给拼好的那个 URL
 *
 * 给「界面上显示端点」「后台显示当前打到哪个 URL」用。
 * **要签名、要发请求**的地方用 `resolveWechatEndpointParts()`(要 base + path)。
 */
export function resolveWechatEndpoint(input: {
  mode: PaymentRuntimeMode;
  sandboxApiBase?: string | null;
  sandboxNativePath?: string | null;
}): ResolvedEndpoint {
  const parts = resolveWechatEndpointParts(input);
  if (!parts.ok) return parts;
  return { ok: true, endpoint: parts.endpoint };
}

/* -------------------------------------------------------------------------- */
/*  凭据字段                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 一个凭据字段 —— 沙箱模式用 `key`(DB 键),正式模式用 `envVar`(环境变量名)
 *
 * 两个键空间**完全不相干**,但**同一个字段**在两种模式下的「值」被映射到
 * **同一个 key 空间**里(见 `sandbox-store.ts`)⇒ 缺字段诊断只写一遍。
 */
export interface FieldGroup {
  /**
   * DB 里的键(沙箱模式)
   *
   * **类型收紧成 `PaymentSettingKey`** —— 键名表是接口,写错一个字母编译器
   * 就该拦下来(后台那一页按 `key` 读写,键名漂了就是写到没人认领的行上)。
   */
  key: PaymentSettingKey;
  /** 环境变量名(正式模式)—— 只用来显示,不参与取值 */
  envVar: string;
  /** 中文标签 —— 后台那一栏的名字 */
  label: string;
  /** 多行文本(PEM)—— 后台给 textarea */
  multiline?: boolean;
  /**
   * 这一项是不是 **PEM 密钥**
   *
   * ⇒ 存进 DB 之前会**规范化换行**(`\n` 转义还原 + 补末尾换行),
   * 后台那一栏也用 textarea。
   */
  pem?: boolean;
  /**
   * 这一项是不是**密钥**(不该明文回到浏览器)
   *
   * 后台那一页是**客户端组件** ⇒ 密钥的原文**不能进 props**。
   * 标了这个的字段:后台只拿到「掩码后的那一小截」,输入框留空 = 保持原值。
   */
  secret?: boolean;
  /** 是不是「可选」的 —— 留空就走默认值 */
  optional?: boolean;
}

/**
 * 一个通道需要哪些字段
 *
 * - `required` —— 每一项都要齐,否则**建不出支付会话**
 * - `verifyAlternatives` —— 验签材料,**任意一组齐了就行**
 *   (微信两套验签模式:公钥模式 vs 平台证书目录)
 * - `settings` —— **端点 / 通知地址**这类「设置」,**全都可选**
 *   (沙箱网关、微信沙箱的 base + path、通知地址)
 *
 * `settings` 单独成一组,而不是塞进 `required` —— 它们**不影响「配好了没」**
 * (留空就走默认值),但后台要能显示、能编辑。
 */
export interface ChannelRequirements {
  required: FieldGroup[];
  verifyAlternatives: FieldGroup[][];
  /** 端点 / 通知地址 —— 全都可选 */
  settings: FieldGroup[];
}

/** 微信支付需要的字段 */
export const WECHAT_REQUIREMENTS: ChannelRequirements = {
  required: [
    {
      key: PAYMENT_SETTING_KEYS.wechatSandboxMchId,
      envVar: "WECHAT_PAY_MCH_ID",
      label: "商户号",
    },
    {
      key: PAYMENT_SETTING_KEYS.wechatSandboxAppId,
      envVar: "WECHAT_PAY_APP_ID",
      label: "AppID",
    },
    {
      key: PAYMENT_SETTING_KEYS.wechatSandboxApiV3Key,
      envVar: "WECHAT_PAY_API_V3_KEY",
      label: "APIv3 密钥(32 字节)",
      secret: true,
    },
    {
      key: PAYMENT_SETTING_KEYS.wechatSandboxSerialNo,
      envVar: "WECHAT_PAY_SERIAL_NO",
      label: "商户证书序列号",
    },
    {
      key: PAYMENT_SETTING_KEYS.wechatSandboxPrivateKey,
      envVar: "WECHAT_PAY_PRIVATE_KEY",
      label: "商户私钥(PEM)",
      multiline: true,
      pem: true,
      secret: true,
    },
  ],
  verifyAlternatives: [
    [
      {
        key: PAYMENT_SETTING_KEYS.wechatSandboxPublicKey,
        envVar: "WECHAT_PAY_PUBLIC_KEY",
        label: "微信支付公钥(PEM)",
        multiline: true,
        pem: true,
        secret: true,
      },
      {
        key: PAYMENT_SETTING_KEYS.wechatSandboxPublicKeyId,
        envVar: "WECHAT_PAY_PUBLIC_KEY_ID",
        label: "微信支付公钥 ID",
      },
    ],
    [
      {
        key: PAYMENT_SETTING_KEYS.wechatSandboxPlatformCertDir,
        envVar: "WECHAT_PAY_PLATFORM_CERT_DIR",
        label: "平台证书目录",
      },
    ],
  ],
  settings: [
    {
      key: PAYMENT_SETTING_KEYS.wechatSandboxApiBase,
      envVar: "(正式端点写死)",
      label: "沙箱 API 根地址",
      optional: true,
    },
    {
      key: PAYMENT_SETTING_KEYS.wechatSandboxNativePath,
      envVar: "(正式端点写死)",
      label: "沙箱 Native 下单路径",
      optional: true,
    },
    {
      key: PAYMENT_SETTING_KEYS.wechatSandboxNotifyUrl,
      envVar: "WECHAT_PAY_NOTIFY_URL",
      label: "通知地址(留空 = 用站点地址拼)",
      optional: true,
    },
  ],
};

/** 支付宝需要的字段 */
export const ALIPAY_REQUIREMENTS: ChannelRequirements = {
  required: [
    {
      key: PAYMENT_SETTING_KEYS.alipaySandboxAppId,
      envVar: "ALIPAY_APP_ID",
      label: "APPID",
    },
    {
      key: PAYMENT_SETTING_KEYS.alipaySandboxAppPrivateKey,
      envVar: "ALIPAY_APP_PRIVATE_KEY",
      label: "应用私钥(PEM)",
      multiline: true,
      pem: true,
      secret: true,
    },
    {
      key: PAYMENT_SETTING_KEYS.alipaySandboxPublicKey,
      envVar: "ALIPAY_PUBLIC_KEY",
      label: "支付宝公钥(PEM)",
      multiline: true,
      pem: true,
      secret: true,
    },
  ],
  // 支付宝只有一套公钥 —— 已经在 required 里了
  verifyAlternatives: [],
  settings: [
    {
      key: PAYMENT_SETTING_KEYS.alipaySandboxGateway,
      envVar: "ALIPAY_GATEWAY",
      label: "沙箱网关地址",
      optional: true,
    },
    {
      key: PAYMENT_SETTING_KEYS.alipaySandboxNotifyUrl,
      envVar: "ALIPAY_NOTIFY_URL",
      label: "通知地址(留空 = 用站点地址拼)",
      optional: true,
    },
  ],
};

/**
 * 一个通道要的全部字段 —— required + 验签材料 + 设置
 *
 * 「要哪些字段」只写在这一处 ⇒ 后台的表单、缺字段诊断、`pickChannelValues`
 * 拿的是**同一份清单**,不会各自维护一份然后漂掉。
 */
export function allChannelFields(
  requirements: ChannelRequirements
): FieldGroup[] {
  return [
    ...requirements.required,
    ...requirements.verifyAlternatives.flat(),
    ...requirements.settings,
  ];
}

/**
 * 从「一堆键值」里挑出这个通道要的字段
 *
 * 值**原样保留**(不 trim)—— PEM 的换行和缩进不能被改。判定「填了没」是
 * `describeMissingFields` 的事(那边 trim)。
 */
export function pickChannelValues(
  requirements: ChannelRequirements,
  values: Record<string, string | null | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of allChannelFields(requirements)) {
    out[field.key] = values[field.key] ?? "";
  }
  return out;
}

/** 值算不算「填了」 */
function isFilled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** 缺字段的结果 */
export interface MissingFields {
  /** 缺了就**建不出支付会话**的字段 */
  missing: FieldGroup[];
  /** 缺了就**验不了通知**的字段(不影响下单) */
  missingVerify: FieldGroup[];
}

/**
 * 列出缺哪几个字段
 *
 * ## 精确到「字段」而不是「没配好」
 *
 * 「这个通道没配好」这句话工作室没法照着改 —— 要能一眼看到**缺哪一个**,
 * 而且**已经配好的那个不许出现在缺失列表里**(最招人烦的就是这个)。
 *
 * ## 验签材料取「缺得最少」的那一组
 *
 * 微信有两套验签模式(公钥 / 平台证书),任意一套齐了就行。提示的时候取
 * 「缺得最少」的那一组 ⇒ 工作室补最少的东西就能通。
 */
export function describeMissingFields(
  requirements: ChannelRequirements,
  values: Record<string, string | null | undefined>
): MissingFields {
  const missing = requirements.required.filter(
    (field) => !field.optional && !isFilled(values[field.key])
  );

  let missingVerify: FieldGroup[] = [];
  if (requirements.verifyAlternatives.length > 0) {
    let best: FieldGroup[] | null = null;
    let bestCount = Number.POSITIVE_INFINITY;
    for (const group of requirements.verifyAlternatives) {
      const absent = group.filter((field) => !isFilled(values[field.key]));
      if (absent.length === 0) {
        best = [];
        bestCount = 0;
        break;
      }
      if (absent.length < bestCount) {
        best = absent;
        bestCount = absent.length;
      }
    }
    missingVerify = best ?? [];
  }

  return { missing, missingVerify };
}

/* -------------------------------------------------------------------------- */
/*  凭据同值检测                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 找出「沙箱凭据跟正式凭据**同值**」的字段
 *
 * ## 为什么这是个错
 *
 * 沙箱和正式是**两套独立的凭据**。同一个值同时出现在两边,**只可能是贴错
 * 了** —— 比如把正式商户号填进了沙箱那一栏,或者把沙箱的 APIv3 密钥当成正式
 * 的用。
 *
 * 后果:沙箱那一单**根本发不出去**(正式密钥在沙箱环境验不过),报错是
 * 「签名错误」,工作室会以为是代码坏了。
 *
 * ⇒ 这里提前指出来:「你贴的是正式那一套的值」。
 *
 * ⚠️ **只当提醒,不当硬闸** —— 极少数情况下两边真的一样(比如测试环境就是
 * 同一个商户)。所以它不进 `configured` 的判定,只是后台的一条黄字。
 */
export function detectSameCredential(input: {
  /** 沙箱那一套的值(按 `FieldGroup.key` 索引) */
  sandbox: Record<string, string | null | undefined>;
  /** 正式那一套的值(**同样按 `FieldGroup.key` 索引**) */
  production: Record<string, string | null | undefined>;
  /** 要比哪些字段 */
  fields: FieldGroup[];
}): FieldGroup[] {
  const out: FieldGroup[] = [];
  for (const field of input.fields) {
    const sandboxValue = (input.sandbox[field.key] ?? "").trim();
    const productionValue = (input.production[field.key] ?? "").trim();
    if (!sandboxValue || !productionValue) continue;
    if (sandboxValue === productionValue) out.push(field);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*  通道评估                                                                    */
/* -------------------------------------------------------------------------- */

/** 一个通道当前的状态 */
export interface ChannelEvaluation {
  /** 生效的模式 */
  mode: PaymentRuntimeMode;
  /** 模式开关存的值认不出来 ⇒ 这个通道选不了 */
  modeInvalid: boolean;
  /** 端点解析的结果 —— `ok: false` 时通道选不了 */
  endpoint: ResolvedEndpoint;
  /** 缺的下单字段 */
  missing: FieldGroup[];
  /** 缺的验签字段 */
  missingVerify: FieldGroup[];
  /**
   * **能不能收钱** —— 端点没问题 + 模式没问题 + 下单字段齐了
   *
   * 验签材料**不算**在这里 —— 缺了能下单,但收不到通知(后台要分开提示)。
   */
  canTransact: boolean;
  /**
   * **是不是完全配好了** —— 能下单 **且** 验签材料齐了
   *
   * 这一条才是「界面上能不能选这个通道」的判据 —— 缺了验签材料的话,
   * 钱付了但订单永远不标已付(通知验不过)。
   */
  configured: boolean;
}

/**
 * 评估一个通道 —— **两个通道口径完全一样**
 *
 * @param requirements 这个通道要哪些字段
 * @param modeRaw 开关存着的原始值
 * @param values **当前模式**下各字段的值(按 `FieldGroup.key` 索引)
 * @param endpoint 端点解析结果
 */
export function evaluateChannel(input: {
  requirements: ChannelRequirements;
  modeRaw: string | null | undefined;
  values: Record<string, string | null | undefined>;
  endpoint: ResolvedEndpoint;
}): ChannelEvaluation {
  const resolvedMode = resolveSandboxMode(input.modeRaw);
  const { missing, missingVerify } = describeMissingFields(
    input.requirements,
    input.values
  );

  const canTransact =
    !resolvedMode.invalid && input.endpoint.ok && missing.length === 0;
  const configured = canTransact && missingVerify.length === 0;

  return {
    mode: resolvedMode.mode,
    modeInvalid: resolvedMode.invalid,
    endpoint: input.endpoint,
    missing,
    missingVerify,
    canTransact,
    configured,
  };
}

/* -------------------------------------------------------------------------- */
/*  密钥回显                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 把一个密钥**掩码**成「已配置(…尾四位)」
 *
 * ## 密钥不回显
 *
 * 后台那一页要能让人确认「我存的那个私钥对不对」,但**不能把私钥原文再显示
 * 一遍** —— 后台页会被截图、会被人看到、可能被 CDN 缓存。
 *
 * ⇒ 只显示**尾四个字符**(工作室自己认得出来)+ 长度。
 *
 * ## PEM 走另一条路
 *
 * PEM 的尾部是 `-----END RSA PRIVATE KEY-----` ⇒ 尾四个字符永远是 `----`,
 * **一点信息量都没有**。⇒ PEM 改成显示**密钥类型**
 * (`已配置(RSA PRIVATE KEY)`)—— 顺便能看出「我是不是把支付宝公钥贴到商户私钥
 * 那一栏去了」。
 */
export function maskSecret(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;

  // PEM —— 显示密钥类型,不露尾字符
  const pem = /-----BEGIN ([A-Z0-9 ]+)-----/.exec(trimmed);
  if (pem) return `已配置(${pem[1]})`;

  if (trimmed.length <= 4) return "已配置";
  return `已配置(…${trimmed.slice(-4)})`;
}
