// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  closeExternalTab,
  isTaobaoChannel,
  navigateExternalTab,
  openBlankTab,
} from "@/features/storefront/lib/external-tab";

/**
 * 跳淘宝**新开页面**(2026-11-18)
 *
 * 工作室的原话:**「进入淘宝是新开页面」**。
 *
 * ## 为什么不能直接 `window.open(url, "_blank")`
 *
 * 结算要 **await 一次服务端**才拿到付款地址 ⇒ `window.open(url)` 发生在
 * 用户手势**之外** ⇒ 浏览器**拦**它 ⇒ 用户点了没反应。
 *
 * ⇒ **两段式**:点击那一刻同步开一个**空白**标签页,拿到地址之后再导航过去。
 *
 * ## 守住什么
 *
 * 1. **空白标签页是在点击那一刻开的**(同步)—— 不是 await 之后才开的
 * 2. **失败要把那个空白标签页关掉** —— 留一个空白页在屏幕上比不留更招人烦
 * 3. **弹窗真被拦了 ⇒ 本页跳**(老行为)—— 用户宁可离开本页,也不能「点了没反应」
 * 4. **只有淘宝走新开页面** —— 支付宝必须整页跳
 */

/** 一个假的标签页(jsdom 的 window.open 不可控) */
function fakeTab(closed = false) {
  return {
    closed,
    location: { href: "" },
    close: vi.fn(function close(this: { closed: boolean }) {
      this.closed = true;
    }),
  } as unknown as Window;
}

/** 本页的 `window.location` —— jsdom 里改不动,得换掉 */
const ORIGINAL_LOCATION = Object.getOwnPropertyDescriptor(window, "location");

/** 把本页的跳转记下来(本站不该动 —— 一动就是「新开页面」没生效) */
function stubWindowLocation() {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get href() {
        return assign.mock.calls[0]?.[0] ?? "";
      },
      set href(value: string) {
        assign(value);
      },
    },
  });
  return assign;
}

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_LOCATION) {
    Object.defineProperty(window, "location", ORIGINAL_LOCATION);
  }
});

describe("新开页面 —— 空白标签页", () => {
  it("开出来的是**空白**页(不是直接跳目标地址)", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(fakeTab());
    openBlankTab();
    // 直接跳地址 ⇒ 浏览器会把目标地址交给弹窗拦截器 ⇒ 弹窗被挡
    expect(open).toHaveBeenCalledWith("", "_blank");
  });

  it("弹窗被拦(返回 null)⇒ null", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(openBlankTab()).toBeNull();
  });

  it("`window.open` 自己抛了(不在浏览器里)⇒ null,不炸", () => {
    vi.spyOn(window, "open").mockImplementation(() => {
      throw new Error("no window");
    });
    expect(openBlankTab()).toBeNull();
  });
});

describe("新开页面 —— 导航过去", () => {
  it("标签页还在 ⇒ 导航到目标地址(**本页不动**)", () => {
    const tab = fakeTab();
    const assign = stubWindowLocation();

    navigateExternalTab(
      tab,
      "https://h5.m.taobao.com/cart/order.html?buyParam=1_1"
    );
    expect(tab.location.href).toBe(
      "https://h5.m.taobao.com/cart/order.html?buyParam=1_1"
    );
    // 本站这一页**不许动** —— 付完还要回来查订单
    expect(assign).not.toHaveBeenCalled();
  });

  it("标签页没了(用户自己关了)⇒ 退回**整页跳转**", () => {
    const assign = stubWindowLocation();

    navigateExternalTab(fakeTab(true), "https://item.taobao.com/item.htm?id=1");
    expect(assign).toHaveBeenCalledWith(
      "https://item.taobao.com/item.htm?id=1"
    );
  });

  it("压根没开出来(null)⇒ 退回**整页跳转**", () => {
    const assign = stubWindowLocation();

    navigateExternalTab(null, "https://item.taobao.com/item.htm?id=1");
    expect(assign).toHaveBeenCalledWith(
      "https://item.taobao.com/item.htm?id=1"
    );
  });
});

describe("新开页面 —— 失败要把那个空白页关掉", () => {
  it("关掉了", () => {
    const tab = fakeTab();
    closeExternalTab(tab);
    expect(
      (tab as unknown as { close: ReturnType<typeof vi.fn> }).close
    ).toHaveBeenCalled();
  });

  it("已经关了 ⇒ 不再关一次(用户自己关的不用管)", () => {
    const tab = fakeTab(true);
    closeExternalTab(tab);
    expect(
      (tab as unknown as { close: ReturnType<typeof vi.fn> }).close
    ).not.toHaveBeenCalled();
  });

  it("null ⇒ 什么都不做", () => {
    expect(() => closeExternalTab(null)).not.toThrow();
  });

  it("关不掉(抛错)⇒ 不炸 —— 顶多留一个空白页", () => {
    const tab = {
      closed: false,
      location: { href: "" },
      close: () => {
        throw new Error("cross-origin");
      },
    } as unknown as Window;
    expect(() => closeExternalTab(tab)).not.toThrow();
  });
});

describe("只有淘宝走新开页面", () => {
  it("淘宝 ⇒ 是", () => {
    expect(isTaobaoChannel("taobao")).toBe(true);
  });

  it("别的通道 ⇒ 不是(**支付宝必须整页跳**)", () => {
    expect(isTaobaoChannel("alipay")).toBe(false);
    expect(isTaobaoChannel("wechat")).toBe(false);
    expect(isTaobaoChannel("offline")).toBe(false);
    expect(isTaobaoChannel(null)).toBe(false);
    expect(isTaobaoChannel(undefined)).toBe(false);
  });
});
