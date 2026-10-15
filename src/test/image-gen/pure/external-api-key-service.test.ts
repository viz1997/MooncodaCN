/**
 * 外部生图 API Key service 单元测试
 *
 * 2026-10-12：覆盖 service 层关键路径，纯单元 + vi.mock db，
 * 不依赖真实数据库 / R2 / 网络。
 *
 * 测试覆盖：
 * 1. generateRawApiKey：格式 (mk_pub_ 前缀) + 长度 + 字符合法
 * 2. hashApiKey：deterministic + 64 hex 字符
 * 3. maskApiKey：prefix + tail + 短 key 兜底
 * 4. isExternalApiKeyRequired：default true / "0" / "false" / "off" / "1"
 * 5. parseAllowedMasks：合法 JSON 数组 / 非法 JSON / 非数组 / 混合类型
 * 6. verifyExternalApiKey：missing / malformed / not_found / disabled /
 *    quota_exceeded / ok（happy path + allowedMasks 解析）
 * 7. verifyExternalApiKey：跨月重置识别（monthlyCallsResetAt 上月 → ok）
 * 8. recordExternalApiKeyCall：raw SQL 含 date_trunc 跨月分支
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  API_KEY_PREFIX,
  generateRawApiKey,
  hashApiKey,
  isExternalApiKeyRequired,
  maskApiKey,
  parseAllowedMasks,
  recordExternalApiKeyCall,
  verifyExternalApiKey,
} from "@/features/image-gen/lib/external-api-key-service";

// ============================================
// db mock —— 仅 verifyExternalApiKey / recordExternalApiKeyCall 走 DB
// ============================================

const dbState = {
  rows: new Map<string, Record<string, unknown>>(),
};

vi.mock("@/db", () => ({
  db: {
    query: {
      externalApiKey: {
        findFirst: vi.fn(async ({ where: _where }: { where: unknown }) => {
          // where 形如 and(eq(keyHash, h), isNull(deletedAt))
          // 不真解 drizzle 表达式，按 mock 表查找第一个 keyHash 匹配且 deletedAt null 的行
          for (const row of dbState.rows.values()) {
            if (row.deletedAt) continue;
            if (row.keyHash) return row;
          }
          return undefined;
        }),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn(async (vals: Record<string, unknown>) => {
        dbState.rows.set(vals.id as string, {
          ...vals,
          monthlyCalls: 0,
          totalCalls: 0,
          allowedMasks: "[]",
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        });
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => {
          // 找到并更新
        }),
      })),
    })),
    execute: vi.fn(async (sql: string) => {
      // 仅做存在性断言（具体 SQL 行为由 integration 测覆盖）
      return { sql };
    }),
  },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return actual;
  // 不替换 and/eq/isNull —— service 内部会把它们当函数调用，
  // 我们的 findFirst mock 只关心 row 的属性，不解 where 表达式。
  // 完整模拟真实模块也避免破坏 schema.ts 的 relations / many / one。
});

// ============================================
// env mock —— isExternalApiKeyRequired 读 process.env
// ============================================

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  // 每个 case 重置 env
  for (const k of Object.keys(process.env)) {
    if (k === "EXTERNAL_API_KEY_REQUIRED") delete process.env[k];
  }
});

afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (k === "EXTERNAL_API_KEY_REQUIRED") delete process.env[k];
  }
  process.env = { ...ORIGINAL_ENV };
  dbState.rows.clear();
});

// ============================================
// 1. generateRawApiKey
// ============================================

describe("generateRawApiKey", () => {
  it("以 mk_pub_ 开头", () => {
    const k = generateRawApiKey();
    expect(k.startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it("总长度 = prefix(7) + 32 = 39", () => {
    const k = generateRawApiKey();
    expect(k.length).toBe(API_KEY_PREFIX.length + 32);
  });

  it("字符集只包含字母数字（去 0/O/1/l）", () => {
    const k = generateRawApiKey();
    const body = k.slice(API_KEY_PREFIX.length);
    // 排除易混字符
    expect(body).not.toMatch(/[0O1lI]/);
    // 必须全字母数字
    expect(body).toMatch(/^[a-z2-9]+$/);
  });

  it("多次生成结果互不相同（高熵）", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      seen.add(generateRawApiKey());
    }
    expect(seen.size).toBe(50);
  });
});

// ============================================
// 2. hashApiKey
// ============================================

describe("hashApiKey", () => {
  it("返回 64 字符 hex 字符串", () => {
    const h = hashApiKey("mk_pub_abc");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("确定性：同输入 → 同 hash", () => {
    const a = hashApiKey("mk_pub_test_123");
    const b = hashApiKey("mk_pub_test_123");
    expect(a).toBe(b);
  });

  it("不同输入 → 不同 hash（雪崩）", () => {
    const a = hashApiKey("mk_pub_aaaa");
    const b = hashApiKey("mk_pub_aaab");
    expect(a).not.toBe(b);
  });
});

// ============================================
// 3. maskApiKey
// ============================================

describe("maskApiKey", () => {
  it("正常 key 形态：prefix + 4 + **** + 后 4", () => {
    const k = "mk_pub_abcdefghij1234567890abcdefghij";
    const m = maskApiKey(k);
    expect(m).toBe("mk_pub_abcd****ghij");
    expect(m).toContain("****");
  });

  it("短 key 兜底：前 4 + ****（不暴露后缀）", () => {
    expect(maskApiKey("ab")).toBe("ab****");
    expect(maskApiKey("")).toBe("****");
  });

  it("暴露前缀 + 4 + **** + 尾 4（admin 调试可见）", () => {
    // 当前实现：保留前 4 + 脱敏 + 尾 4，方便 admin 视觉识别
    // 这与「完全脱敏」是 trade-off：admin 列表一眼看出不同客户 key
    const m = maskApiKey("mk_pub_abcdefghij1234567890abcdefghij");
    expect(m).toBe("mk_pub_abcd****ghij");
  });
});

// ============================================
// 4. isExternalApiKeyRequired
// ============================================

describe("isExternalApiKeyRequired", () => {
  it("未设时默认 true", () => {
    delete process.env.EXTERNAL_API_KEY_REQUIRED;
    expect(isExternalApiKeyRequired()).toBe(true);
  });

  it("'0' / 'false' / 'off' → false（任意大小写）", () => {
    for (const v of ["0", "false", "FALSE", "False", "off", "OFF"]) {
      process.env.EXTERNAL_API_KEY_REQUIRED = v;
      expect(isExternalApiKeyRequired()).toBe(false);
    }
  });

  it("'1' / 'true' / 其他 → true", () => {
    for (const v of ["1", "true", "TRUE", "yes", "anything"]) {
      process.env.EXTERNAL_API_KEY_REQUIRED = v;
      expect(isExternalApiKeyRequired()).toBe(true);
    }
  });
});

// ============================================
// 5. parseAllowedMasks
// ============================================

describe("parseAllowedMasks", () => {
  it("合法 JSON 字符串数组", () => {
    expect(parseAllowedMasks('["MASK_001","MASK_002"]')).toEqual([
      "MASK_001",
      "MASK_002",
    ]);
  });

  it("空数组", () => {
    expect(parseAllowedMasks("[]")).toEqual([]);
  });

  it("非法 JSON → 兜底空数组", () => {
    expect(parseAllowedMasks("{not json")).toEqual([]);
  });

  it("JSON 但不是数组 → 兜底空数组", () => {
    expect(parseAllowedMasks('{"a":1}')).toEqual([]);
  });

  it("数组含非字符串 → 兜底空数组", () => {
    expect(parseAllowedMasks('["MASK_001", 123]')).toEqual([]);
  });

  it("空字符串 → 兜底空数组", () => {
    expect(parseAllowedMasks("")).toEqual([]);
  });
});

// ============================================
// 6. verifyExternalApiKey —— 6 条拒绝路径 + 1 条 ok
// ============================================

function seedRow(
  overrides: Partial<{
    id: string;
    name: string;
    keyHash: string;
    keyPrefix: string;
    status: "active" | "disabled";
    monthlyQuota: number;
    monthlyCalls: number;
    monthlyCallsResetAt: Date;
    totalCalls: number;
    lastUsedAt: Date | null;
    allowedMasks: string;
    deletedAt: Date | null;
  }>
): void {
  const id = overrides.id ?? "eak_test";
  dbState.rows.set(id, {
    id,
    name: overrides.name ?? "测试客户",
    keyHash: overrides.keyHash ?? hashApiKey("mk_pub_seed"),
    keyPrefix: overrides.keyPrefix ?? "mk_pub_se**ed",
    status: overrides.status ?? "active",
    monthlyQuota: overrides.monthlyQuota ?? 100,
    monthlyCalls: overrides.monthlyCalls ?? 0,
    monthlyCallsResetAt:
      overrides.monthlyCallsResetAt ?? new Date("2026-10-01T00:00:00Z"),
    totalCalls: overrides.totalCalls ?? 0,
    lastUsedAt: overrides.lastUsedAt ?? null,
    allowedMasks: overrides.allowedMasks ?? "[]",
    deletedAt: overrides.deletedAt ?? null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    createdBy: "user_admin",
  });
}

describe("verifyExternalApiKey", () => {
  it("null / undefined / '' → missing 拒绝", async () => {
    for (const v of [null, undefined, ""] as const) {
      const r = await verifyExternalApiKey(v as never);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("missing");
    }
  });

  it("无 mk_pub_ 前缀 → malformed", async () => {
    const r = await verifyExternalApiKey("raw_key_no_prefix");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("malformed");
  });

  it("hash 查不到 → not_found", async () => {
    const r = await verifyExternalApiKey("mk_pub_nothash");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not_found");
  });

  it("status=disabled → disabled 拒绝", async () => {
    const rawKey = "mk_pub_disabledkey1234";
    seedRow({
      id: "eak_d",
      keyHash: hashApiKey(rawKey),
      status: "disabled",
    });
    const r = await verifyExternalApiKey(rawKey);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("disabled");
  });

  it("已用满月配额 → quota_exceeded", async () => {
    const rawKey = "mk_pub_quota_full";
    seedRow({
      id: "eak_q",
      keyHash: hashApiKey(rawKey),
      monthlyQuota: 100,
      monthlyCalls: 100,
      monthlyCallsResetAt: new Date("2026-10-01T00:00:00Z"),
    });
    const r = await verifyExternalApiKey(rawKey);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("quota_exceeded");
  });

  it("happy path：active + 未用满 → ok 返 keyId / name / allowedMasks", async () => {
    const rawKey = "mk_pub_happy_path_aaaa";
    seedRow({
      id: "eak_h",
      keyHash: hashApiKey(rawKey),
      name: "客户A",
      status: "active",
      monthlyQuota: 1000,
      monthlyCalls: 42,
      allowedMasks: '["MASK_001","MASK_002"]',
    });
    const r = await verifyExternalApiKey(rawKey);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.keyId).toBe("eak_h");
      expect(r.name).toBe("客户A");
      expect(r.monthlyQuota).toBe(1000);
      expect(r.monthlyCalls).toBe(42);
      expect(r.allowedMasks).toEqual(["MASK_001", "MASK_002"]);
    }
  });

  it("跨月识别：monthlyCallsResetAt 是上月 → 视为 0（quota 未超）", async () => {
    const rawKey = "mk_pub_cross_month";
    // 上个月：monthlyCallsResetAt = 2026-09-15，当前假设测试在 2026-10 之后跑
    seedRow({
      id: "eak_c",
      keyHash: hashApiKey(rawKey),
      monthlyQuota: 100,
      monthlyCalls: 999, // 假数据；跨月时实际按 0 算
      monthlyCallsResetAt: new Date("2026-09-15T00:00:00Z"),
    });
    const r = await verifyExternalApiKey(rawKey);
    // 当前系统时间在 2026-10-12 之后 → 9 月已过去 → 视为 0
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.monthlyCalls).toBe(0);
  });

  it("allowedMasks JSON 损坏 → 兜底空数组（不阻塞 verify）", async () => {
    const rawKey = "mk_pub_bad_json";
    seedRow({
      id: "eak_j",
      keyHash: hashApiKey(rawKey),
      allowedMasks: "not a json",
    });
    const r = await verifyExternalApiKey(rawKey);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.allowedMasks).toEqual([]);
  });
});

// ============================================
// 7. recordExternalApiKeyCall
// ============================================

describe("recordExternalApiKeyCall", () => {
  it("执行 raw SQL；包含 date_trunc 跨月分支 + counter +1", async () => {
    const { db } = await import("@/db");
    await recordExternalApiKeyCall("eak_anything");
    const spy = db.execute as unknown as ReturnType<typeof vi.fn>;
    expect(spy).toHaveBeenCalledTimes(1);
    const sql = spy.mock.calls[0]?.[0] as string;
    // 跨月分支：date_trunc('month', monthly_calls_reset_at) < date_trunc('month', now())
    expect(sql).toMatch(/date_trunc\('month', monthly_calls_reset_at\)/);
    expect(sql).toMatch(/date_trunc\('month', now\(\)\)/);
    // total_calls + last_used_at + monthly_calls CASE
    expect(sql).toMatch(/total_calls = total_calls \+ 1/);
    expect(sql).toMatch(/last_used_at = /);
    expect(sql).toMatch(/monthly_calls = CASE/);
    // 软删守卫
    expect(sql).toMatch(/deleted_at IS NULL/);
  });
});
