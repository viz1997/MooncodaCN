/**
 * 支付宝的**运行时配置** —— 按模式分流
 *
 * ## 两种模式的凭据来自**两个完全不同的地方**
 *
 * | 模式 | 凭据从哪儿来 |
 * |---|---|
 * | 沙箱 | `payment_setting` 表(后台 `/admin/payment-settings` 配的) |
 * | 正式 | 环境变量 `ALIPAY_*` |
 *
 * 两套**完全不相干** —— 半配置不会变成「一半沙箱一半正式」的混合签名。
 *
 * ## 为什么读配置是**异步**的
 *
 * 沙箱凭据在 DB 里 ⇒ 读配置天然是 async ⇒ `getAlipayConfig()` 返回
 * `Promise<AlipayConfig>`。
 *
 * `env.ts` 里那个**纯函数** `buildAlipayConfig()` 才是组装的本体 ——
 * 它不碰 DB、不碰环境变量,只做「拿到值之后组装 + 校验」,能进 `unit` project
 * 跑单测。
 */

import {
  PAYMENT_SETTING_KEYS,
  type PaymentRuntimeMode,
  resolveAlipayEndpoint,
} from "@/features/payments/lib/sandbox";
import {
  getPaymentChannelRawValues,
  type PaymentChannelRawValues,
} from "@/features/payments/lib/sandbox-store";
import { PaymentNotConfiguredError } from "@/features/payments/lib/types";

import { type AlipayConfig, buildAlipayConfig, readAlipaySiteUrl } from "./env";

/** 已经打过的端点 —— 一个进程打一次,别把日志刷爆 */
const loggedEndpoints = new Set<string>();

/**
 * 记一条**确切端点**的日志
 *
 * ## 为什么要有这条
 *
 * 支付宝有**两套**沙箱(新的 `openapi-sandbox.dl.alipaydev.com` / 旧的
 * `openapi.alipaydev.com`),而**两套的 APPID 完全不通用** —— 打错网关的
 * 报错是 `40002 invalid-app-id`,工作室会以为是 APPID 填错了。
 *
 * ⇒ 把**拼好的网关地址**打出来,一眼就能看出现在打的是哪套沙箱。
 *
 * 跟 `registry.ts` 那条「跑在沙箱模式」的横幅**合起来看**:横幅说「现在是
 * 沙箱」,这条说「沙箱的哪个网关」。
 */
function logEndpointOnce(mode: PaymentRuntimeMode, endpoint: string): void {
  const key = `${mode}:${endpoint}`;
  if (loggedEndpoints.has(key)) return;
  loggedEndpoints.add(key);

  const label = mode === "sandbox" ? "沙箱网关" : "正式网关";
  console.warn(
    `[payments][alipay] ${label}:${endpoint}` +
      (mode === "sandbox" ? " —— ⚠️ 这是**沙箱**,沙箱单不会真的扣钱" : "")
  );
}

/**
 * 按**指定模式**组装一份配置
 *
 * 网关也按模式解析 —— 沙箱走 DB 里那个,正式走环境变量那个;两边都有
 * **冲突硬闸**(沙箱不许打正式 / 正式不许打沙箱,见 `resolveAlipayEndpoint`)。
 */
async function buildConfigForMode(
  mode: PaymentRuntimeMode,
  raw: PaymentChannelRawValues
): Promise<AlipayConfig> {
  const values = mode === "sandbox" ? raw.sandbox : raw.production;

  const endpoint = resolveAlipayEndpoint({
    mode,
    sandboxGateway:
      raw.sandbox[PAYMENT_SETTING_KEYS.alipaySandboxGateway] || null,
    productionGateway:
      raw.production[PAYMENT_SETTING_KEYS.alipaySandboxGateway] || null,
  });
  if (!endpoint.ok) {
    throw new PaymentNotConfiguredError("alipay", endpoint.message);
  }

  logEndpointOnce(mode, endpoint.endpoint);

  return buildAlipayConfig({
    mode,
    values,
    gateway: endpoint.endpoint,
    siteUrl: readAlipaySiteUrl(),
    // 回跳地址是**站点级**的 —— 沙箱和正式用同一个站点,不用分开配
    returnUrl: process.env.ALIPAY_RETURN_URL?.trim() || null,
  });
}

/**
 * 通道配好了没
 *
 * 「配好了」的判据 = **建得出支付会话 + 收得到通知**:
 * APPID、应用私钥、支付宝公钥、通知地址都得有。
 *
 * 界面据此决定要不要显示「支付宝」这个选项 —— 让用户点一个注定失败的按钮,
 * 比不给他这个选项更糟。
 */
export async function isAlipayConfigured(): Promise<boolean> {
  try {
    await getAlipayConfig();
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
export async function getAlipayConfig(): Promise<AlipayConfig> {
  const raw = await getPaymentChannelRawValues("alipay");

  if (raw.modeInvalid) {
    throw new PaymentNotConfiguredError(
      "alipay",
      "支付宝的沙箱开关认不出来 —— 请到后台「支付设置」把它设成「沙箱」或「正式」"
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
export async function getAlipayConfigs(): Promise<AlipayConfig[]> {
  const raw = await getPaymentChannelRawValues("alipay");

  const modes: PaymentRuntimeMode[] =
    raw.mode === "sandbox"
      ? ["sandbox", "production"]
      : ["production", "sandbox"];

  const out: AlipayConfig[] = [];
  for (const mode of modes) {
    try {
      out.push(await buildConfigForMode(mode, raw));
    } catch {
      // 那一档没配好 —— 跳过。另一档能用就行。
    }
  }
  return out;
}
