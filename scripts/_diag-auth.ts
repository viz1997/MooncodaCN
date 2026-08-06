/**
 * 临时脚本：诊断 Better Auth 登录失败原因
 * 检查 account 表里有没有 admin@mooncoda.local 的密码 hash
 */
import { config } from "dotenv";

config({ path: ".env.local" });

async function main() {
  const [{ db }, { user, account, session }, { eq }] = await Promise.all([
    import("@/db"),
    import("@/db/schema"),
    import("drizzle-orm"),
  ]);

  console.log("=== USER 表 ===");
  const users = await db.select().from(user);
  for (const u of users) {
    console.log({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      emailVerified: u.emailVerified,
      banned: u.banned,
    });
  }

  console.log("\n=== ACCOUNT 表（所有）===");
  const accounts = await db.select().from(account);
  console.log("行数:", accounts.length);
  for (const a of accounts) {
    // 不打印完整 password / token
    console.log({
      id: a.id,
      userId: a.userId,
      accountId: a.accountId,
      providerId: a.providerId,
      hasPassword: Boolean(a.password),
      hasAccessToken: Boolean(a.accessToken),
      hasRefreshToken: Boolean(a.refreshToken),
      passwordLen: a.password ? a.password.length : 0,
    });
  }

  console.log("\n=== SESSION 表 ===");
  const sessions = await db.select().from(session);
  console.log("行数:", sessions.length);
  for (const s of sessions.slice(0, 5)) {
    console.log({
      id: s.id.slice(0, 12) + "...",
      userId: s.userId,
      expiresAt: s.expiresAt,
    });
  }

  console.log("\n=== 用 signInEmail 测试登录 ===");
  const { auth } = await import("@/lib/auth");
  const result = await auth.api.signInEmail({
    body: {
      email: "admin@mooncoda.local",
      password: "mooncoda2026",
    },
  });
  console.log("signInEmail 结果:");
  console.log(JSON.stringify(result, null, 2).slice(0, 1500));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
