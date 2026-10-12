/**
 * features/sms 公开导出（2026-09-16）
 */

export {
  AliyunSMSError,
  type AliyunSmsTemplate,
  isAliyunSMSConfigured,
  sendSMSViaAliyun,
} from "./client";
export {
  DEFAULT_COUNTRY_CODE,
  maskPhone,
  PHONE_COUNTRIES,
  type PhoneCountry,
  toE164,
} from "./phone-countries";
export {
  otpCodeSchema,
  passwordSchema,
  phoneNumberSchema,
  type ResetPasswordPhoneInput,
  resetPasswordPhoneInputSchema,
  type SendOtpInput,
  type SignInPhoneInput,
  sendOtpInputSchema,
  signInPhoneInputSchema,
  type VerifyOtpInput,
  verifyOtpInputSchema,
} from "./schemas";
export { type SendOTPParams, sendOTP } from "./utils";
