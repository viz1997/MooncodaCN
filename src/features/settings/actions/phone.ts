"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db, user } from "@/db";
import { phoneNumberSchema } from "@/features/sms";
import { protectedAction } from "@/lib/safe-action";

/**
 * Settings > 手机号绑定 / 解绑 Server Actions（2026-09-16）
 *
 * 边界（防呆）：
 *   - 解绑前必须已有真实邮箱且 emailVerified=true（不允许把手机号当唯一登录方式）
 *     → 否则解绑后用户只能找客服找回账号
 *   - 改绑：先 verify 新手机号（OTP 路径），再 UPDATE 覆盖
 *   - 绑定：先 verify（OTP 路径），再 UPDATE 写入 phoneNumber + phoneNumberVerified
 *
 * 这里不直接做 verify —— 验证走 BA plugin 的 verifyPhoneOtp 端点（前端调用），
 * 服务端只在 verify 成功后的「commit」环节写 DB。这样 BA 自带的 60s/3 次
 * rate limit 自然生效，不用重复造轮子。
 *
 * 关联：drizzle/0041_phone_auth.sql 已加 user.phone_number / user.phone_number_verified 列
 */

const bindPhoneSchema = z.object({
  phoneNumber: phoneNumberSchema,
});

/**
 * 绑定手机号（前提：user.phoneNumber 当前为 null）
 *
 * 前置：前端已经走完 sendPhoneOtp + verifyPhoneOtp 流程，确认新手机号是当前用户的。
 * 这里只负责把 phoneNumber + phoneNumberVerified=true 写到 DB。
 *
 * 失败模式：
 *   - 该手机号已被另一个 user 占用 → BA unique 约束冲突（422）
 *   - 当前 user 已绑过手机号 → 应改走 changePhoneAction
 */
export const bindPhoneAction = protectedAction
  .metadata({ action: "settings.phone.bind" })
  .schema(bindPhoneSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    // 先查一下当前状态
    const current = await db.query.user.findFirst({
      where: eq(user.id, ctx.userId),
      columns: { phoneNumber: true, phoneNumberVerified: true },
    });
    if (current?.phoneNumber) {
      throw new Error("Phone is already bound. Use change instead.");
    }

    await db
      .update(user)
      .set({
        phoneNumber: data.phoneNumber,
        phoneNumberVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(user.id, ctx.userId));

    revalidatePath("/dashboard/settings");
    return { message: "Phone bound successfully" };
  });

const changePhoneSchema = z.object({
  newPhoneNumber: phoneNumberSchema,
});

/**
 * 改绑手机号（当前已绑，需要换成新的）
 *
 * 前置：前端已对新手机号走完 sendPhoneOtp + verifyPhoneOtp 流程。
 */
export const changePhoneAction = protectedAction
  .metadata({ action: "settings.phone.change" })
  .schema(changePhoneSchema)
  .action(async ({ parsedInput: data, ctx }) => {
    await db
      .update(user)
      .set({
        phoneNumber: data.newPhoneNumber,
        phoneNumberVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(user.id, ctx.userId));

    revalidatePath("/dashboard/settings");
    return { message: "Phone changed successfully" };
  });

/**
 * 解绑手机号
 *
 * 强校验：必须已有真实邮箱且已验证，否则拒绝。
 *   - user.email 不以 "@noreply." 结尾（占位邮箱不算真实邮箱）
 *   - user.emailVerified = true
 *
 * 这样可以保证用户解绑手机号后还能用邮箱登录。
 */
export const unbindPhoneAction = protectedAction
  .metadata({ action: "settings.phone.unbind" })
  .schema(z.object({}))
  .action(async ({ ctx }) => {
    const current = await db.query.user.findFirst({
      where: eq(user.id, ctx.userId),
      columns: { email: true, emailVerified: true, phoneNumber: true },
    });
    if (!current) throw new Error("User not found");
    if (!current.phoneNumber) {
      throw new Error("Phone is not bound");
    }
    if (current.email.includes("@noreply.") || !current.emailVerified) {
      throw new Error(
        "Cannot unbind phone without a verified email. Please bind and verify your email first."
      );
    }

    await db
      .update(user)
      .set({
        phoneNumber: null,
        phoneNumberVerified: false,
        updatedAt: new Date(),
      })
      .where(eq(user.id, ctx.userId));

    revalidatePath("/dashboard/settings");
    return { message: "Phone unbound successfully" };
  });
