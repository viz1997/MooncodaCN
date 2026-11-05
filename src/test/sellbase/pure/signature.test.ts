import { describe, expect, it } from "vitest";

/**
 * Sellbase webhook 验签测试。
 *
 * 纯计算:`node:crypto` 的 HMAC,不碰 DB、不碰网络、不碰 env。跑在 unit
 * project 里(`pnpm test:run --project=unit`)。
 *
 * ## 为什么这个必须测
 *
 * 验签是 webhook 端点**唯一的**授权边界 —— 它没挡住,就等于任何人都能
 * POST 一个「这张单已付款」过来,工作室白发货。
 *
 * 攻击面就三条:
 *
 * 1. **伪造签名** —— 拿别的 body 配旧的签名
 * 2. **重放** —— 抓一个真签名,原样重投(时间戳就是防这个的)
 * 3. **畸形头** —— `Sellbase-Signature` 头被截断 / 塞垃圾 / 长度不对
 *
 * 第 3 条特别容易打成 500:`crypto.timingSafeEqual` 在两边长度不等时是
 * **抛异常**的,不是返回 false。一个畸形的请求头把 webhook 端点打成 500,
 * Sellbase 会一直重投,这个端点就成了噪音源。
 *
 * ## 签名格式
 *
 * ```
 * Sellbase-Signature: t=<unix 秒>,v1=<hex HMAC-SHA256("<t>.<raw body>")>
 * ```
 */

import {
  buildSellbaseSignatureHeader,
  computeSellbaseSignature,
  parseSellbaseSignatureHeader,
  SELLBASE_WEBHOOK_TOLERANCE_SECONDS,
  verifySellbaseSignature,
} from "@/features/sellbase/lib/signature";

const SECRET = "whsec_test_0123456789";
const PAYLOAD = JSON.stringify({
  id: "evt_1",
  type: "order.paid",
  data: { entity: "order", entity_id: "ord_1" },
});
const NOW = 1_762_000_000;

describe("computeSellbaseSignature", () => {
  it("是 HMAC-SHA256 的 hex(64 个字符)", () => {
    const sig = computeSellbaseSignature(SECRET, NOW, PAYLOAD);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("同样的输入算出同样的签名 —— 验签的前提", () => {
    expect(computeSellbaseSignature(SECRET, NOW, PAYLOAD)).toBe(
      computeSellbaseSignature(SECRET, NOW, PAYLOAD)
    );
  });

  it("换个密钥就换签名", () => {
    expect(computeSellbaseSignature("other-secret", NOW, PAYLOAD)).not.toBe(
      computeSellbaseSignature(SECRET, NOW, PAYLOAD)
    );
  });

  it("时间戳进签名 —— 改一个字节签名就变", () => {
    expect(computeSellbaseSignature(SECRET, NOW + 1, PAYLOAD)).not.toBe(
      computeSellbaseSignature(SECRET, NOW, PAYLOAD)
    );
  });
});

describe("buildSellbaseSignatureHeader", () => {
  it("拼成 `t=...,v1=...`", () => {
    const header = buildSellbaseSignatureHeader(SECRET, PAYLOAD, NOW);
    expect(header).toBe(
      `t=${NOW},v1=${computeSellbaseSignature(SECRET, NOW, PAYLOAD)}`
    );
  });
});

describe("parseSellbaseSignatureHeader", () => {
  it("解析出时间戳和签名", () => {
    const parsed = parseSellbaseSignatureHeader(
      buildSellbaseSignatureHeader(SECRET, PAYLOAD, NOW)
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.timestampSeconds).toBe(NOW);
    expect(parsed?.signatures).toHaveLength(1);
  });

  it("多个 v1 都收下 —— 密钥轮换期会有两个", () => {
    const parsed = parseSellbaseSignatureHeader(
      `t=${NOW},v1=aaaa,v1=bbbb,v1=cccc`
    );
    expect(parsed?.signatures).toEqual(["aaaa", "bbbb", "cccc"]);
  });

  it("空头 / null / undefined → null", () => {
    expect(parseSellbaseSignatureHeader(null)).toBeNull();
    expect(parseSellbaseSignatureHeader(undefined)).toBeNull();
    expect(parseSellbaseSignatureHeader("")).toBeNull();
  });

  it("没有 v1 → null(光有时间戳签不了名)", () => {
    expect(parseSellbaseSignatureHeader(`t=${NOW}`)).toBeNull();
  });

  it("时间戳不是数字 → null", () => {
    expect(parseSellbaseSignatureHeader("t=abc,v1=deadbeef")).toBeNull();
  });

  it("没有等号的碎片被跳过,不炸", () => {
    const parsed = parseSellbaseSignatureHeader(`garbage,t=${NOW},v1=deadbeef`);
    expect(parsed?.timestampSeconds).toBe(NOW);
    expect(parsed?.signatures).toEqual(["deadbeef"]);
  });
});

describe("verifySellbaseSignature", () => {
  it("签名对 → true", () => {
    const header = buildSellbaseSignatureHeader(SECRET, PAYLOAD, NOW);
    expect(verifySellbaseSignature(PAYLOAD, header, SECRET, NOW)).toBe(true);
  });

  it("body 改一个字 → false", () => {
    const header = buildSellbaseSignatureHeader(SECRET, PAYLOAD, NOW);
    const tampered = PAYLOAD.replace("ord_1", "ord_2");
    expect(verifySellbaseSignature(tampered, header, SECRET, NOW)).toBe(false);
  });

  it("密钥不对 → false", () => {
    const header = buildSellbaseSignatureHeader(SECRET, PAYLOAD, NOW);
    expect(verifySellbaseSignature(PAYLOAD, header, "wrong-secret", NOW)).toBe(
      false
    );
  });

  it("时间戳超容差 → false(防重放)", () => {
    const stale = NOW - (SELLBASE_WEBHOOK_TOLERANCE_SECONDS + 1);
    const header = buildSellbaseSignatureHeader(SECRET, PAYLOAD, stale);
    expect(verifySellbaseSignature(PAYLOAD, header, SECRET, NOW)).toBe(false);
  });

  it("时间戳刚好在容差边界上 → 仍然通过", () => {
    const edge = NOW - SELLBASE_WEBHOOK_TOLERANCE_SECONDS;
    const header = buildSellbaseSignatureHeader(SECRET, PAYLOAD, edge);
    expect(verifySellbaseSignature(PAYLOAD, header, SECRET, NOW)).toBe(true);
  });

  it("时间戳在未来(容差内)→ 通过 —— 服务器时钟有偏差很正常", () => {
    const ahead = NOW + 60;
    const header = buildSellbaseSignatureHeader(SECRET, PAYLOAD, ahead);
    expect(verifySellbaseSignature(PAYLOAD, header, SECRET, NOW)).toBe(true);
  });

  it("未来太远 → false", () => {
    const ahead = NOW + (SELLBASE_WEBHOOK_TOLERANCE_SECONDS + 1);
    const header = buildSellbaseSignatureHeader(SECRET, PAYLOAD, ahead);
    expect(verifySellbaseSignature(PAYLOAD, header, SECRET, NOW)).toBe(false);
  });

  it("多个 v1 里任一匹配即通过", () => {
    const good = computeSellbaseSignature(SECRET, NOW, PAYLOAD);
    const header = `t=${NOW},v1=${"0".repeat(64)},v1=${good},v1=${"f".repeat(64)}`;
    expect(verifySellbaseSignature(PAYLOAD, header, SECRET, NOW)).toBe(true);
  });

  it("多个 v1 全不匹配 → false", () => {
    const header = `t=${NOW},v1=${"0".repeat(64)},v1=${"f".repeat(64)}`;
    expect(verifySellbaseSignature(PAYLOAD, header, SECRET, NOW)).toBe(false);
  });

  it("空 header → false(不抛)", () => {
    expect(verifySellbaseSignature(PAYLOAD, null, SECRET, NOW)).toBe(false);
    expect(verifySellbaseSignature(PAYLOAD, "", SECRET, NOW)).toBe(false);
    expect(verifySellbaseSignature(PAYLOAD, undefined, SECRET, NOW)).toBe(
      false
    );
  });

  it("畸形 header → false(不抛)—— 绝不能打成 500", () => {
    for (const header of [
      "garbage",
      "t=abc,v1=zzz",
      "t=123",
      "v1=only-signature",
      "=;=;=",
      `t=${NOW},v1=`,
    ]) {
      expect(
        verifySellbaseSignature(PAYLOAD, header, SECRET, NOW),
        `header=${header}`
      ).toBe(false);
    }
  });

  it("长度不同的签名 → false 而不是抛异常", () => {
    // timingSafeEqual 长度不等会抛 —— 这里必须自己挡掉
    const header = `t=${NOW},v1=short`;
    expect(verifySellbaseSignature(PAYLOAD, header, SECRET, NOW)).toBe(false);
  });
});
