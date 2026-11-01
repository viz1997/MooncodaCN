import { describe, expect, it, vi } from "vitest";

/**
 * 打印订单模型文件的「归属校验」测试。
 *
 * 纯计算:不需要 DB、不需要网络、不需要浏览器。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个值得测
 *
 * `isOwnModelUrl()` 是下单接口上唯一的授权边界 —— 它决定「这个模型文件
 * 是不是这个下单人自己的」。写错了就是跨用户越权:甲的模型被乙拿去下单。
 * 而且它是纯字符串判断,写一个反例比在 dev 环境手动试便宜得多。
 */

// R2 的公共域名在模块加载时就被读进常量了 —— 必须在 import 之前定下来,
// 否则算出来的 URL 里会带着 undefined
vi.hoisted(() => {
  process.env.R2_PUBLIC_BASE_URL = "https://cdn.example.com";
  process.env.R2_ACCOUNT_ID = "acct";
  process.env.R2_BUCKET = "mooncoda-public";
});

const { getPublicUrl } = await import("@/features/image-gen/lib/r2");
const {
  buildPrintOrderObjectKey,
  isOwnModelUrl,
  printOrderPrefix,
  printOrderScope,
} = await import("@/features/print-quote/lib/upload-key");

const ALICE = "user_alice_001";
const BOB = "user_bob_002";

describe("printOrderScope", () => {
  it("同一个 userId 永远算出同一个作用域", () => {
    expect(printOrderScope(ALICE)).toBe(printOrderScope(ALICE));
  });

  it("不同 userId 的作用域不同", () => {
    expect(printOrderScope(ALICE)).not.toBe(printOrderScope(BOB));
  });

  it("是 16 位十六进制 —— 不泄露 userId 本身", () => {
    expect(printOrderScope(ALICE)).toMatch(/^[0-9a-f]{16}$/);
    expect(printOrderScope(ALICE)).not.toContain(ALICE);
  });
});

describe("printOrderPrefix", () => {
  it("形如 print-orders/<scope>/", () => {
    expect(printOrderPrefix(ALICE)).toBe(
      `print-orders/${printOrderScope(ALICE)}/`
    );
  });
});

describe("buildPrintOrderObjectKey", () => {
  const key = buildPrintOrderObjectKey(
    ALICE,
    "zip",
    new Date("2026-11-01T08:00:00.000Z")
  );

  it("落在这个用户的分区里", () => {
    expect(key.startsWith(printOrderPrefix(ALICE))).toBe(true);
  });

  it("形状是 <日期>/<时间戳>-<随机>.<ext>", () => {
    expect(key).toMatch(
      /^print-orders\/[0-9a-f]{16}\/\d{4}-\d{2}-\d{2}\/\d+-[A-Za-z0-9_-]+\.zip$/
    );
  });

  it("同一个用户两次生成的对象键不一样", () => {
    const again = buildPrintOrderObjectKey(ALICE, "zip");
    expect(again).not.toBe(key);
  });
});

describe("isOwnModelUrl", () => {
  const aliceKey = buildPrintOrderObjectKey(ALICE, "zip");
  const aliceUrl = getPublicUrl(aliceKey);
  const bobKey = buildPrintOrderObjectKey(BOB, "zip");
  const bobUrl = getPublicUrl(bobKey);

  it("自己的文件 + 自己拼出来的 URL → 通过", () => {
    expect(isOwnModelUrl(aliceUrl, aliceKey, ALICE)).toBe(true);
  });

  it("别人的文件 → 拒(跨用户越权)", () => {
    expect(isOwnModelUrl(bobUrl, bobKey, ALICE)).toBe(false);
  });

  it("别人的 key 配自己的 URL → 拒", () => {
    expect(isOwnModelUrl(aliceUrl, bobKey, ALICE)).toBe(false);
  });

  it("伪造的 URL(自己的 key,别人的域名)→ 拒", () => {
    expect(
      isOwnModelUrl(
        "https://attacker.example.com/print-orders/x.zip",
        aliceKey,
        ALICE
      )
    ).toBe(false);
  });

  it("URL 少一段 / 多一段 → 拒", () => {
    expect(isOwnModelUrl(`${aliceUrl}/extra`, aliceKey, ALICE)).toBe(false);
    expect(
      isOwnModelUrl(aliceUrl.replace(/\/[^/]+$/, ""), aliceKey, ALICE)
    ).toBe(false);
  });

  it("路径穿越(../)→ 拒", () => {
    const traversal = `${printOrderPrefix(ALICE)}../etc/passwd`;
    expect(isOwnModelUrl(getPublicUrl(traversal), traversal, ALICE)).toBe(
      false
    );
  });

  it("多级路径穿越 → 拒", () => {
    const traversal = `${printOrderPrefix(ALICE)}2026-11-01/../../evil.zip`;
    expect(isOwnModelUrl(getPublicUrl(traversal), traversal, ALICE)).toBe(
      false
    );
  });

  it("反斜杠 → 拒", () => {
    const backslash = `${printOrderPrefix(ALICE)}2026-11-01\\evil.zip`;
    expect(isOwnModelUrl(getPublicUrl(backslash), backslash, ALICE)).toBe(
      false
    );
  });

  it("空段(双斜杠)→ 拒", () => {
    const empty = `${printOrderPrefix(ALICE)}2026-11-01//evil.zip`;
    expect(isOwnModelUrl(getPublicUrl(empty), empty, ALICE)).toBe(false);
  });

  it("完全不在 print-orders/ 下的键 → 拒", () => {
    const outside = "somewhere/else/model.zip";
    expect(isOwnModelUrl(getPublicUrl(outside), outside, ALICE)).toBe(false);
  });

  it("绝对 URL 当成对象键 → 拒", () => {
    expect(
      isOwnModelUrl(aliceUrl, "https://cdn.example.com/a.zip", ALICE)
    ).toBe(false);
  });
});
