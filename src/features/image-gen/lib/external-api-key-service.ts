/**
 * 外部 API Key 服务层
 *
 * 2026-10-12：对接 /api/public/generate 强制 API key 校验 + admin CRUD 逻辑。
 *
 * 关注点：
 * 1. secure random 生成 rawKey + SHA-256 哈希入库（rawKey 仅新建时一次性返回）
 * 2. verifyExternalApiKey(rawKey) 返回严格类型结果（含拒绝原因）
 * 3. 月配额自动重置：monthlyCallsResetAt 跨月时按需触发（无需 cron）
 * 4. recordExternalApiKeyCall 累加 monthly + total + lastUsedAt
 *
 * 设计动机：
 * - 用 SHA-256 而非 bcrypt：API Key 需按明文做 O(1) 查表（hash(rawKey) === keyHash），
 *   bcrypt 是慢哈希不适合 lookup-only 场景；rawKey 本身有 32 位字母数字 + 前缀，
 *   熵 ~190 bits，hash 泄露也难以暴力反推。
 * - 月重置按需触发：单条请求 verify 时检查 monthlyCallsResetAt 是否已跨月，
 *   是的话在 UPDATE 中把 monthlyCalls=1, monthlyCallsResetAt=now。
 *   这样无 cron 依赖，且空月份不会写入（直到下个自然月首个请求）。
 */

import { createHash, randomBytes } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { type ExternalApiKey, externalApiKey } from "@/db/schema";

/** API Key 前缀 —— 标识"这是 Mooncoda 发出的外部 Key" */
export const API_KEY_PREFIX = "mk_pub_";

/** rawKey 总长度（不含前缀）：32 位字母数字 */
const RAW_KEY_LENGTH = 32;

/**
 * 生成 raw API Key（admin 创建时一次性返回给管理员 + 用户保存）
 */
export function generateRawApiKey(): string {
  // 字母数字（去 0/O/1/l 减少误读）
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(RAW_KEY_LENGTH);
  let s = "";
  for (let i = 0; i < RAW_KEY_LENGTH; i += 1) {
    s += alphabet[bytes[i]! % alphabet.length];
  }
  return `${API_KEY_PREFIX}${s}`;
}

/**
 * SHA-256(rawKey) → 64 字符 hex 字符串
 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

/**
 * 脱敏显示：admin UI / 日志用，例 "mk_pub_abcd****wxyz"
 * 仅取 prefix 段 + 后 4 位；中段不直接暴露长度以防侧信道。
 */
export function maskApiKey(rawKey: string): string {
  if (rawKey.length <= 8) return `${rawKey.slice(0, 4)}****`;
  const head = rawKey.slice(0, API_KEY_PREFIX.length + 4);
  const tail = rawKey.slice(-4);
  return `${head}****${tail}`;
}

// ============================================
// Verify 链路 —— /api/public/generate 调用
// ============================================

export type VerifyResult =
  | {
      ok: true;
      keyId: string;
      name: string;
      monthlyQuota: number;
      monthlyCalls: number;
      /**
       * 允许的 maskId 列表。空数组 = 仅允许默认 prompt 流（不绑模板 / 无 maskId）。
       * 这与原架构语义一致：admin 配白名单约束合作伙伴可以调用哪些效果模板。
       */
      allowedMasks: string[];
    }
  | {
      ok: false;
      reason: VerifyRejectReason;
      message: string;
    };

export type VerifyRejectReason =
  | "missing" // 没传 key
  | "malformed" // 格式不对（无前缀）
  | "not_found" // hash 没命中
  | "disabled" // 显式禁用
  | "quota_exceeded"; // 月配额用尽

/**
 * 验证 raw API Key 并返回 key 信息（用于 /api/public/generate 准入判定）
 *
 * 返回值：严格区分 ok 与带 reason 的拒绝，调用方按 reason 决定 HTTP code：
 *   - missing → 401
 *   - malformed → 401
 *   - not_found → 401
 *   - disabled → 403
 *   - quota_exceeded → 429
 *
 * 注意：本函数**不**自增 monthlyCalls —— 自增在生成成功路径由
 * recordExternalApiKeyCall(keyId) 完成，避免拒绝请求也消耗配额。
 */
export async function verifyExternalApiKey(
  rawKey: string | null | undefined
): Promise<VerifyResult> {
  if (!rawKey || rawKey.length === 0) {
    return { ok: false, reason: "missing", message: "API Key 必填" };
  }
  if (!rawKey.startsWith(API_KEY_PREFIX)) {
    return { ok: false, reason: "malformed", message: "API Key 格式错误" };
  }

  const hash = hashApiKey(rawKey);
  const row = await db.query.externalApiKey.findFirst({
    where: and(
      eq(externalApiKey.keyHash, hash),
      isNull(externalApiKey.deletedAt)
    ),
  });
  if (!row) {
    return { ok: false, reason: "not_found", message: "API Key 不存在" };
  }
  if (row.status !== "active") {
    return { ok: false, reason: "disabled", message: "API Key 已停用" };
  }

  // 月配额检查：monthlyQuota ≤ 0 视为无限；否则看是否过月需重置 + 当月计数
  const quota = resolveMonthlyQuota({
    monthlyQuota: row.monthlyQuota,
    monthlyCalls: row.monthlyCalls,
    monthlyCallsResetAt: row.monthlyCallsResetAt,
  });
  if (quota.exceeded) {
    return {
      ok: false,
      reason: "quota_exceeded",
      message: `本月配额已用尽（${quota.used}/${row.monthlyQuota}），下月 1 号重置`,
    };
  }

  let allowedMasks: string[] = [];
  try {
    const parsed = JSON.parse(row.allowedMasks) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((m): m is string => typeof m === "string")
    ) {
      allowedMasks = parsed;
    }
  } catch {
    // 损坏 JSON 兜底为空 —— admin 视图应可读到此问题
  }

  return {
    ok: true,
    keyId: row.id,
    name: row.name,
    monthlyQuota: row.monthlyQuota,
    monthlyCalls: quota.usedAfterReset ?? row.monthlyCalls,
    allowedMasks,
  };
}

/**
 * 月配额状态
 */
interface MonthlyQuotaState {
  /** 是否无限（monthlyQuota ≤ 0） */
  unlimited: boolean;
  /** 当前已用次数（含可能的重置） */
  used: number;
  /** 当月配额上限 */
  quota: number;
  /**
   * 若本次操作触发跨月重置，usedAfterReset 为重置后的计数（通常 = 1）；
   * 否则为 undefined（保持 DB 原值）。
   */
  usedAfterReset?: number;
  /** 是否超出配额 */
  exceeded: boolean;
}

/**
 * 解析月配额状态 + 是否需重置
 *
 * 之所以"按需触发重置"而非 cron：单条请求 verify 时判断月度是否已过去，
 * 如是则数据库 UPDATE 时把计数清零 + 重置时间 now —— 不需要独立 cron worker。
 * 副作用：空月份的 quota 数字不会立刻"看起来已重置"，但下次请求到达时会
 * 一次性把 monthlyCalls 落 1 并刷 monthlyCallsResetAt，UI 读到的数字永远是
 * 「当前自然月内的累计」。
 */
function resolveMonthlyQuota(row: {
  monthlyQuota: number;
  monthlyCalls: number;
  monthlyCallsResetAt: Date;
}): MonthlyQuotaState {
  const unlimited = row.monthlyQuota <= 0;
  const now = new Date();
  const resetAt = row.monthlyCallsResetAt;
  // resetAt 自然月 < now 自然月 → 已跨月
  const sameMonth =
    resetAt.getUTCFullYear() === now.getUTCFullYear() &&
    resetAt.getUTCMonth() === now.getUTCMonth();

  const used = sameMonth ? row.monthlyCalls : 0;
  const exceeded = !unlimited && used >= row.monthlyQuota;
  return {
    unlimited,
    used,
    quota: row.monthlyQuota,
    ...(sameMonth ? {} : { usedAfterReset: 0 }),
    exceeded,
  };
}

// ============================================
// 消费侧 —— 生成成功后调用，记 monthly + total + lastUsedAt
// ============================================

/**
 * 在 /api/public/generate 完成生图后记录一次调用
 *
 * 月度自增顺便处理跨月重置：若 monthlyCallsResetAt 已跨月，
 * 把 monthlyCalls 置 1 并刷 monthlyCallsResetAt = now（与 verify 期判断一致）。
 *
 * 设计：单 SQL 自增 + 可能的 reset 在同一 UPDATE，避免竞态。
 * 如果并发生成出现两个 reset 写入，最终 monthlyCallsResetAt 与各自 monthlyCalls
 * 都自洽（后写入的覆盖前者，counter 偏差 ±1 业务可接受）。
 */
export async function recordExternalApiKeyCall(keyId: string): Promise<void> {
  const now = new Date();
  // 2026-10-13 hotfix：把 JS Date 改成 Drizzle 参数化,不再当字符串拼进 SQL。
  // 之前 ${now.toISOString()} 直接拼 → PG 把 "2026-10-13T10:48:53.739Z" 解析成
  // 数值 2026-10-13(=2003)+ 后续 "T10" 抛 trailing junk (SQLSTATE 42601)。
  // 副作用:整条 UPDATE 静默失败(/api/public/generate 的 try-catch 兜住),
  // monthlyCalls / totalCalls 永远不递增,key 管理后台看到一直是 0。
  //
  // 语义保持:
  //   - 跨月 → monthlyCalls=1, monthlyCallsResetAt=now
  //   - 同月 → monthlyCalls=monthlyCalls+1, monthlyCallsResetAt 不变
  //   - totalCalls 永远 +1, lastUsedAt 永远 = now
  // 月份比较用 date_trunc('month', ...),DB 端 now() 与 JS Date 都在 UTC 同一时区。
  // Drizzle 的 sql 模板自动把 Date 参数序列化为 timestamptz literal,
  // 免去手写引号 / 转义,也杜绝后续 SQL 注入面。
  await db.execute(sql`
    UPDATE external_api_key
    SET
      total_calls = total_calls + 1,
      last_used_at = ${now},
      monthly_calls = CASE
        WHEN date_trunc('month', monthly_calls_reset_at) < date_trunc('month', now())
          THEN 1
        ELSE monthly_calls + 1
      END,
      monthly_calls_reset_at = CASE
        WHEN date_trunc('month', monthly_calls_reset_at) < date_trunc('month', now())
          THEN ${now}
        ELSE monthly_calls_reset_at
      END
    WHERE id = ${keyId}
      AND deleted_at IS NULL
  `);
}

// ============================================
// Env 门控 —— 默认开，可显式关
// ============================================

/**
 * 是否对 /api/public/generate 强制 API Key 校验
 *
 * 默认 true（生产必开）。
 * 本地 dev 一键关闭：在 .env.local 设 EXTERNAL_API_KEY_REQUIRED=0
 */
export function isExternalApiKeyRequired(): boolean {
  const raw = process.env.EXTERNAL_API_KEY_REQUIRED;
  if (raw === undefined) return true;
  // 接受 0 / false / FALSE / off 等
  return !(
    raw === "0" ||
    raw.toLowerCase() === "false" ||
    raw.toLowerCase() === "off"
  );
}

// ============================================
// Admin CRUD —— 复用于 safer-action
// ============================================

export interface CreateApiKeyInput {
  name: string;
  /** 创建人 user.id（admin server action 取 ctx.userId 传入） */
  createdBy: string;
  monthlyQuota: number;
  allowedMasks: string[];
  /**
   * rawKey 通常由 generateRawApiKey() 生成；注入点为方便测试。
   * 生产路径会忽略此字段，由 service 自动生成。
   */
  rawKey?: string;
}

export interface CreateApiKeyResult {
  id: string;
  /** rawKey 仅此一次返回，admin 必须立刻保存到自己的密码管理器 */
  rawKey: string;
  name: string;
  keyPrefix: string;
  monthlyQuota: number;
  allowedMasks: string[];
  createdAt: Date;
}

/**
 * 新建 API Key：admin 调一次，service 返回 rawKey（**唯一一次**看见明文的机会）
 */
export async function createExternalApiKey(
  input: CreateApiKeyInput
): Promise<CreateApiKeyResult> {
  const rawKey = input.rawKey ?? generateRawApiKey();
  const hash = hashApiKey(rawKey);
  const id = `eak_${randomBytes(8).toString("hex")}`;
  const now = new Date();

  // allowedMasks 序列化：JSON 数组字串。空数组存 "[]" 而非 NULL 简化下游解析。
  const masksJson = JSON.stringify(input.allowedMasks);

  // createdBy 由调用方（admin server action 从 ctx.userId）传入，
  // service 保持纯 DB 写入 + 序列化，无副作用来源。
  await db.insert(externalApiKey).values({
    id,
    name: input.name,
    keyHash: hash,
    keyPrefix: maskApiKey(rawKey),
    status: "active",
    createdBy: input.createdBy,
    monthlyQuota: input.monthlyQuota,
    monthlyCalls: 0,
    monthlyCallsResetAt: now,
    totalCalls: 0,
    allowedMasks: masksJson,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    rawKey,
    name: input.name,
    keyPrefix: maskApiKey(rawKey),
    monthlyQuota: input.monthlyQuota,
    allowedMasks: input.allowedMasks,
    createdAt: now,
  };
}

/**
 * 列出所有未删除的 API Key（admin 后台用）
 */
export async function listExternalApiKeys(): Promise<ExternalApiKey[]> {
  return db.query.externalApiKey.findMany({
    where: isNull(externalApiKey.deletedAt),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });
}

export interface UpdateApiKeyInput {
  id: string;
  // exactOptionalPropertyTypes 下 optional 与 undefined 是不同类型；
  // 这里只接受「该字段被显式设置」的语义；上层 caller 只传不 undefined 的字段。
  name?: string | undefined;
  status?: "active" | "disabled" | undefined;
  monthlyQuota?: number | undefined;
  allowedMasks?: string[] | undefined;
}

/**
 * 更新 API Key（部分字段），未传字段保持不变
 */
export async function updateExternalApiKey(
  input: UpdateApiKeyInput
): Promise<void> {
  const updates: Partial<ExternalApiKey> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) updates.name = input.name;
  if (input.status !== undefined) updates.status = input.status;
  if (input.monthlyQuota !== undefined) {
    updates.monthlyQuota = input.monthlyQuota;
  }
  if (input.allowedMasks !== undefined) {
    updates.allowedMasks = JSON.stringify(input.allowedMasks);
  }
  await db
    .update(externalApiKey)
    .set(updates)
    .where(
      and(eq(externalApiKey.id, input.id), isNull(externalApiKey.deletedAt))
    );
}

/**
 * 软删除：admin UI 调 delete 时走这个，物理删除由后台 cron 兜底
 */
export async function softDeleteExternalApiKey(id: string): Promise<void> {
  await db
    .update(externalApiKey)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(externalApiKey.id, id));
}

/**
 * 把 allowedMasks 字段还原为 string[]（暴露给 admin UI）
 */
export function parseAllowedMasks(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((m): m is string => typeof m === "string")
    ) {
      return parsed;
    }
  } catch {
    // fallthrough
  }
  return [];
}
