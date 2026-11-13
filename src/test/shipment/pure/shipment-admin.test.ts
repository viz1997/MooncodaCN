import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 后台「发货台」`/admin/shipments`(2026-11-13)
 *
 * ## 为什么这一层值得单测
 *
 * 发货台是**唯一**能让工作室寄出去东西的地方 —— 填错一个运单号,买家那边
 * 显示的就是错的;快递公司清单里少一家,工作室当场没法发货。
 *
 * 这里钉住四类不变式:
 *
 * 1. **路由跟侧边栏登记** —— 页面上线了但菜单里没有入口 = 白做
 * 2. **就地展开,不开弹窗** —— 工作室的口味(配置界面在页面上直接处理,
 *    不要弹窗挡住别的内容)。弹窗一开,工作室看不见这一行还缺什么
 * 3. **action 不 throw** —— throw 会被 next-safe-action 糊成「服务器错误」,
 *    工作室根本不知道是哪儿错了(订单不在?状态不让改?表还没建?)
 * 4. **迁移脚本不播种** —— 跑完线上行为一个字节都不变
 *
 * 纯文件扫描 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 读一份语言包(仓库惯例:读文件 + JSON.parse,不在测试里 import JSON) */
function messages(locale: "zh" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
}

/** 把注释去掉 —— 注释里**提到**那个名字不算违规(那儿恰恰要解释区别) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/**
 * 把脚本里所有 `query:` 后面的 SQL 摘出来
 *
 * **只查这些,不查整个文件** —— 脚本里的 `label: "CREATE TABLE shipment"` 是
 * 给人看的描述(不是 SQL),拿它来判「幂等」会误报。
 */
function sqlBlocks(src: string): string[] {
  const out: string[] = [];
  const re = /query:\s*`([\s\S]*?)`/g;
  let match = re.exec(src);
  while (match) {
    const body = match[1];
    if (body !== undefined) out.push(body);
    match = re.exec(src);
  }
  return out;
}

/** 把对象摊平成 `a.b.c` 这样的点分键 —— 比对中英文键集用 */
function flatten(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object") return [prefix];
  if (Array.isArray(obj)) return [prefix];
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flatten(value, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

const PAGE = "src/app/[locale]/(admin)/admin/shipments/page.tsx";
const VIEW = "src/features/shipment/admin/components/shipments-admin-view.tsx";
const PANEL =
  "src/features/shipment/admin/components/shipment-expand-panel.tsx";
const ACTIONS = "src/features/shipment/admin/actions.ts";
const TYPES = "src/features/shipment/admin/types.ts";
const MIGRATION = "scripts/apply-shipment-schema.ts";
const SCHEMA = "src/db/schema.ts";
const NAV = "src/config/nav.ts";
const SIDEBAR = "src/features/admin/components/admin-sidebar.tsx";

/** 七个错误码 —— 跟 `features/shipment/lib/types.ts` 的 `ShipmentErrorCode` 一致 */
const ERROR_CODES = [
  "ORDER_NOT_FOUND",
  "SHIPMENT_NOT_FOUND",
  "INVALID_TRANSITION",
  "NOTE_REQUIRED",
  "INVALID_INPUT",
  "MIGRATION_MISSING",
  "SAVE_FAILED",
] as const;

describe("发货台:路由跟侧边栏", () => {
  it("路由在 /admin/shipments,RSC 只渲染视图", () => {
    const src = read(PAGE);
    expect(src).toContain("ShipmentsAdminView");
    // RBAC 由父 layout 的 checkAdmin() 守 —— 页面不重复检查
    // (注释里**提到**它不算违规 —— 去掉注释再查)
    expect(stripComments(src)).not.toContain("checkAdmin");
  });

  it("侧边栏登记了这一项", () => {
    expect(read(NAV)).toContain('href: "/admin/shipments"');
    // 侧边栏标题映射
    expect(read(SIDEBAR)).toContain('t("nav.shipments")');
  });

  it("两个语言都有侧边栏标题", () => {
    for (const locale of ["zh", "en"] as const) {
      const nav = messages(locale).AdminSidebar as Record<string, unknown>;
      expect(typeof nav.nav).toBe("object");
      const inner = nav.nav as Record<string, unknown>;
      expect(typeof inner.shipments).toBe("string");
      expect(String(inner.shipments).length).toBeGreaterThan(0);
    }
  });
});

describe("发货台:就地展开,不开弹窗", () => {
  it("视图和展开面板里没有弹窗", () => {
    for (const rel of [VIEW, PANEL]) {
      const src = stripComments(read(rel));
      expect(src).not.toMatch(/<Modal\b/);
      expect(src).not.toMatch(/<Dialog\b/);
      expect(src).not.toMatch(/\bModal\./);
      expect(src).not.toMatch(/\bDrawer\./);
    }
  });

  it("展开区是用 antd 的 expandedRowRender 做的(就地在表格行下面)", () => {
    const src = read(VIEW);
    expect(src).toContain("expandedRowRender");
    expect(src).toContain("ShipmentExpandPanel");
  });
});

describe("发货台:action 不 throw,也不 re-export 类型", () => {
  it("action 里没有 throw", () => {
    const src = stripComments(read(ACTIONS));
    expect(src).not.toMatch(/\bthrow\b/);
  });

  it("失败一律走 `{ ok: false, code }`", () => {
    const src = read(ACTIONS);
    expect(src).toContain("ok: false");
    expect(src).toContain("code:");
  });

  it('`"use server"` 文件不 re-export 类型', () => {
    const src = read(ACTIONS);
    expect(src.trimStart().startsWith('"use server"')).toBe(true);
    // Turbopack 会把类型 re-export 注册成 server action ⇒ 运行时 ReferenceError
    expect(src).not.toMatch(/export\s+type\s*\{/);
    expect(src).not.toMatch(/export\s+type\s+\w+\s*=/);
  });

  it("视图模型和错误码住在单独的类型文件里", () => {
    const src = read(TYPES);
    expect(src).toContain("SHIPMENT_ERROR_TEXT_KEYS");
    expect(src).toContain("AdminShipmentErrorCode");
  });

  it("每个错误码都能查到文案(键是命名空间相对的)", () => {
    const src = read(TYPES);
    for (const code of ERROR_CODES) {
      expect(src).toContain(`${code}: "errors.${code}"`);
    }
  });
});

describe("发货台:下拉选项跟服务端校验是同一份状态机", () => {
  it("展开面板用 allowedNextShipmentStatuses 造下拉选项", () => {
    const src = read(PANEL);
    expect(src).toContain("allowedNextShipmentStatuses");
    expect(src).toContain("shipmentStatusLabelKey");
  });

  it("action 的目标状态用 SHIPMENT_STATUSES 枚举(不是手写的字面量)", () => {
    const src = read(ACTIONS);
    expect(src).toContain("SHIPMENT_STATUSES");
    expect(src).not.toMatch(/z\.enum\(\[\s*"shipped"/);
  });

  it("备注必填的那条由状态机说了算", () => {
    const src = read(PANEL);
    expect(src).toContain("shipmentTransitionRequiresNote");
  });
});

describe("发货台:写完要刷买家侧那一页", () => {
  it("商城和工单两条路径都刷了", () => {
    const src = read(ACTIONS);
    expect(src).toContain('revalidatePath("/[locale]/account/orders", "page")');
    expect(src).toContain(
      'revalidatePath("/[locale]/account/print-orders", "page")'
    );
  });

  it("后台自己那一页也刷了", () => {
    const src = read(ACTIONS);
    expect(src).toContain('revalidatePath(REVALIDATE_PATH, "page")');
  });
});

describe("迁移脚本:只建表,不播种,不改订单表", () => {
  const src = stripComments(read(MIGRATION));

  it("不播种任何一行", () => {
    expect(src).not.toMatch(/INSERT\s+INTO/i);
  });

  it("不碰已有的订单表(一行历史订单都不动)", () => {
    expect(src).not.toMatch(/ALTER\s+TABLE\s+"?storefront_order/i);
    expect(src).not.toMatch(/ALTER\s+TABLE\s+"?print_order/i);
    expect(src).not.toMatch(/UPDATE\s+"?storefront_order/i);
    expect(src).not.toMatch(/UPDATE\s+"?print_order/i);
  });

  it("有 --dry-run", () => {
    expect(src).toContain("--dry-run");
  });

  it("建了那张表跟时间线表", () => {
    expect(src).toContain('CREATE TABLE IF NOT EXISTS "shipment"');
    expect(src).toContain('CREATE TABLE IF NOT EXISTS "shipment_event"');
  });

  it("同一个订单同一个包裹下标只有一个(唯一索引)", () => {
    expect(src).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "shipment_order_package_uq"'
    );
    expect(src).toMatch(
      /"shipment_order_package_uq"[\s\S]{0,120}\("order_kind",\s*"order_id",\s*"package_index"\)/
    );
  });

  it("幂等(CREATE ... IF NOT EXISTS)", () => {
    // 只看真正的 SQL —— `label:` 那种是给人看的描述,不是语句
    const sql = sqlBlocks(src).join("\n");
    expect(sql).not.toMatch(/CREATE\s+(TABLE|INDEX)\s+(?!IF\s+NOT\s+EXISTS)/i);
    expect(sql).not.toMatch(/CREATE\s+UNIQUE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/i);
  });

  it("package.json 登记了迁移命令", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["migrate:apply-shipment"]).toContain(
      "scripts/apply-shipment-schema.ts"
    );
  });
});

describe("schema:两张表跟索引", () => {
  const src = read(SCHEMA);

  it("shipment 表挂两种订单(不带外键)", () => {
    // 表名可能被 Biome 换行到下一行 ⇒ 用正则,不用 toContain
    expect(src).toMatch(/pgTable\(\s*"shipment"/);
    expect(src).toMatch(/pgTable\(\s*"shipment_event"/);
  });

  it("order_kind / order_id / package_index 都在", () => {
    expect(src).toMatch(/orderKind:\s*text\("order_kind"/);
    expect(src).toMatch(/orderId:\s*text\("order_id"\)/);
    expect(src).toMatch(/packageIndex:\s*integer\("package_index"\)/);
  });

  it("唯一索引是 (order_kind, order_id, package_index)", () => {
    expect(src).toMatch(
      /uniqueIndex\("shipment_order_package_uq"\)\.on\(\s*t\.orderKind,\s*t\.orderId,\s*t\.packageIndex/
    );
  });

  it("物流状态是小写那套(不是 print_order 的大写 SHIPPED)", () => {
    expect(src).toMatch(
      /status:\s*text\("status",\s*\{\s*enum:\s*\[\s*"shipped",\s*"delivered",\s*"returned"\]/
    );
  });
});

describe("i18n:中英文键集完全一致", () => {
  for (const ns of ["Shipment", "AdminShipment", "StorefrontOrder"]) {
    it(`${ns} 命名空间键集一致`, () => {
      const zh = flatten(messages("zh")[ns]).sort();
      const en = flatten(messages("en")[ns]).sort();
      expect(en).toEqual(zh);
    });
  }

  it("每个错误码两种语言都摆得上话", () => {
    for (const locale of ["zh", "en"] as const) {
      const ns = messages(locale).AdminShipment as Record<string, unknown>;
      const errors = ns.errors as Record<string, string>;
      for (const code of ERROR_CODES) {
        expect(typeof errors[code]).toBe("string");
        expect(String(errors[code]).length).toBeGreaterThan(0);
      }
    }
  });

  it("快递公司清单每个 code 两种语言都有名字", () => {
    const carriers = [
      "sf",
      "jd",
      "zto",
      "yto",
      "sto",
      "yunda",
      "ems",
      "post",
      "jtsd",
      "deppon",
      "other",
    ] as const;
    for (const locale of ["zh", "en"] as const) {
      const ns = messages(locale).Shipment as Record<string, unknown>;
      const carrierNs = ns.carriers as Record<string, string>;
      for (const code of carriers) {
        expect(typeof carrierNs[code]).toBe("string");
        expect(String(carrierNs[code]).length).toBeGreaterThan(0);
      }
    }
  });

  it("物流状态的文案两种语言都有(三个状态)", () => {
    for (const locale of ["zh", "en"] as const) {
      const ns = messages(locale).Shipment as Record<string, unknown>;
      const status = ns.status as Record<string, string>;
      for (const key of ["shipped", "delivered", "returned"]) {
        expect(typeof status[key]).toBe("string");
      }
    }
  });
});
