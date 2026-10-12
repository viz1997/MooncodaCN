/**
 * 微信小程序登录端点（2026-09-16）
 *
 * 小程序端流程：
 *   1. Taro.login() → 拿 code
 *   2. Taro.getPhoneNumber({...}) → 用户授权 → 拿 { encryptedData, iv }
 *   3. POST /api/auth/wechat-phone-login { code, encryptedData, iv }
 *
 * 本路由：
 *   1. code → code2Session → { openid, unionid, session_key }
 *   2. (session_key, encryptedData, iv) → AES 解密 → 明文 JSON
 *   3. 明文 JSON → parseDecryptedPhoneNumber → phoneNumber (E.164)
 *   4. putWechatOtp(phone, { openid, unionid })
 *   5. auth.api.verifyPhoneNumber({ phoneNumber, code: "WECHAT_VERIFIED" })
 *      → verifyOTP 钩子在 otp-store 命中 → 创建/找 user + session
 *      → callbackOnVerification 把 openid/unionid 写回 user
 *   6. 返 { token, user } 给小程序（小程序用 Authorization: Bearer）
 *
 * 关联：
 *   - 微信能力：src/features/wechat/{api,crypto,otp-store}.ts
 *   - BA plugin 钩子：src/lib/auth/index.ts 的 verifyOTP / callbackOnVerification
 *   - 错误响应：与 src/app/api/orders/[token]/* 等对齐 JSON { error, message }
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  code2Session,
  decryptWechatData,
  parseDecryptedPhoneNumber,
  putWechatOtp,
  WeChatApiError,
} from "@/features/wechat";
import { withApiLogging } from "@/lib/api-logger";
import { auth } from "@/lib/auth";

// ============================================
// Request schema
// ============================================

const requestSchema = z.object({
  /** Taro.login() 返回的临时凭证，5 分钟有效，单次使用 */
  code: z.string().min(1).max(1024),
  /** Taro.getPhoneNumber() 返回的加密数据，Base64 */
  encryptedData: z.string().min(1).max(8192),
  /** AES IV，Base64 */
  iv: z.string().min(1).max(512),
});

/**
 * Response 形状：
 *   - 200: { token, user }
 *   - 400: { error, message }                       INVALID_JSON / INVALID_INPUT
 *                                                 / WECHAT_CODE_INVALID
 *                                                 / PHONE_DECRYPT_FAILED
 *                                                 / PHONE_PARSE_FAILED
 *   - 500: { error, message }                       VERIFY_PHONE_FAILED
 *   - 502: { error, message }                       WECHAT_CONFIG_MISSING
 *                                                 / WECHAT_API_TIMEOUT
 *                                                 / WECHAT_API_UNREACHABLE
 *                                                 / WECHAT_API_FAILED
 *
 * user 字段挑 BA parseUserOutput 返回的子集给小程序端，
 * 不泄露额外字段（如 banned / needsVerification 等内部状态）。
 */
type WeChatLoginUser = {
  id: string;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
  email: string;
  name: string;
  role: string;
};

type WeChatLoginResponse = {
  token: string;
  user: WeChatLoginUser;
};

// ============================================
// code2Session 错误分类（2026-09-21）
// ============================================

/**
 * code2Session 抛非 WeChatApiError 时的兜底分类。
 *
 * 旧版统一返 "调用微信 code2Session 失败" 太模糊 —— 用户 / 客服排查
 * 502 时没法区分是「服务端没配 WECHAT_APP_ID/SECRET」还是「微信服务
 * 挂了 / 网络层 timeout / 上游 5xx」。
 *
 * 实际触发场景：
 *   - WECHAT_APP_ID / SECRET 未配 → src/features/wechat/api.ts:55 抛
 *     `Error("WECHAT_APP_ID / WECHAT_APP_SECRET not configured")`
 *   - 微信 api.weixin.qq.com 网络层失败（DNS / TLS / RST）→ fetch 抛
 *     `TypeError: fetch failed`（Node 18+ undici）
 *   - AbortSignal.timeout(5000) 触发 → DOMException { name: "TimeoutError" }
 *     或 AbortError
 */
type WeChatCode2SessionFallback = {
  code:
    | "WECHAT_CONFIG_MISSING" // 服务端配置缺失（env 没配）
    | "WECHAT_API_TIMEOUT" // 等微信超时（5s 撞 AbortSignal.timeout）
    | "WECHAT_API_UNREACHABLE" // 网络层失败（DNS / TLS / RST）
    | "WECHAT_API_FAILED"; // 其他未知 error
  message: string;
};

function classifyWechatCode2SessionError(
  err: unknown
): WeChatCode2SessionFallback {
  if (err instanceof Error) {
    // 配置缺失 —— 提示用户联系客服 + 后端运维
    if (
      err.message.includes("WECHAT_APP_ID") ||
      err.message.includes("WECHAT_APP_SECRET")
    ) {
      return {
        code: "WECHAT_CONFIG_MISSING",
        message: "服务端微信配置缺失，请稍后重试或联系客服",
      };
    }
    // AbortSignal.timeout —— DOMException name="TimeoutError" 或 AbortError
    if (
      err.name === "TimeoutError" ||
      err.name === "AbortError" ||
      err.message.includes("aborted") ||
      err.message.includes("timeout")
    ) {
      return {
        code: "WECHAT_API_TIMEOUT",
        message: "微信服务响应超时，请稍后重试",
      };
    }
    // undici / Node fetch 网络层失败（DNS / TLS / RST）
    if (
      err.message.includes("fetch failed") ||
      err.message.includes("ENOTFOUND") ||
      err.message.includes("ECONNREFUSED") ||
      err.message.includes("ECONNRESET")
    ) {
      return {
        code: "WECHAT_API_UNREACHABLE",
        message: "无法连接微信服务器，请稍后重试",
      };
    }
  }
  // 兜底 —— 仍返 502 但保留一个 unknown code 方便日志关联
  return {
    code: "WECHAT_API_FAILED",
    message: "调用微信 code2Session 失败",
  };
}

// ============================================
// Route handler
// ============================================

async function postHandler(request: Request): Promise<Response> {
  // 1. 解析 + 校验 body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON", message: "请求体不是合法 JSON" },
      { status: 400 }
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "缺少 code / encryptedData / iv",
      },
      { status: 400 }
    );
  }
  const { code, encryptedData, iv } = parsed.data;

  // 2. code → openid + session_key + unionid
  let session: Awaited<ReturnType<typeof code2Session>>;
  try {
    session = await code2Session(code);
  } catch (err) {
    if (err instanceof WeChatApiError) {
      // 40029 = code 无效 / 已用 / 过期
      // 40013 = appid 不匹配
      // 40163 = code 已被使用
      const userFacing =
        err.errcode === 40029 || err.errcode === 40163
          ? "微信登录凭证已过期，请重新登录"
          : err.errcode === 40013
            ? "小程序 AppID 配置错误"
            : "微信服务器暂时无法响应";
      return NextResponse.json(
        {
          error: "WECHAT_CODE_INVALID",
          message: userFacing,
          errcode: err.errcode,
        },
        { status: 400 }
      );
    }
    // 非 WeChatApiError 的兜底：区分配置缺失 / 网络层 error / timeout，
    // 给用户和客服更明确的提示（2026-09-21）
    const fallback = classifyWechatCode2SessionError(err);
    return NextResponse.json(
      {
        error: fallback.code,
        message: fallback.message,
      },
      { status: 502 }
    );
  }

  // 3. AES-128-CBC 解密手机号
  let decryptedJson: string;
  try {
    decryptedJson = decryptWechatData(session.session_key, encryptedData, iv);
  } catch {
    return NextResponse.json(
      {
        error: "PHONE_DECRYPT_FAILED",
        message: "解密手机号失败，请重新授权",
      },
      { status: 400 }
    );
  }

  let phoneInfo: ReturnType<typeof parseDecryptedPhoneNumber>;
  try {
    phoneInfo = parseDecryptedPhoneNumber(decryptedJson);
  } catch {
    return NextResponse.json(
      {
        error: "PHONE_PARSE_FAILED",
        message: "解析手机号失败",
      },
      { status: 400 }
    );
  }

  // 4. bridge 微信结果 → BA verifyOTP：put 到 otp-store
  // exactOptionalPropertyTypes 下 unionid 不能传 undefined —— 有则写
  const otpPayload: { openid: string; unionid?: string } = {
    openid: session.openid,
  };
  if (session.unionid) {
    otpPayload.unionid = session.unionid;
  }
  await putWechatOtp(phoneInfo.phoneNumber, otpPayload);

  // 5. 调 BA verifyPhoneNumber，让插件走完 createUser/createSession 流程
  //    verifyOTP 钩子命中 magic "WECHAT_VERIFIED" + otp-store 有 phone 记录 → 通过
  //    callbackOnVerification 钩子把 openid/unionid 写回 user
  let authResult: Awaited<ReturnType<typeof auth.api.verifyPhoneNumber>>;
  try {
    authResult = await auth.api.verifyPhoneNumber({
      body: {
        phoneNumber: phoneInfo.phoneNumber,
        code: "WECHAT_VERIFIED",
      },
    });
  } catch (err) {
    // BA 抛错会被 withApiLogging 捕获，本路由没必要再次 try/catch；但
    // 想要 JSON 友好的响应格式，捕获后转 500。
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "VERIFY_PHONE_FAILED",
        message: "创建会话失败",
        debug: msg,
      },
      { status: 500 }
    );
  }

  // BA verifyPhoneNumber 返回头形状：{ status: true, token, user }
  if (
    !authResult ||
    typeof authResult !== "object" ||
    !("token" in authResult)
  ) {
    return NextResponse.json(
      {
        error: "VERIFY_PHONE_FAILED",
        message: "未拿到会话 token",
      },
      { status: 500 }
    );
  }

  const token = (authResult as { token: string }).token;
  const baUser = (authResult as { user: unknown }).user as Record<
    string,
    unknown
  >;

  const response: WeChatLoginResponse = {
    token,
    user: {
      id: typeof baUser.id === "string" ? baUser.id : "",
      phoneNumber:
        typeof baUser.phoneNumber === "string" ? baUser.phoneNumber : null,
      phoneNumberVerified:
        typeof baUser.phoneNumberVerified === "boolean"
          ? baUser.phoneNumberVerified
          : false,
      email: typeof baUser.email === "string" ? baUser.email : "",
      name: typeof baUser.name === "string" ? baUser.name : "",
      role: typeof baUser.role === "string" ? baUser.role : "user",
    },
  };
  return NextResponse.json(response);
}

/**
 * Runtime 配置（2026-09-21 修复 502）：
 *
 * 历史：此路由没声明 runtime / maxDuration，Vercel 默认 10s（Hobby）。
 * 整链路有 4 段外部 IO，最坏组合：
 *   - Vercel 函数冷启动 1-3s
 *   - code2Session 等微信 5s（AbortSignal.timeout(5000)）
 *   - putWechatOtp 等 Upstash 3s（AbortSignal.timeout(3000)）
 *   - auth.api.verifyPhoneNumber 调 BA + Neon：3 次 DB 往返 + Neon
 *     cold start 3-8s，合计 6-15s
 *
 * 总耗时最坏 1+5+3+15 = 24s，必超 10s → Vercel 在还没拿到 route handler
 * 返回前就 502。
 *
 * 修复：显式声明 nodejs runtime + maxDuration=60（Pro 计划上限）。
 * Hobby 卡在 10s 的话单凭 maxDuration 救不回来，需要另外把 BA verify
 * 阶段拆成异步步骤（不在本 PR 范围）。
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = withApiLogging(postHandler);
