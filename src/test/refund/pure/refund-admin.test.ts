/**
 * 后台退款管理页 —— 路由 / 侧边栏 / i18n
 *
 * ## 守住什么
 *
 * | 断言 | 为什么 |
 * |---|---|
 * | 路由在 `/admin/refunds` | 工作室处理退款就靠这一页 |
 * | 侧边栏登记了 | 登记不了 = 工作室找不到入口 |
 * | 「退款管理」有 i18n 映射 | `/en` 的后台不该漏中文(整个 `nav.ts` 的扫描在 `src/test/repo/pure/admin-sidebar-i18n.test.ts` 里,这里只盯退款这一项) |
 * | **每个错误码两种语言都摆得上话** | 界面按 code 查文案;查不到就退回一句笼统的「操作失败」,工作室看不出哪儿错了 |
 * | **中英文键集完全一致** | 一个语言缺一个键 ⇒ 那一项渲染成原始键名 + 控制台刷一条 `MISSING_MESSAGE` |
 *
 * ## 「中英文键集一致」那条测试**抓不到**漏键
 *
 * 两个语言**都缺**同一个键 ⇒ 键集照样一致 ⇒ 只比 zh / en 的测试一律通过。
 * ⇒ 这里还额外断言**具体那几个键**在两边都存在(错误码表 + 侧边栏那一条)。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import * as refundErrorText from "@/features/refund/lib/error-text";

const ROOT = resolve(process.cwd());

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

/** 去掉注释 —— 注释里写了什么不算数,代码里写了才算 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function loadMessages(locale: "zh" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
}

function getPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** 摊平成 `a.b.c` 的点路径 */
function flatten(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    v && typeof v === "object"
      ? flatten(v, prefix ? `${prefix}.${k}` : k)
      : [prefix ? `${prefix}.${k}` : k]
  );
}

/** 从一个联合类型里抠出全部字符串字面量 */
function unionCodes(src: string, typeName: string): string[] {
  const m = new RegExp(
    `export type ${typeName}\\s*=\\s*([\\s\\S]*?);`
  ).exec(src);
  if (!m?.[1]) return [];
  return [...m[1].matchAll(/"([A-Z0-9_]+)"/g)]
    .map((x) => x[1])
    .filter((code): code is string => code !== undefined);
}

/* ========================================================================== */
/*  1. 路由                                                                    */
/* ========================================================================== */

describe("后台退款管理:路由", () => {
  const PAGE = "src/app/[locale]/(admin)/admin/refunds/page.tsx";

  it("页面文件在 `/admin/refunds`", () => {
    expect(() => read(PAGE)).not.toThrow();
  });

  it("RSC **只**渲染 `<RefundsAdminView />` —— 取数在客户端组件里", () => {
    const src = read(PAGE);
    expect(src).toContain("RefundsAdminView");
    expect(src).toContain("<RefundsAdminView />");
  });

  it("**不自己判 admin** —— RBAC 由父 layout 守", () => {
    // 文件头注释解释着「RBAC 由父 layout 守」⇒ 去掉注释再看
    const src = stripComments(read(PAGE));
    expect(src).not.toContain("checkAdmin");
    expect(src).not.toContain("getServerSession");
  });

  it("不在 RSC 里取数(照「发货台」那个形状)", () => {
    const src = stripComments(read(PAGE));
    expect(src).not.toContain("await db");
    expect(src).not.toContain("listRefundRequestsAction(");
  });

  it("页面在 `(admin)` 组里 —— 不在公开路由组里", () => {
    expect(PAGE).toContain("(admin)");
  });
});

/* ========================================================================== */
/*  2. 侧边栏登记                                                              */
/* ========================================================================== */

describe("后台退款管理:侧边栏登记了", () => {
  const nav = read("src/config/nav.ts");

  it("`adminNav` 里有「退款管理」这一项,指向 `/admin/refunds`", () => {
    // 从 `export const adminNav` 往后取(那一段是后台的树)
    const start = nav.indexOf("export const adminNav");
    expect(start).toBeGreaterThan(-1);
    const adminNav = nav.slice(start);

    expect(adminNav).toContain('title: "退款管理"');
    expect(adminNav).toContain('href: "/admin/refunds"');
  });

  it("跟「发货管理」平级 —— 它俩都同时管商城订单和打印工单", () => {
    const start = nav.indexOf("export const adminNav");
    const adminNav = nav.slice(start);

    const shipping = adminNav.indexOf('href: "/admin/shipments"');
    const refunds = adminNav.indexOf('href: "/admin/refunds"');
    expect(shipping).toBeGreaterThan(-1);
    expect(refunds).toBeGreaterThan(-1);

    // 两项之间没有 `children` ⇒ 退款不是「发货管理」的子项
    const between = adminNav.slice(shipping, refunds);
    expect(between).not.toContain("children:");
  });

  it("侧边栏那张中文标题表里有「退款管理」的映射", () => {
    const sidebar = read("src/features/admin/components/admin-sidebar.tsx");
    expect(sidebar).toMatch(/退款管理:\s*t\("nav\.refunds"\)/);
  });

  it("`AdminSidebar.nav.refunds` 两种语言都在", () => {
    for (const locale of ["zh", "en"] as const) {
      const value = getPath(loadMessages(locale), "AdminSidebar.nav.refunds");
      expect(value, `${locale}.json 缺 AdminSidebar.nav.refunds`).toBeDefined();
      expect(typeof value).toBe("string");
    }
  });
});

/* ========================================================================== */
/*  3. 每个错误码两种语言都摆得上话                                             */
/* ========================================================================== */

describe("后台退款管理:错误码都有文案", () => {
  const adminTypes = read("src/features/refund/admin/types.ts");
  const libTypes = read("src/features/refund/lib/types.ts");

  const adminCodes = unionCodes(adminTypes, "AdminRefundErrorCode");
  const ineligibleCodes = unionCodes(libTypes, "RefundIneligibleCode");

  it("抠到了错误码 —— 扫描正则没坏", () => {
    expect(adminCodes.length).toBeGreaterThan(0);
    expect(ineligibleCodes.length).toBeGreaterThan(0);
  });

  it("后台那一批是 12 个", () => {
    expect(adminCodes).toHaveLength(12);
  });

  it("买家侧那一批是 6 个", () => {
    expect(ineligibleCodes).toHaveLength(6);
  });

  it("**每一个**错误码在 zh / en 都有文案", () => {
    const all = [...new Set([...adminCodes, ...ineligibleCodes])];
    for (const locale of ["zh", "en"] as const) {
      for (const code of all) {
        const value = getPath(loadMessages(locale), `Refund.errors.${code}`);
        expect(value, `${locale}.json 缺 Refund.errors.${code}`).toBeDefined();
        expect(typeof value).toBe("string");
        expect(String(value).length).toBeGreaterThan(0);
      }
    }
  });

  it("兜底那一条也在(`errors.FAILED`)—— 认不出来的 code 退到它", () => {
    for (const locale of ["zh", "en"] as const) {
      const value = getPath(loadMessages(locale), "Refund.errors.FAILED");
      expect(value).toBeDefined();
    }
  });

  it("文案查的是**同一张表** —— 买家侧和后台共用一张错误码表", () => {
    // 买家侧错误文案那张表在 `features/refund/lib/error-text.ts`(零 import)
    // ⇒ 直接 import 它跑真函数,比扫字符串可靠
    const { REFUND_ERROR_CODES, REFUND_ERROR_FALLBACK_KEY, refundErrorTextKey } =
      refundErrorText;

    // **每一个**联合类型里的码都在这张表里 —— 漏一个 ⇒ 界面退到兜底那句
    for (const code of [...adminCodes, ...ineligibleCodes]) {
      expect(
        (REFUND_ERROR_CODES as readonly string[]).includes(code),
        `${code} 不在 REFUND_ERROR_CODES 里`
      ).toBe(true);
    }

    // 兜底那一条:**key**(`errors.FAILED`)—— 它不是 code,不必在码表里,
    // 但它**一定**在两个语言的文案里(上面那条已经断言过)
    expect(REFUND_ERROR_FALLBACK_KEY).toBe("errors.FAILED");

    // 查一个已注册的码 ⇒ 拼出 `errors.<code>`
    expect(refundErrorTextKey("PRODUCTION_STARTED")).toBe(
      "errors.PRODUCTION_STARTED"
    );
    // 查一个**不认识**的码 ⇒ 退到兜底,绝不把没注册过的 key 交给 `t()`
    expect(refundErrorTextKey("SOMETHING_ELSE")).toBe("errors.FAILED");
    expect(refundErrorTextKey(null)).toBe("errors.FAILED");
  });
});

/* ========================================================================== */
/*  4. 中英文键集完全一致                                                       */
/* ========================================================================== */

describe("后台退款管理:中英文键集完全一致", () => {
  const zh = loadMessages("zh");
  const en = loadMessages("en");

  for (const ns of ["Refund", "AdminRefund"]) {
    it(`\`${ns}\` 两个语言的键集一模一样`, () => {
      const zhKeys = flatten(getPath(zh, ns)).sort();
      const enKeys = flatten(getPath(en, ns)).sort();
      expect(zhKeys.length).toBeGreaterThan(0);
      expect(enKeys).toEqual(zhKeys);
    });
  }

  it("`AdminRefund` 的三个子命名空间都在", () => {
    for (const locale of ["zh", "en"] as const) {
      const messages = loadMessages(locale);
      expect(getPath(messages, "AdminRefund.title")).toBeDefined();
      expect(getPath(messages, "AdminRefund.table.orderNo")).toBeDefined();
      expect(getPath(messages, "AdminRefund.actions.execute")).toBeDefined();
    }
  });

  it("后台那四个动作按钮都有文案", () => {
    for (const locale of ["zh", "en"] as const) {
      for (const key of [
        "approve",
        "execute",
        "markRefunded",
        "reject",
      ]) {
        expect(
          getPath(loadMessages(locale), `AdminRefund.actions.${key}`),
          `${locale}.json 缺 AdminRefund.actions.${key}`
        ).toBeDefined();
      }
    }
  });

  it("「执行退款」那个按钮上写着金额 —— 动钱的操作要看得见数", () => {
    for (const locale of ["zh", "en"] as const) {
      expect(
        getPath(loadMessages(locale), "AdminRefund.actions.executeWithAmount")
      ).toBeDefined();
      expect(
        getPath(loadMessages(locale), "AdminRefund.actions.markRefundedWithAmount")
      ).toBeDefined();
    }
  });

  it("订单状态文案两种语言都摆得上话(工单那六个 + 商城那四个)", () => {
    for (const locale of ["zh", "en"] as const) {
      for (const key of [
        "orderStatus.storefront.unpaid",
        "orderStatus.storefront.paid",
        "orderStatus.storefront.fulfilled",
        "orderStatus.storefront.cancelled",
        "orderStatus.print.PENDING",
        "orderStatus.print.CONFIRMED",
        "orderStatus.print.IN_PRODUCTION",
        "orderStatus.print.SHIPPED",
        "orderStatus.print.COMPLETED",
        "orderStatus.print.CANCELLED",
      ]) {
        expect(
          getPath(loadMessages(locale), `AdminRefund.${key}`),
          `${locale}.json 缺 AdminRefund.${key}`
        ).toBeDefined();
      }
    }
  });

  it("收款通道那六个都摆得上话(含「其它」兜底)", () => {
    for (const locale of ["zh", "en"] as const) {
      for (const key of [
        "wechat",
        "alipay",
        "offline",
        "shopify",
        "stripe",
        "unknown",
      ]) {
        expect(
          getPath(loadMessages(locale), `AdminRefund.channel.${key}`),
          `${locale}.json 缺 AdminRefund.channel.${key}`
        ).toBeDefined();
      }
    }
  });
});

/* ========================================================================== */
/*  5. 后台列表:筛选 / 状态机共用同一份                                          */
/* ========================================================================== */

describe("后台退款管理:列表与状态机共用同一份规则", () => {
  const view = read(
    "src/features/refund/admin/components/refunds-admin-view.tsx"
  );
  const panel = read(
    "src/features/refund/admin/components/refund-expand-panel.tsx"
  );

  it("筛选用的状态清单来自状态机 —— 不自己写一份", () => {
    const combined = view + panel;
    expect(combined).toContain("allowedNextRefundStatuses");
    expect(combined).toContain("isTerminalRefundStatus");
  });

  it("状态机的 import 路径是退款这一份(不是别的模块)", () => {
    const combined = view + panel;
    expect(combined).toContain("@/features/refund/lib/transitions");
  });

  it("「收款通道」那一列走的是**同一个** label 实现", () => {
    expect(view).toContain("refundChannelLabel");
    expect(view).toContain("@/features/refund/admin/channel-label");
  });

  it("列表是 antd 的 `Table` + 就地展开", () => {
    expect(view).toContain("Table");
    expect(view).toContain("expandedRowRender");
  });

  it("**没有 `Popconfirm`** —— 仓库的后台一律不用它", () => {
    expect(view).not.toContain("Popconfirm");
    expect(panel).not.toContain("Popconfirm");
  });
});
