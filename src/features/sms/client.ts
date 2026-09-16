/**
 * 阿里云短信 SDK（fetch + 手签 HMAC-SHA1，2026-09-16）
 *
 * 为什么手签不用 @alicloud/dysmsapi20170525？
 *   - SDK 包大小 ~1.5MB+，拖垮 Vercel cold start
 *   - 实际只需要 SendSms 一个接口，手签 70 行代码搞定
 *   - Node 18+ 自带 node:crypto + Web fetch，零依赖
 *
 * 签名规范：阿里云 v3 (ACS3-HMAC-SHA1)
 *   详见 https://help.aliyun.com/document_detail/101939.html
 *
 * 边界：
 *   - 5s 超时（AbortSignal.timeout(5000)），防止 BA 端点被短信网关拖慢
 *   - 失败抛 Error 含 Code + Message，方便 Inngest 重试决策
 *   - 不在本文件做 Inngest dispatch —— 由 utils.ts 的 sendOTP 统一调度
 */

import { createHmac, randomUUID } from "node:crypto";

const ENDPOINT = "dysmsapi.aliyuncs.com";
const REGION = "cn-hangzhou";
const VERSION = "2017-05-25";
const ALGO = "ACS3-HMAC-SHA1";

export type AliyunSmsTemplate = "login" | "reset";

export type SendSMSViaAliyunParams = {
  /** E.164 格式（含 + 前缀）：+8613800138000 */
  phoneNumber: string;
  /** 6 位纯数字 OTP */
  code: string;
  /** 模板用途 —— 决定用 ALIYUN_SMS_TEMPLATE_CODE_LOGIN 还是 _RESET */
  template: AliyunSmsTemplate;
};

export class AliyunSMSError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`Aliyun SMS failed: ${code} ${message}`);
    this.name = "AliyunSMSError";
    this.code = code;
  }
}

export function isAliyunSMSConfigured(): boolean {
  return Boolean(
    process.env.ALIYUN_SMS_ACCESS_KEY_ID &&
      process.env.ALIYUN_SMS_ACCESS_KEY_SECRET &&
      process.env.ALIYUN_SMS_SIGN_NAME &&
      (process.env.ALIYUN_SMS_TEMPLATE_CODE_LOGIN ||
        process.env.ALIYUN_SMS_TEMPLATE_CODE_RESET)
  );
}

/**
 * 直接调用阿里云 SendSms 端点。
 *
 * 触发条件：sendOTP 的「prod 同步 fallback」分支。
 * 不在 BA plugin sendOTP 回调里直接调 —— 仍走 utils.ts.sendOTP 包装层，
 * 这样 dev console.log + Inngest 异步 fallback 都共享同一份逻辑。
 */
export async function sendSMSViaAliyun(
  params: SendSMSViaAliyunParams
): Promise<void> {
  if (!isAliyunSMSConfigured()) {
    throw new Error(
      "Aliyun SMS 未配置：缺少 ALIYUN_SMS_ACCESS_KEY_ID / _SECRET / _SIGN_NAME / _TEMPLATE_CODE_*"
    );
  }

  const accessKeyId = process.env.ALIYUN_SMS_ACCESS_KEY_ID as string;
  const accessKeySecret = process.env.ALIYUN_SMS_ACCESS_KEY_SECRET as string;
  const signName = process.env.ALIYUN_SMS_SIGN_NAME as string;
  const templateId =
    params.template === "login"
      ? (process.env.ALIYUN_SMS_TEMPLATE_CODE_LOGIN ?? "")
      : (process.env.ALIYUN_SMS_TEMPLATE_CODE_RESET ?? "");

  // 公共参数 + 业务参数
  const queryParams: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: params.phoneNumber,
    RegionId: REGION,
    SignName: signName,
    SignatureMethod: ALGO,
    SignatureNonce: randomUUID(),
    SignatureVersion: "1.0",
    TemplateCode: templateId,
    TemplateParam: JSON.stringify({ code: params.code }),
    Timestamp: new Date().toISOString(),
    Version: VERSION,
  };

  // 1. 按 Key 排序后拼 canonicalized query string
  const sortedKeys = Object.keys(queryParams).sort();
  const canonicalized = sortedKeys
    .map((k) => {
      const v = queryParams[k] as string;
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    })
    .join("&");

  // 2. ACS3-HMAC-SHA1 签名：POST&%2F&<URL-encoded canonicalized>
  const stringToSign = `POST&%2F&${encodeURIComponent(canonicalized)}`;
  const signature = createHmac("sha1", `${accessKeySecret}&`)
    .update(stringToSign)
    .digest("base64");

  // 3. body 把 Signature 加进去
  const body = new URLSearchParams({
    ...queryParams,
    Signature: signature,
  }).toString();

  // 4. fetch
  const res = await fetch(`https://${ENDPOINT}/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new AliyunSMSError(
      `HTTP_${res.status}`,
      `${res.statusText} (阿里云 SMS HTTP 失败)`
    );
  }

  const json = (await res.json()) as {
    Code?: string;
    Message?: string;
    RequestId?: string;
    BizId?: string;
  };

  if (json.Code !== "OK") {
    throw new AliyunSMSError(
      json.Code ?? "UNKNOWN",
      json.Message ?? "未知错误"
    );
  }
}
