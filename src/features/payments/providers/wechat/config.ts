/**
 * 微信支付的**运行时配置** —— 按模式分流
 *
 * ## 两种模式的凭据来自**两个完全不同的地方**
 *
 * | 模式 | 凭据从哪儿来 |
 * |---|---|
 * | 沙箱 | `payment_setting` 表(后台 `/admin/payment-settings` 配的) |
 * | 正式 | 环境变量 `WECHAT_PAY_*` |
 *
 * 两套**完全不相干** —— 半配置不会变成「一半沙箱一半正式」的混合签名。
 *
 * ## 为什么读配置是**异步**的
 *
 * 沙箱凭据在 DB 里 ⇒ 读配置天然是 async ⇒ `getWechatPayConfig()` 返回
 * `Promise<WechatPayConfig>`。
 *
 * `env.ts` 里那个**纯函数** `buildWechatPayConfig()` 才是组装的本体 ——
 * 它不碰 DB、不碰环境变量,只做「拿到值之后组装 + 校验」,能进 `unit` project
 * 跑单测。
 */

import {
  PAYMENT_SETTING_KEYS,
  type PaymentRuntimeMode,
  resolveWechatEndpointParts,
} from "@/features/payments/lib/sandbox";
import {
  getPaymentChannelRawValues,
  type PaymentChannelRawValues,
} from "@/features/payments/lib/sandbox-store";
import { PaymentNotConfiguredError } from "@/features/payments/lib/types";

import {
  buildWechatPayConfig,
  readWechatSiteUrl,
  type WechatPayConfig,
} from "./env";

/** 已经打过的端点 —— 一个进程打一次,别把日志刷爆 */
const loggedEndpoints = new Set<string>();

/**
 * 记一条**确切端点**的日志
 *
 * ## 为什么要有这条
 *
 * 微信沙箱跟正式**同一个 host** —— 区别**只在 path**。只看 host 根本分不出
 * 现在打到哪儿去了,而 path 填错的后果是「签名错误」(`SIGN_ERROR`)——
 * 报错完全看不出是路径的问题。
 *
 * ⇒ 把 base + path **拼好的完整 URL** 打出来,一眼就能看出对不对。
 *
 * 跟 `registry.ts` 那条「跑在沙箱模式」的横幅**合起来看**:横幅说「现在是
 * 沙箱」,这条说「沙箱的哪个 URL」。
 */
function logEndpointOnce(mode: PaymentRuntimeMode, endpoint: string): void {
  const key = `${mode}:${endpoint}`;
  if (loggedEndpoints.has(key)) return;
  loggedEndpoints.add(key);

  const label = mode === "sandbox" ? "沙箱端点" : "正式端点";
  console.warn(
    `[payments][wechat] ${label}:${endpoint}` +
      (mode === "sandbox" ? " —— ⚠️ 这是**沙箱**,沙箱单不会真的扣钱" : "")
  );
}

/**
 * 按**指定模式**组装一份配置
 *
 * 端点也按模式解析 —— 沙箱走 DB 里那个 base + path,正式走**写死**的那条。
 */
async function buildConfigForMode(
  mode: PaymentRuntimeMode,
  raw: PaymentChannelRawValues
): Promise<WechatPayConfig> {
  const values = mode === "sandbox" ? raw.sandbox : raw.production;

  const endpoint = resolveWechatEndpointParts({
    mode,
    sandboxApiBase:
      raw.sandbox[PAYMENT_SETTING_KEYS.wechatSandboxApiBase] || null,
    sandboxNativePath:
      raw.sandbox[PAYMENT_SETTING_KEYS.wechatSandboxNativePath] || null,
  });
  if (!endpoint.ok) {
    throw new PaymentNotConfiguredError("wechat", endpoint.message);
  }

  logEndpointOnce(mode, endpoint.endpoint);

  return buildWechatPayConfig({
    mode,
    values,
    apiBase: endpoint.apiBase,
    nativePath: endpoint.nativePath,
    siteUrl: readWechatSiteUrl(),
  });
}

/**
 * 通道配好了没
 *
 * 「配好了」的判据 = **建得出支付会话 + 收得到通知 + 验得了签**:
 * 商户号、appid、APIv3 密钥、证书序列号、私钥、通知地址、验签材料都得有。
 *
 * 界面据此决定要不要显示「微信支付」这个选项 —— 让用户点一个注定失败的按钮,
 * 比不给他这个选项更糟。
 */
export async function isWechatPayConfigured(): Promise<boolean> {
  try {
    await getWechatPayConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * 完整配置 —— **当前生效的模式**那一份
 *
 * 缺什么就抛 `PaymentNotConfiguredError`(调用方能把它跟「这次调用挂了」
 * 分开,见 `storefront/lib/payment-issue.ts`)。
 */
export async function getWechatPayConfig(): Promise<WechatPayConfig> {
  const raw = await getPaymentChannelRawValues("wechat");

  if (raw.modeInvalid) {
    throw new PaymentNotConfiguredError(
      "wechat",
      "微信支付的沙箱开关认不出来 —— 请到后台「支付设置」把它设成「沙箱」或「正式」"
    );
  }

  return buildConfigForMode(raw.mode, raw);
}

/**
 * **两个模式**的配置 —— **当前模式那一份排在前面**
 *
 * ## 为什么要给两份
 *
 * 拨开关的瞬间可能有**在途付款**:切到沙箱时,一笔**正式**订单的通知到了
 * ⇒ 用沙箱公钥验不过 ⇒ **真钱收了但订单不标已付**(钱收了、货没开工)。
 *
 * ⇒ 验签时**先试当前模式的凭据,再试另一个模式的**。另一套验不过就照旧
 * 拒绝 —— 只是多试一次,**不放松任何校验**。
 *
 * 某一档没配好就**跳过那一档**(不是整个失败)—— 只有一档能用时,那一档
 * 就够了。
 */
export async function getWechatPayConfigs(): Promise<WechatPayConfig[]> {
  const raw = await getPaymentChannelRawValues("wechat");

  const modes: PaymentRuntimeMode[] =
    raw.mode === "sandbox"
      ? ["sandbox", "production"]
      : ["production", "sandbox"];

  const out: WechatPayConfig[] = [];
  for (const mode of modes) {
    try {
      out.push(await buildConfigForMode(mode, raw));
    } catch {
      // 那一档没配好 —— 跳过。另一档能用就行。
    }
  }
  return out;
}
