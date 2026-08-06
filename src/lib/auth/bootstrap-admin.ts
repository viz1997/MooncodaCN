/**
 * 启动时确保默认管理员账号存在
 *
 * 流程：
 * 1. 读取环境变量 DEFAULT_ADMIN_USERNAME / DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD
 * 2. 任一未配置则跳过（视为不启用自动 bootstrap）
 * 3. 查找现有用户：
 *    - 存在 → 仅更新 role=admin + emailVerified=true + name（密码不变）
 *    - 不存在 → 通过 Better Auth signUpEmail 创建（自动 hash 密码），再设 role=admin
 * 4. 用 Promise 缓存单次进程内多次调用的结果，避免重复查询
 */

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";

interface AdminConfig {
  username: string;
  email: string;
  password: string;
  name: string;
}

let cachedPromise: Promise<void> | null = null;

function loadConfig(): AdminConfig | null {
  const username = process.env.DEFAULT_ADMIN_USERNAME?.trim() || "mooncoda";
  const email = process.env.DEFAULT_ADMIN_EMAIL?.trim() || "";
  const password = process.env.DEFAULT_ADMIN_PASSWORD?.trim() || "";
  const name = process.env.DEFAULT_ADMIN_NAME?.trim() || username;

  if (!email || !password) return null;
  if (password.length < 8) {
    // 不抛错，只是跳过 — 错误配置不应阻塞应用启动
    console.warn(
      "[bootstrap-admin] DEFAULT_ADMIN_PASSWORD 至少 8 位，跳过自动创建"
    );
    return null;
  }
  return { username, email, password, name };
}

/**
 * 幂等创建/升级默认管理员
 * 单次进程内多次调用只执行一次
 */
export function ensureDefaultAdmin(): Promise<void> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = run().catch((err) => {
    // 失败后清空缓存，下次可重试
    cachedPromise = null;
    console.error("[bootstrap-admin] 失败：", err);
  });
  return cachedPromise;
}

async function run(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg) return;

  // 1. 已存在 → 仅更新 role/name（保留密码）
  const existing = await db
    .select()
    .from(user)
    .where(eq(user.email, cfg.email))
    .limit(1);

  if (existing.length > 0) {
    const found = existing[0]!;
    if (found.role === "admin") return; // 已是 admin，跳过
    await db
      .update(user)
      .set({ role: "admin", name: cfg.name, emailVerified: true })
      .where(eq(user.id, found.id));
    console.log(`[bootstrap-admin] ✓ ${cfg.email} 已升级为 admin`);
    return;
  }

  // 2. 不存在 → 通过 Better Auth 创建（自动 hash 密码）
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: cfg.email,
        password: cfg.password,
        name: cfg.name,
      },
    });

    if (!("user" in result) || !result.user) {
      console.error("[bootstrap-admin] 创建失败：", result);
      return;
    }

    await db
      .update(user)
      .set({ role: "admin", emailVerified: true })
      .where(eq(user.id, result.user.id));

    console.log(`[bootstrap-admin] ✓ 已创建默认管理员 ${cfg.email}`);
  } catch (err) {
    console.error("[bootstrap-admin] signUp 失败：", err);
  }
}
