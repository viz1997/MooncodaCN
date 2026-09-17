/**
 * 微信小程序服务端 API 客户端
 *
 * 唯一对外能力：`code2Session(code)` —— 用 `wx.login()` 拿到的临时凭证
 * 换 openid / session_key / unionid。
 *
 * 实现：直接 `fetch` `https://api.weixin.qq.com/sns/jscode2session`，
 * 零 npm 依赖（镜像 src/features/sms/client.ts 风格）。
 *
 * ⚠️ session_key **绝不能下发到小程序前端**（拿到就能解密任何该
 * AppID 加密数据）—— 本模块只服务于服务端端点，调用方需保证不返给客户端。
 *
 * 参考：微信官方文档 https://developers.weixin.qq.com/miniprogram/dev/api-backend/open-api/login/auth.code2Session.html
 */

const CODE2SESSION_URL = "https://api.weixin.qq.com/sns/jscode2session";

/**
 * code2Session 成功返回结构
 */
export interface WeChatCode2SessionResult {
  /** 用户唯一标识（同 AppID 下唯一） */
  openid: string;
  /** 开放平台下多端打通字段（无则空字符串） */
  unionid?: string;
  /** 会话密钥（**服务端留存**，不下发到前端） */
  session_key: string;
}

/**
 * code2Session 失败时抛错
 */
export class WeChatApiError extends Error {
  constructor(
    public readonly errcode: number,
    public readonly errmsg: string,
    message: string
  ) {
    super(message);
    this.name = "WeChatApiError";
  }
}

/**
 * 调 `wx.login()` 临时凭证换 openid + session_key + unionid
 *
 * 失败抛出 WeChatApiError，调用方负责把它转成 400/500 响应。
 */
export async function code2Session(
  code: string
): Promise<WeChatCode2SessionResult> {
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error("WECHAT_APP_ID / WECHAT_APP_SECRET not configured");
  }

  const url = new URL(CODE2SESSION_URL);
  url.searchParams.set("appid", appId);
  url.searchParams.set("secret", appSecret);
  url.searchParams.set("js_code", code);
  url.searchParams.set("grant_type", "authorization_code");

  const resp = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) {
    throw new WeChatApiError(
      resp.status,
      `HTTP ${resp.status}`,
      `WeChat code2Session HTTP error: ${resp.status}`
    );
  }

  const data = (await resp.json()) as {
    openid?: string;
    session_key?: string;
    unionid?: string;
    errcode?: number;
    errmsg?: string;
  };

  // 微信接口返回 errcode=40029（code 无效/已用）/ 40013（appid 不匹配）
  // 等都需要抛出，由调用方决定 400 vs 500。
  if (data.errcode) {
    throw new WeChatApiError(
      data.errcode,
      data.errmsg ?? "(no errmsg)",
      `WeChat code2Session failed: ${data.errcode} ${data.errmsg ?? ""}`
    );
  }

  if (!data.openid || !data.session_key) {
    throw new WeChatApiError(
      -1,
      "Missing openid/session_key",
      "WeChat code2Session returned no openid/session_key"
    );
  }

  const result: WeChatCode2SessionResult = {
    openid: data.openid,
    session_key: data.session_key,
  };
  if (data.unionid) {
    result.unionid = data.unionid;
  }
  return result;
}
