import { describe, expect, it } from "vitest";

import {
  checkTaobaoUrl,
  extractTaobaoItemId,
  isTaobaoHost,
  normalizeTaobaoUrl,
  pickTaobaoTarget,
  TAOBAO_ALLOWED_HOST_SUFFIXES,
} from "@/features/taobao/lib/taobao-link";

/**
 * 淘宝链接的**纯规则**(2026-11-18)
 *
 * 买家在结算页点「淘宝下单」⇒ 跳到这件设计对应的淘宝商品页。
 * 这份规则有三条铁律,每一条都会**直接决定钱怎么收**:
 *
 * 1. **域名必须是 taobao / tmall** —— 链接要摆给买家看,后台录错了就是把人
 *    往别处引(钓鱼风险)
 * 2. **链接必须指向一个具体的商品**(`id=`)—— 一个店铺首页没法表达
 *    「这一单是这件设计」
 * 3. **一单只能有一个跳转目标** —— 车里放了两件不同的设计时,淘宝那边没有
 *    一个链接能同时对应两件货
 *
 * ⇒ 这一层是**零 import**的(只有 `import type`),能进 `unit` project,
 * 不碰数据库、不碰网络。
 */

describe("isTaobaoHost —— 域名必须是 taobao / tmall", () => {
  it("淘宝 / 天猫的根域和子域都过", () => {
    expect(isTaobaoHost("taobao.com")).toBe(true);
    expect(isTaobaoHost("item.taobao.com")).toBe(true);
    expect(isTaobaoHost("detail.tmall.com")).toBe(true);
    expect(isTaobaoHost("shop12345.taobao.com")).toBe(true);
  });

  it("大小写 / 空格不认得出来 —— 归一化后判", () => {
    expect(isTaobaoHost("ITEM.TAOBAO.COM")).toBe(true);
    expect(isTaobaoHost("  item.taobao.com  ")).toBe(true);
  });

  it("结尾看着像的域名不过 —— `taobao.com.evil.com` 不是子域", () => {
    expect(isTaobaoHost("taobao.com.evil.com")).toBe(false);
    expect(isTaobaoHost("not-taobao.com")).toBe(false);
    expect(isTaobaoHost("taobao.cn")).toBe(false);
  });

  it("空域名不过", () => {
    expect(isTaobaoHost("")).toBe(false);
    expect(isTaobaoHost("   ")).toBe(false);
  });

  it("允许的根域就那两个 —— 别的域名一律不许进", () => {
    expect([...TAOBAO_ALLOWED_HOST_SUFFIXES]).toEqual([
      "taobao.com",
      "tmall.com",
    ]);
  });
});

describe("normalizeTaobaoUrl —— 摘掉人复制时带进来的壳", () => {
  it("首尾空格 / 换行摘掉", () => {
    expect(normalizeTaobaoUrl("  https://item.taobao.com/x.htm  ")).toBe(
      "https://item.taobao.com/x.htm"
    );
  });

  it("中文引号 / 直角引号摘掉", () => {
    expect(normalizeTaobaoUrl("“https://item.taobao.com/x.htm”")).toBe(
      "https://item.taobao.com/x.htm"
    );
    expect(normalizeTaobaoUrl("'https://item.taobao.com/x.htm'")).toBe(
      "https://item.taobao.com/x.htm"
    );
    expect(normalizeTaobaoUrl("<https://item.taobao.com/x.htm>")).toBe(
      "https://item.taobao.com/x.htm"
    );
  });

  it("**不改地址本身** —— 不补协议、不改路径(改了可能变成另一个页面)", () => {
    const raw = "http://item.taobao.com/item.htm?id=1";
    expect(normalizeTaobaoUrl(raw)).toBe(raw);
    expect(normalizeTaobaoUrl("item.taobao.com/item.htm?id=1")).toBe(
      "item.taobao.com/item.htm?id=1"
    );
  });
});

describe("extractTaobaoItemId —— 抠商品号", () => {
  it("新形状:`?id=123456789`", () => {
    expect(
      extractTaobaoItemId("https://item.taobao.com/item.htm?id=123456789")
    ).toBe("123456789");
  });

  it("老形状:`/i123456789.htm`", () => {
    expect(extractTaobaoItemId("https://item.taobao.com/i123456789.htm")).toBe(
      "123456789"
    );
  });

  it("id 不是纯数字 ⇒ 抠不出来(**不猜**)", () => {
    // 抠错了工作室照着它核货会核错 ⇒ 宁可说「指不到具体商品」
    expect(
      extractTaobaoItemId("https://item.taobao.com/item.htm?id=abc")
    ).toBeNull();
  });

  it("根本不是网址 ⇒ 抠不出来", () => {
    expect(extractTaobaoItemId("不是网址")).toBeNull();
    expect(extractTaobaoItemId("")).toBeNull();
  });

  it("店铺首页(没有商品号)⇒ 抠不出来", () => {
    expect(extractTaobaoItemId("https://shop12345.taobao.com/")).toBeNull();
  });
});

describe("checkTaobaoUrl —— 五道闸,顺序短路", () => {
  it("① 空 ⇒ EMPTY", () => {
    expect(checkTaobaoUrl("")).toEqual({ ok: false, problem: "EMPTY" });
    expect(checkTaobaoUrl("    ")).toEqual({ ok: false, problem: "EMPTY" });
  });

  it("② 不是个网址 ⇒ INVALID_URL", () => {
    expect(checkTaobaoUrl("不是网址")).toEqual({
      ok: false,
      problem: "INVALID_URL",
    });
  });

  it("③ 协议不是 http / https ⇒ INVALID_URL", () => {
    // `javascript:` 塞进 href 就是钓鱼 —— 界面要能挡住
    expect(checkTaobaoUrl("javascript:alert(1)")).toEqual({
      ok: false,
      problem: "INVALID_URL",
    });
    expect(checkTaobaoUrl("ftp://item.taobao.com/item.htm?id=1")).toEqual({
      ok: false,
      problem: "INVALID_URL",
    });
  });

  it("④ 域名不是 taobao / tmall ⇒ NOT_TAOBAO", () => {
    expect(
      checkTaobaoUrl("https://evil.example.com/item.htm?id=123456789")
    ).toEqual({ ok: false, problem: "NOT_TAOBAO" });
    expect(
      checkTaobaoUrl("https://taobao.com.evil.com/item.htm?id=123456789")
    ).toEqual({ ok: false, problem: "NOT_TAOBAO" });
  });

  it("⑤ 是淘宝的网址但指不到具体商品 ⇒ NO_ITEM_ID", () => {
    expect(checkTaobaoUrl("https://shop12345.taobao.com/")).toEqual({
      ok: false,
      problem: "NO_ITEM_ID",
    });
  });

  it("全过 ⇒ ok,带归一化后的地址和商品号", () => {
    const result = checkTaobaoUrl(
      "  “https://item.taobao.com/item.htm?id=123456789”  "
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe("https://item.taobao.com/item.htm?id=123456789");
      expect(result.itemId).toBe("123456789");
    }
  });

  it("天猫的链接也过", () => {
    const result = checkTaobaoUrl(
      "https://detail.tmall.com/item.htm?id=987654321"
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.itemId).toBe("987654321");
  });
});

describe("pickTaobaoTarget —— 这一单跳哪个链接", () => {
  it("一件货 ⇒ 那件设计", () => {
    expect(pickTaobaoTarget(["keychain-pet-portrait"])).toEqual({
      ok: true,
      handle: "keychain-pet-portrait",
    });
  });

  it("同一件设计买好几件(不同尺寸 / 配件)⇒ 还是一个链接", () => {
    // 判据是「**不同的设计**」,不是「几件货」—— 淘宝那边拍 3 件就行
    expect(
      pickTaobaoTarget([
        "keychain-pet-portrait",
        "keychain-pet-portrait",
        "keychain-pet-portrait",
      ])
    ).toEqual({ ok: true, handle: "keychain-pet-portrait" });
  });

  it("两件**不同的设计**⇒ MULTIPLE_DESIGNS(不随便挑一个 —— 会买错货)", () => {
    const result = pickTaobaoTarget([
      "keychain-pet-portrait",
      "figure-couple-statue",
    ]);
    expect(result).toEqual({ ok: false, problem: "MULTIPLE_DESIGNS" });
  });

  it("车里一件货都没有 ⇒ NO_ITEM", () => {
    expect(pickTaobaoTarget([])).toEqual({
      ok: false,
      problem: "NO_ITEM",
    });
    expect(pickTaobaoTarget([""])).toEqual({
      ok: false,
      problem: "NO_ITEM",
    });
  });
});
