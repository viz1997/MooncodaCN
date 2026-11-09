import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 优惠码后台 —— 扫描式守卫(2026-11-08)
 *
 * ## 守什么
 *
 * 1. **后台页在不在** —— `/admin/coupons` 的路由 + 视图
 * 2. **迁移脚本补没补那几列** —— 少一列,查表就整条报错 ⇒ 读不到配置 ⇒
 *    整份退回兜底(工作室看到的是「读不到优惠码」)
 * 3. **「use server」文件没 re-export 类型** —— Turbopack 会把类型
 *    re-export 注册成 server action,运行时引用一个不存在的类型绑定 →
 *    `ReferenceError` → **整个页面 500**
 * 4. **中英文 `AdminCoupons` 键一样** —— 少一个键,英文界面就摆一句
 *    「MISSING_MESSAGE」
 * 5. **每个错误码两种语言都摆得上话** —— 工作室看到一个没有文案的码,
 *    只能去翻服务端日志
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着的不算 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/** 读一份消息文件 */
function messages(locale: "zh" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
}

/** 递归列出叶子路径 —— `a.b.c` 那种 */
function leafKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out.push(...leafKeys(v, prefix ? `${prefix}.${k}` : k));
  }
  return out;
}

const ADMIN_PAGE = "src/app/[locale]/(admin)/admin/coupons/page.tsx";
const ADMIN_VIEW =
  "src/features/coupon/admin/components/coupons-admin-view.tsx";
const ADMIN_ACTIONS = "src/features/coupon/admin/actions.ts";
const ADMIN_TYPES = "src/features/coupon/admin/types.ts";
const MIGRATION = "scripts/apply-coupon-schema.ts";
const NAV = "src/config/nav.ts";
const SIDEBAR = "src/features/admin/components/admin-sidebar.tsx";

/** 后台写操作的错误码 —— 与 `admin/types.ts` 的 `AdminCouponErrorCode` 对齐 */
const ADMIN_ERROR_CODES = [
  "CODE_DUPLICATE",
  "COUPON_NOT_FOUND",
  "INVALID_RULE",
  "MIGRATION_MISSING",
  "SAVE_FAILED",
];

/** 优惠码本身的错误码 —— 与 `coupon-calc.ts` 的 `CouponErrorCode` 对齐 */
const COUPON_ERROR_CODES = [
  "COUPON_NOT_FOUND",
  "COUPON_INACTIVE",
  "COUPON_NOT_STARTED",
  "COUPON_EXPIRED",
  "COUPON_SCOPE_MISMATCH",
  "COUPON_NOT_APPLICABLE",
  "COUPON_MIN_AMOUNT_NOT_MET",
  "COUPON_LIMIT_REACHED",
  "COUPON_PER_USER_LIMIT_REACHED",
  "COUPON_NOT_FIRST_ORDER",
];

/* -------------------------------------------------------------------------- */
/*  后台页                                                                     */
/* -------------------------------------------------------------------------- */

describe("优惠码后台 —— 页面在不在", () => {
  it("路由文件在,渲染的是客户端视图", () => {
    expect(existsSync(join(ROOT, ADMIN_PAGE))).toBe(true);

    const page = read(ADMIN_PAGE);
    expect(page).toContain("CouponsAdminView");
    // RSC 只渲染组件 —— 数据由客户端组件自己去拉
    expect(page).toContain('from "@/features/coupon/admin/components/');
  });

  it("视图文件在,用的是 antd 的 `Form` + `Table`", () => {
    expect(existsSync(join(ROOT, ADMIN_VIEW))).toBe(true);

    const view = stripComments(read(ADMIN_VIEW));
    expect(view).toContain('"use client"');
    expect(view).toContain("<Table");
    expect(view).toContain("<Form");
  });

  it("侧边栏有这一项,标题能查到", () => {
    const nav = stripComments(read(NAV));
    expect(nav).toContain('href: "/admin/coupons"');

    const sidebar = stripComments(read(SIDEBAR));
    expect(sidebar).toContain('优惠码: t("nav.coupons")');
  });
});

/* -------------------------------------------------------------------------- */
/*  迁移脚本                                                                   */
/* -------------------------------------------------------------------------- */

describe("优惠码后台 —— 迁移脚本补齐那几列", () => {
  const script = read(MIGRATION);

  it("建了 `coupon` + `coupon_redemption` 两张表", () => {
    expect(script).toContain('CREATE TABLE IF NOT EXISTS "coupon"');
    expect(script).toContain('CREATE TABLE IF NOT EXISTS "coupon_redemption"');
  });

  it("给三张已有的表补了优惠码相关的列", () => {
    const code = stripComments(script);

    expect(code).toContain('ALTER TABLE "cart"');
    expect(code).toContain('"coupon_code" text');

    expect(code).toContain('ALTER TABLE "storefront_order"');
    expect(code).toContain('ALTER TABLE "print_order"');
    expect(code).toContain(
      '"coupon_discount_cents" integer NOT NULL DEFAULT 0'
    );
  });

  it("**不**重算历史订单的金额 —— 只加列", () => {
    const code = stripComments(script);

    // 脚本只做 CREATE TABLE / ALTER TABLE —— 没有 UPDATE
    expect(code).not.toMatch(/\bUPDATE\b/i);
    expect(code).not.toMatch(/\bDELETE FROM\b/i);
  });

  it("跑完会回读验证两条恒等式", () => {
    const code = stripComments(script);

    expect(code).toContain("storefront_mismatch");
    expect(code).toContain("print_mismatch");
  });

  it("`package.json` 里有一条 `migrate:apply-coupon`", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["migrate:apply-coupon"]).toBe(
      "tsx scripts/apply-coupon-schema.ts"
    );
  });
});

/* -------------------------------------------------------------------------- */
/*  「use server」的规矩                                                       */
/* -------------------------------------------------------------------------- */

describe("优惠码后台 —— 「use server」文件只导出 async 函数", () => {
  const actions = stripComments(read(ADMIN_ACTIONS));

  it("没有类型 re-export", () => {
    // 类型 re-export 会被 Turbopack 注册成 server action →
    // 运行时引用一个不存在的类型绑定 → ReferenceError → 整个页面 500
    expect(actions).not.toMatch(/export\s+type\s*\{/);
    expect(actions).not.toMatch(/export\s*\{[^}]*\btype\s+[A-Za-z_$]/);
    expect(actions).not.toMatch(/export\s*\*\s*from/);
  });

  it("类型住在纯类型模块里", () => {
    const types = read(ADMIN_TYPES);
    expect(types).toContain("export type AdminCoupon");
    expect(types).toContain("export type AdminCouponErrorCode");
    expect(types).toContain("export type AdminCouponWriteResult");
  });
});

/* -------------------------------------------------------------------------- */
/*  i18n                                                                       */
/* -------------------------------------------------------------------------- */

describe("优惠码后台 —— 中英文键一样", () => {
  it("`AdminCoupons` 的键集完全一致", () => {
    const zh = leafKeys(messages("zh").AdminCoupons).sort();
    const en = leafKeys(messages("en").AdminCoupons).sort();

    expect(zh.length).toBeGreaterThan(50);
    expect(en).toEqual(zh);
  });

  it("`PrintQuote.coupon` 的键集完全一致", () => {
    const zh = messages("zh").PrintQuote as Record<string, unknown>;
    const en = messages("en").PrintQuote as Record<string, unknown>;

    expect(leafKeys(zh.coupon).sort()).toEqual(leafKeys(en.coupon).sort());
  });

  it("侧边栏那一项两种语言都有", () => {
    const zh = messages("zh").AdminSidebar as Record<string, unknown>;
    const en = messages("en").AdminSidebar as Record<string, unknown>;

    expect((zh.nav as Record<string, string>).coupons).toBeTruthy();
    expect((en.nav as Record<string, string>).coupons).toBeTruthy();
  });
});

describe("优惠码后台 —— 每个错误码都摆得上话", () => {
  it("后台写操作的五个错误码,中英文都有", () => {
    const zh = messages("zh").AdminCoupons as Record<string, unknown>;
    const en = messages("en").AdminCoupons as Record<string, unknown>;
    const zhErrors = zh.errors as Record<string, string>;
    const enErrors = en.errors as Record<string, string>;

    for (const code of ADMIN_ERROR_CODES) {
      expect(zhErrors[code], `zh ${code}`).toBeTruthy();
      expect(enErrors[code], `en ${code}`).toBeTruthy();
    }
  });

  it("优惠码本身的十个错误码,中英文都有", () => {
    const zh = messages("zh").PrintQuote as Record<string, unknown>;
    const en = messages("en").PrintQuote as Record<string, unknown>;
    const zhErrors = (zh.coupon as Record<string, unknown>).errors as Record<
      string,
      string
    >;
    const enErrors = (en.coupon as Record<string, unknown>).errors as Record<
      string,
      string
    >;

    for (const code of COUPON_ERROR_CODES) {
      expect(zhErrors[code], `zh ${code}`).toBeTruthy();
      expect(enErrors[code], `en ${code}`).toBeTruthy();
    }
  });
});
