"use server";

/**
 * 删除账号 Action
 *
 * 用户可在设置页永久删除自己的账号及相关数据。
 */

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { user } from "@/db/schema";
import { protectedAction } from "@/lib/safe-action";

/**
 * 删除当前登录用户的账号
 * 需传入 { confirm: true }，避免意外调用
 */
export const deleteAccountAction = protectedAction
  .metadata({ action: "settings.deleteAccount" })
  .schema(z.object({ confirm: z.literal(true) }))
  .action(async ({ ctx }) => {
    const result = await db
      .delete(user)
      .where(eq(user.id, ctx.userId))
      .returning({ id: user.id });

    if (result.length === 0) {
      throw new Error("账号不存在或已删除");
    }

    return { message: "账号已成功删除" };
  });
