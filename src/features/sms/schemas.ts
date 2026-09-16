/**
 * SMS / phone zod schemas（2026-09-16）
 *
 * 服务端校验 + 前端表单校验共用一套 schema。
 * z.input 给 server action 用（输入形态，allow preprocess 转换），z.output 给类型推导。
 *
 * 关联：
 *   - Better Auth phoneNumber 插件服务端用同一 E.164 正则（见 src/lib/auth/index.ts）
 *   - 前端 PhoneSignInForm / PhoneOtpInput 组件用 signInPhoneInputSchema 等做表单校验
 */

import { z } from "zod";

/** E.164：+ 后跟 8-15 位数字 */
const E164_REGEX = /^\+\d{8,15}$/;

/** 手机号校验（E.164）—— 必填 */
export const phoneNumberSchema = z
  .string()
  .min(1, "phoneNumber.required")
  .regex(E164_REGEX, "phoneNumber.invalidFormat");

/** 6 位 OTP */
export const otpCodeSchema = z
  .string()
  .length(6, "otp.invalidLength")
  .regex(/^\d{6}$/, "otp.invalidFormat");

/** 密码（手机号登录 / 重置时用） */
export const passwordSchema = z
  .string()
  .min(8, "password.tooShort")
  .max(128, "password.tooLong");

/** 发送 OTP —— phoneNumber */
export const sendOtpInputSchema = z.object({
  phoneNumber: phoneNumberSchema,
});
export type SendOtpInput = z.input<typeof sendOtpInputSchema>;

/** 手机号密码登录 —— phone + password */
export const signInPhoneInputSchema = z.object({
  phoneNumber: phoneNumberSchema,
  password: z.string().min(1, "password.required"),
});
export type SignInPhoneInput = z.input<typeof signInPhoneInputSchema>;

/** 验证 OTP —— phone + code */
export const verifyOtpInputSchema = z.object({
  phoneNumber: phoneNumberSchema,
  code: otpCodeSchema,
});
export type VerifyOtpInput = z.input<typeof verifyOtpInputSchema>;

/** 重置密码 —— phone + otp + newPassword */
export const resetPasswordPhoneInputSchema = z.object({
  phoneNumber: phoneNumberSchema,
  otp: otpCodeSchema,
  newPassword: passwordSchema,
});
export type ResetPasswordPhoneInput = z.input<
  typeof resetPasswordPhoneInputSchema
>;
