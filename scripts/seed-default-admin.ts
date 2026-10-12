#!/usr/bin/env -S npx tsx

/**
 * 初始化默认管理员账号
 *
 * 从环境变量读取（先 load .env.local，再动态 import @/db）：
 *   DEFAULT_ADMIN_USERNAME  - 管理员用户名（用作 name）
 *   DEFAULT_ADMIN_EMAIL     - 管理员邮箱（必填）
 *   DEFAULT_ADMIN_PASSWORD  - 管理员密码（必填，至少 8 位）
 *   DEFAULT_ADMIN_NAME      - 显示名（可选，默认同 username）
 *
 * 幂等：重复执行只会更新 role/name，不会重复创建或修改密码。
 *
 * 使用：
 *   pnpm admin:seed
 *
 * 或指定 env：
 *   DEFAULT_ADMIN_EMAIL=foo@bar.com DEFAULT_ADMIN_PASSWORD=xxxx pnpm tsx scripts/seed-default-admin.ts
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

// 关键：必须在动态 import @/db 之前同步加载 .env.local
// ES Module 的 import 会被 hoist，但这里的动态 import 是异步的，所以dotenv 先执行
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
// 也尝试加载 .env（兜底）
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));

interface AdminConfig {
  username: string;
  email: string;
  password: string;
  name: string;
}

function loadConfig(): AdminConfig | null {
  const username = process.env.DEFAULT_ADMIN_USERNAME?.trim() || "mooncoda";
  const email = process.env.DEFAULT_ADMIN_EMAIL?.trim() || "";
  const password = process.env.DEFAULT_ADMIN_PASSWORD?.trim() || "";
  const name = process.env.DEFAULT_ADMIN_NAME?.trim() || username;

  if (!email || !password) return null;
  if (password.length < 8) {
    console.error(
      "[seed-default-admin] DEFAULT_ADMIN_PASSWORD 至少 8 位（Better Auth 最低要求）"
    );
    process.exit(1);
  }
  return { username, email, password, name };
}

async function main() {
  const cfg = loadConfig();
  if (!cfg) {
    console.error(
      "[seed-default-admin] 缺少必要环境变量：DEFAULT_ADMIN_EMAIL + DEFAULT_ADMIN_PASSWORD"
    );
    console.error(
      "示例：DEFAULT_ADMIN_EMAIL=mooncoda@local DEFAULT_ADMIN_PASSWORD=mooncoda2026 pnpm admin:seed"
    );
    process.exit(1);
  }

  console.log(
    `[seed-default-admin] 目标：${cfg.email}（显示名=${cfg.name}，用户名=${cfg.username}）`
  );
  console.log(
    `[seed-default-admin] DATABASE_URL=${process.env.DATABASE_URL ? "已配置" : "❌ 未配置"}`
  );

  // 动态 import @/db：dotenv 此时已加载好 env
  const [{ db }, { user }, { eq }, { auth }] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("drizzle-orm"),
    import("@/lib/auth"),
  ]);

  // 1. 检查用户是否存在
  const existing = await db
    .select()
    .from(user)
    .where(eq(user.email, cfg.email))
    .limit(1);

  if (existing.length > 0) {
    const found = existing[0]!;
    if (found.role === "admin") {
      console.log(`[seed-default-admin] ✓ ${cfg.email} 已是管理员，跳过`);
      return;
    }
    console.log(
      `[seed-default-admin] 用户已存在 (id=${found.id})，更新 role/name，保留密码不变`
    );
    await db
      .update(user)
      .set({
        role: "admin",
        name: cfg.name,
        emailVerified: true,
      })
      .where(eq(user.id, found.id));
    console.log("[seed-default-admin] ✓ 已更新为管理员");
    return;
  }

  // 2. 通过 Better Auth signUpEmail 创建（自动 hash 密码）
  try {
    const result = await auth.api.signUpEmail({
      body: {
        email: cfg.email,
        password: cfg.password,
        name: cfg.name,
      },
    });

    if (!("user" in result) || !result.user) {
      console.error("[seed-default-admin] 创建失败：", result);
      process.exit(1);
    }

    // 3. 强制设置 role=admin + emailVerified=true
    await db
      .update(user)
      .set({ role: "admin", emailVerified: true })
      .where(eq(user.id, result.user.id));

    console.log(
      `[seed-default-admin] ✓ 已创建管理员 ${cfg.email}（id=${result.user.id}）`
    );
    console.log(`           密码 = ${cfg.password}`);
    console.log("           登录后访问 /admin 进入管理后台");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[seed-default-admin] 创建失败：", msg);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-default-admin] 未处理错误：", err);
    process.exit(1);
  });
