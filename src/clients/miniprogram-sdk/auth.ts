/**
 * 小程序 SDK —— 微信登录
 *
 * 流程(与 architecture-miniprogram-as-client.md § 2.1.3 一致):
 *   1. Taro.login()          → code
 *   2. Taro.getPhoneNumber() → encryptedData + iv(用户主动授权)
 *   3. loginWithWechat()     → { token, user }
 *   4. setSdkToken(token)    → 后续所有 Bearer 调用自动加
 *
 * 重登录 / token 刷新策略由业务决定 —— SDK 不自动 refresh,
 * 401 时 onUnauthorized 回调触发后由业务层跳回登录页。
 */

import { sdkRequest, setSdkToken } from "./request";
import type { WeChatLoginRequest, WeChatLoginResponse } from "./types";

/**
 * 用微信 code + 手机号加密数据换 session token
 *
 * 入参:Taro.login() 的 code + Taro.getPhoneNumber() 的 encryptedData/iv
 * 返回:写到 SDK 全局后,直接调用其他子模块即可
 */
export async function loginWithWechat(
  payload: WeChatLoginRequest
): Promise<WeChatLoginResponse> {
  const result = await sdkRequest<WeChatLoginResponse>(
    "/api/auth/wechat-phone-login",
    { method: "POST", json: payload }
  );
  // 写入 SDK 全局,后续 Bearer 调用自动带
  setSdkToken(result.token);
  return result;
}

/**
 * 退出登录 —— 清掉 SDK token
 */
export function logout(): void {
  setSdkToken(undefined);
}
