import { describe, expect, it } from "vitest";

import {
  DEFAULT_POST_SIGN_IN_PATH,
  isSafeCallbackPath,
  readCallbackUrl,
  readSameOriginReferrerPath,
  resolvePostSignInUrl,
  withLocalePrefix,
} from "@/features/auth/lib/post-sign-in-url";

/**
 * 登录之后回哪儿(2026-11-16)
 *
 * ## 为什么值得守
 *
 * 工作室 2026-11-16 的要求:**「用户不登陆也可以使用工具检测模型、克重等等,
 * 但是用户点击报价下单需要引导用户登录」**。
 *
 * 访客在打印工作台量完模型 ⇒ 点「报价」⇒ 弹窗里就地登录 ⇒ 登录完**模型
 * 还在内存里**(那条路走 `router.refresh()`,不跳页)。
 *
 * 但**手机号 + 验证码**那条路**只能**走完整登录页 —— 那一跳会离开这一页。
 * ⇒ 登录页必须记得「用户是从哪儿来的」,否则用户回来时模型没了,等于白量。
 *
 * 这份纯函数就是那份记忆:
 *
 * 1. `?callbackUrl=…` —— 业务侧显式给的(打印工作台就带这个)
 * 2. 同源 `document.referrer` —— 用户在公开页点登录 ⇒ 来自哪里回哪里
 * 3. `/dashboard` —— 兜底
 *
 * ## 两条硬规矩
 *
 * - **不许 open redirect** —— `callbackUrl` 只收**站内相对路径**
 * - **同源** —— 外站的 referrer 一律不认
 */

describe("callbackUrl 的安全性", () => {
  it("只收站内相对路径", () => {
    expect(isSafeCallbackPath("/zh/tools/workbench")).toBe(true);
    expect(isSafeCallbackPath("/dashboard")).toBe(true);
  });

  it("外站 / 协议相对 / 反斜杠一律拒掉", () => {
    expect(isSafeCallbackPath("https://evil.example.com")).toBe(false);
    expect(isSafeCallbackPath("//evil.example.com")).toBe(false);
    expect(isSafeCallbackPath("/\\evil.example.com")).toBe(false);
    expect(isSafeCallbackPath("")).toBe(false);
    expect(isSafeCallbackPath(null)).toBe(false);
    expect(isSafeCallbackPath(undefined)).toBe(false);
  });

  it("从查询串里读 callbackUrl", () => {
    expect(readCallbackUrl("?callbackUrl=%2Fzh%2Ftools%2Fworkbench")).toBe(
      "/zh/tools/workbench"
    );
    expect(readCallbackUrl("")).toBeNull();
    expect(readCallbackUrl("?other=1")).toBeNull();
  });
});

describe("语言前缀", () => {
  it("已经带前缀的不动它", () => {
    expect(withLocalePrefix("/zh/tools/workbench", "/zh/sign-in")).toBe(
      "/zh/tools/workbench"
    );
    expect(withLocalePrefix("/en/tools/workbench", "/en/sign-in")).toBe(
      "/en/tools/workbench"
    );
  });

  it("没带前缀的补上当前页面的语言", () => {
    expect(withLocalePrefix("/tools/workbench", "/zh/sign-in")).toBe(
      "/zh/tools/workbench"
    );
    expect(withLocalePrefix("/tools/workbench", "/en/sign-in")).toBe(
      "/en/tools/workbench"
    );
  });

  it("当前页面认不出语言 ⇒ 原样返回(不瞎猜)", () => {
    expect(withLocalePrefix("/tools/workbench", "/sign-in")).toBe(
      "/tools/workbench"
    );
  });

  it("`/english` 不算语言前缀", () => {
    expect(withLocalePrefix("/english/x", "/zh/sign-in")).toBe("/zh/english/x");
  });
});

describe("referrer 只认同源", () => {
  it("同源的相对路径认", () => {
    expect(
      readSameOriginReferrerPath(
        "https://aimake3d.com/zh/tools/workbench?x=1#y",
        "https://aimake3d.com"
      )
    ).toBe("/zh/tools/workbench?x=1#y");
  });

  it("外站不认 —— 不把用户送到外站去", () => {
    expect(
      readSameOriginReferrerPath(
        "https://evil.example.com/zh/tools/workbench",
        "https://aimake3d.com"
      )
    ).toBeNull();
  });

  it("空 / 解析失败不认", () => {
    expect(readSameOriginReferrerPath("", "https://aimake3d.com")).toBeNull();
    expect(readSameOriginReferrerPath("不是网址", "https://aimake3d.com")).toBe(
      null
    );
    expect(readSameOriginReferrerPath("https://aimake3d.com/x", "")).toBeNull();
  });
});

describe("登录后跳转目标 —— 优先级", () => {
  const base = {
    origin: "https://aimake3d.com",
    pathname: "/zh/sign-in",
  };

  it("`?callbackUrl=` 优先 —— 打印工作台就靠这个", () => {
    expect(
      resolvePostSignInUrl({
        ...base,
        search: "?callbackUrl=%2Fzh%2Ftools%2Fworkbench",
        referrer: "https://aimake3d.com/zh/products",
      })
    ).toBe("/zh/tools/workbench");
  });

  it("callbackUrl 没带语言前缀 ⇒ 补当前页面的语言", () => {
    expect(
      resolvePostSignInUrl({
        ...base,
        search: "?callbackUrl=%2Ftools%2Fworkbench",
        referrer: "",
      })
    ).toBe("/zh/tools/workbench");
  });

  it("callbackUrl 不安全 ⇒ 退回 referrer(不跳外站)", () => {
    expect(
      resolvePostSignInUrl({
        ...base,
        search: "?callbackUrl=https%3A%2F%2Fevil.example.com",
        referrer: "https://aimake3d.com/zh/products",
      })
    ).toBe("/zh/products");
  });

  it("没有 callbackUrl ⇒ 同源 referrer", () => {
    expect(
      resolvePostSignInUrl({
        ...base,
        search: "",
        referrer: "https://aimake3d.com/zh/tools/workbench",
      })
    ).toBe("/zh/tools/workbench");
  });

  it("都没有 ⇒ 回控制台", () => {
    expect(
      resolvePostSignInUrl({
        ...base,
        search: "",
        referrer: "",
      })
    ).toBe(DEFAULT_POST_SIGN_IN_PATH);
  });

  it("外站 referrer 也认不得 ⇒ 回控制台", () => {
    expect(
      resolvePostSignInUrl({
        ...base,
        search: "",
        referrer: "https://evil.example.com/",
      })
    ).toBe(DEFAULT_POST_SIGN_IN_PATH);
  });
});
