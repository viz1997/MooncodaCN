/**
 * 微信小程序功能模块入口
 *
 * 公共能力：
 *   - code2Session：把 wx.login() code 换 openid + session_key + unionid
 *   - decryptWechatData / parseDecryptedPhoneNumber：解密手机号
 *   - putWechatOtp / hasWechatOtp / consumeWechatOtp：bridge 微信流程到 BA verifyOTP
 *
 * 关联：see `src/lib/auth/index.ts` phoneNumber plugin 的 verifyOTP +
 *   callbackOnVerification 钩子；see `src/app/api/auth/wechat-phone-login/route.ts`。
 */

export {
  code2Session,
  WeChatApiError,
  type WeChatCode2SessionResult,
} from "./api";

export {
  decryptWechatData,
  parseDecryptedPhoneNumber,
} from "./crypto";

export {
  consumeWechatOtp,
  hasWechatOtp,
  putWechatOtp,
  type WeChatOtpPayload,
} from "./otp-store";
