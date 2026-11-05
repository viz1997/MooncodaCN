/**
 * Sellbase customer 回填
 *
 * ## 为什么 email 才是真正的 join key
 *
 * Sellbase 的 customer 是**按 email upsert** 的 —— `POST /orders` 带一个
 * 从没见过的邮箱,那边就自动建一个 customer。而 `auth_user_id` 字段**没有
 * API 能写**,所以没法在 Sellbase 侧直接挂上本仓库的用户 id。
 *
 * `user.sellbase_customer_id` 因此只是一个**加速用的指针**:想查「这个人
 * 在 Sellbase 买过什么」时,不用每次都按 email 列一遍订单。
 *
 * ## 回填失败不影响主流程
 *
 * 下单成功比这一列重要得多。回填失败只记日志。
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { user } from "@/db/schema";

/**
 * 把 Sellbase 的 customer id 回填到用户档案
 */
export async function backfillSellbaseCustomerId(
  userId: string,
  customerId: string
): Promise<void> {
  try {
    await db
      .update(user)
      .set({ sellbaseCustomerId: customerId, updatedAt: new Date() })
      .where(eq(user.id, userId));
  } catch (error) {
    console.error("[sellbase] 回填 sellbase_customer_id 失败", error);
  }
}
