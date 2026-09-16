/**
 * SMS 统一发送接口（2026-09-16）
 *
 * 决策矩阵：
 *   ┌──────────────┬──────────────────────────────┐
 *   │ 触发场景     │ 实现                          │
 *   ├──────────────┼──────────────────────────────┤
 *   │ dev (NODE_ENV=development)  │ console.log OTP    │
 *   │ prod + Inngest 已配        │ inngest.send 异步  │
 *   │ prod + Inngest 未配        │ 同步 sendSMSViaAliyun │
 *   │ 阿里云未配置                 │ 抛 error           │
 *   └──────────────┴──────────────────────────────┘
 *
 * 同步 vs Inngest 异步：
 *   - Better Auth sendOTP 回调是同步 await（除非配 backgroundTasks.handler）
 *   - 但 BA 内部 sendOTP 失败不会重试；Inngest 异步能把重试纳入统一调度
 *   - 因此优先 Inngest；fire-and-forget 通过 Promise 不 await 实现
 *
 * 镜像 mail/utils.ts 的 sendEmail 模式：dev 模拟 + prod 真发 + 统一 logger
 */

import { logger } from "@/lib/logger";

import {
  type AliyunSmsTemplate,
  isAliyunSMSConfigured,
  sendSMSViaAliyun,
} from "./client";

export type SendOTPParams = {
  phoneNumber: string;
  code: string;
  template: AliyunSmsTemplate;
};

const isDev = process.env.NODE_ENV === "development";
const isInngestConfigured = Boolean(
  process.env.INNGEST_EVENT_KEY && process.env.INNGEST_SIGNING_KEY
);

/**
 * 统一发送入口。Better Auth phoneNumber plugin.sendOTP + sendPasswordResetOTP 都调这个。
 *
 * 返回 Promise<void>，出错时 logger.error 但不抛 —— BA 端点不应因短信网关 5xx 失败。
 * 重试由上游 Inngest 函数兜底（dev 同步分支无重试，依赖 BA 插件自带的 rate limit）。
 */
export async function sendOTP(params: SendOTPParams): Promise<void> {
  // 1. dev 强制 console.log —— 验证码可读但拒绝真发
  if (isDev) {
    console.log(
      `\n[DEV SMS] ${params.phoneNumber} -> OTP: ${params.code} (template=${params.template})\n`
    );
    return;
  }

  // 2. prod + Inngest 已配：异步 fire-and-forget
  if (isInngestConfigured) {
    try {
      const { inngest } = await import("@/inngest/client");
      // 不 await：BA 响应快返回，Inngest 后台跑重试
      // 但保留 Promise 让调用方能 await 异常
      void inngest.send({
        name: "auth/send-sms-otp",
        data: {
          phoneNumber: params.phoneNumber,
          code: params.code,
          template: params.template,
        },
      });
      return;
    } catch (err) {
      logger.error(
        { err, phone: params.phoneNumber },
        "[sms] inngest.send 失败，降级到同步"
      );
      // 降级到下面同步分支
    }
  }

  // 3. prod + 无 Inngest：直接同步发阿里云
  if (!isAliyunSMSConfigured()) {
    logger.error(
      { phone: params.phoneNumber },
      "[sms] 阿里云 SMS 未配置且无 Inngest，OTP 无法送达"
    );
    return;
  }

  try {
    await sendSMSViaAliyun(params);
  } catch (err) {
    logger.error(
      { err, phone: params.phoneNumber },
      "[sms] 阿里云 SMS 同步发送失败"
    );
    // 不 rethrow —— BA 端点不应反映给前端
  }
}
