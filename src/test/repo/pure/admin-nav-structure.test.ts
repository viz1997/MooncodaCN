import { describe, expect, it } from "vitest";

import { adminNav, type NavItem } from "@/config/nav";

/**
 * 后台侧边栏的**分组结构**(2026-11-14)
 *
 * 工作室的两条要求:
 *
 * - 「打印定价、站点设置、支付设置都放在设置菜单里作为子菜单」
 * - 「打印订单作为订单管理子菜单」
 *
 * ## 为什么单测守这个
 *
 * 侧边栏那棵树是**数据**(`src/config/nav.ts`),不是 JSX —— 结构写在数据里,
 * 渲染那套(`admin-sidebar.tsx` 的 `item.children`)早就有了。改动只是挪几行
 * 配置,但**挪错了没人拦**:少一个 `children` ⇒ 那一项从子菜单里消失了(后台
 * 少一个入口);多一个 `children` ⇒ 父子重复,点两遍才走得通。
 *
 * ⇒ 这条测试把「谁是谁的子项」钉死。
 */

/** 后台导航的**顶层项**(每个分组的 items) */
function topLevel(): NavItem[] {
  return adminNav.flatMap((group) => group.items);
}

/** 按标题找顶层项 */
function findTop(title: string): NavItem | undefined {
  return topLevel().find((item) => item.title === title);
}

/** 某个顶层项的子项标题 */
function childrenTitles(item: NavItem | undefined): string[] {
  return (item?.children ?? []).map((child) => child.title);
}

describe("后台侧边栏的分组结构", () => {
  it("① 「打印订单」是「订单管理」的子项,不是顶层项", () => {
    const orders = findTop("订单管理");
    expect(orders, "找不到顶层项「订单管理」").toBeDefined();

    expect(childrenTitles(orders)).toContain("打印订单");

    const printOrders = (orders?.children ?? []).find(
      (c) => c.title === "打印订单"
    );
    expect(printOrders?.href).toBe("/admin/print-orders");

    // 顶层**不许**再摆一份 —— 否则侧边栏上出现两个「打印订单」
    expect(
      topLevel().some((item) => item.title === "打印订单"),
      "「打印订单」还在顶层 —— 挪进分组了没?"
    ).toBe(false);
  });

  it("② 「设置」下挂着打印定价 / 站点设置 / 支付设置", () => {
    const settings = findTop("设置");
    expect(settings, "找不到顶层项「设置」").toBeDefined();

    expect(childrenTitles(settings)).toEqual([
      "打印定价",
      "站点设置",
      "支付设置",
    ]);

    const hrefs = (settings?.children ?? []).map((c) => c.href);
    expect(hrefs).toEqual([
      "/admin/print-pricing",
      "/admin/site-settings",
      "/admin/payment-settings",
    ]);

    // 三项都**不许**再留在顶层
    for (const title of ["打印定价", "站点设置", "支付设置"]) {
      expect(
        topLevel().some((item) => item.title === title),
        `「${title}」还在顶层 —— 挪进「设置」了没?`
      ).toBe(false);
    }
  });

  it("③ 分组父项的 href 指向它的第一个子项(仓库里既有那套做法)", () => {
    // 「商品管理」那组 2026-10-21 就是这么写的(父项 href = 某个子项的 href)
    // ——「设置」没有自己的页面(没有「设置总览」),父项只能落到第一个子项。
    const settings = findTop("设置");
    expect(settings?.href).toBe("/admin/print-pricing");
    expect(settings?.children?.[0]?.href).toBe(settings?.href);

    // 「订单管理」父项**自己就是一个页面**(gpt-image 生图订单),不是分类头
    const orders = findTop("订单管理");
    expect(orders?.href).toBe("/admin/orders");
  });

  it("④ 没被要求挪走的项**留在顶层**", () => {
    // 挪三项的时候别手滑把别的也拖进去 —— 优惠码 / 文件管理 / 发货管理
    // 工作室没提过,它们各自是独立的一级入口。
    for (const title of [
      "用户管理",
      "工单管理",
      "文件管理",
      "优惠码",
      "发货管理",
      "商品管理",
      "外部生图",
      "系统日志",
    ]) {
      expect(findTop(title), `顶层少了「${title}」`).toBeDefined();
    }
  });

  it("⑤ 每一项(顶层 + 子项)都有 href —— 侧边栏拿它当 React key", () => {
    for (const item of topLevel()) {
      expect(item.href, `「${item.title}」没有 href`).toBeTruthy();
      for (const child of item.children ?? []) {
        expect(
          child.href,
          `「${item.title} → ${child.title}」没有 href`
        ).toBeTruthy();
      }
    }
  });
});
