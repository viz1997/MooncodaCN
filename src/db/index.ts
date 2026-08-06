import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleNeonWs } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * 数据库连接配置
 *
 * 支持两种模式:
 * 1. Neon Serverless WebSocket (生产/测试环境) - 支持事务，兼容 Node.js 和 Edge Runtime
 * 2. 标准 PostgreSQL (本地开发/Docker) - 使用连接池
 *
 * 注意: Neon 始终使用 WebSocket 模式以支持事务
 * - Node.js 环境: 需要 ws 包提供 WebSocket
 * - Edge Runtime (CF Workers/Vercel Edge): 使用原生 WebSocket API
 */

// 确保环境变量存在
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL 环境变量未设置，请在 .env 文件中配置数据库连接"
  );
}

const databaseUrl = process.env.DATABASE_URL;

/**
 * 检测是否使用 Neon Serverless
 */
const isNeon = databaseUrl.includes("neon.tech");

/**
 * 检测是否使用 Supabase（pooler 直连必须 SSL）
 */
const isSupabase =
  databaseUrl.includes("supabase.com") || databaseUrl.includes("supabase.co");

/**
 * 检测是否在 Node.js 环境
 * Edge Runtime (CF Workers, Vercel Edge) 没有 process.versions.node
 */
const isNodeJs = typeof process !== "undefined" && process.versions?.node;

/**
 * 远程 PG（Supabase / Neon）需要 SSL，但 Supabase pooler 用自签名证书。
 *
 * 注意：URL 里**不**加 sslmode——pg 库看到 URL 里的 sslmode=verify-full
 * 会强制开启证书校验并覆盖 Pool.ssl.rejectUnauthorized=false。
 * 改用纯 Pool 配置：ssl.on = true + rejectUnauthorized = false，
 * Supabase pooler 就能握手成功（self-signed 接受）。
 */
function stripUrlSsl(url: string): string {
  // 移除用户写在 DATABASE_URL 里的 sslmode / ssl 参数，避免覆盖 Pool 配置
  return url
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/[?&]ssl=[^&]*/g, "")
    .replace(/[?&]uselibpqcompat=[^&]*/g, "");
}

/**
 * 创建数据库实例
 * - Neon: 使用 WebSocket 连接 (支持事务，兼容 Node.js 和 Edge)
 * - 标准 PG (本地/Supabase/RDS): 使用连接池
 */
function createDatabaseConnection() {
  if (isNeon) {
    // Node.js 环境需要手动设置 WebSocket 构造函数
    // Edge Runtime (CF Workers, Vercel Edge) 有原生 WebSocket，无需设置
    if (isNodeJs) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ws = require("ws");
      neonConfig.webSocketConstructor = ws;
    }

    // 使用 WebSocket 连接池，支持事务
    const pool = new NeonPool({ connectionString: databaseUrl });
    return drizzleNeonWs(pool, { schema });
  }

  // 标准 PostgreSQL 连接池（本地 / Supabase / RDS 等）
  const finalUrl = stripUrlSsl(databaseUrl);
  const needsSsl = isSupabase || isNeon;
  const pool = new Pool({
    connectionString: finalUrl,
    // Supabase pooler 用自签名证书，必须 rejectUnauthorized: false 才能连上
    ...(needsSsl && { ssl: { rejectUnauthorized: false } }),
  });
  return drizzlePg(pool, { schema });
}

// 导出数据库实例
export const db = createDatabaseConnection();

// 导出 Schema 以便在其他地方使用
export * from "./schema";
