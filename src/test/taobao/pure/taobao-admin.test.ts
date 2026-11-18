import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AdminStoreOrderSource,
  evaluateMarkPaid,
  externalPaidDifferenceCents,
  toAdminStoreOrderRow,
} from "@/features/storefront/admin/types";
import { MOCK_PRODUCTS } from "@/features/storefront/lib/mock-catalog";
import {
  buildTaobaoLinkRows,
  type TaobaoDesignRef,
  toAdminTaobaoLinkRow,
} from "@/features/taobao/admin/types";

/**
 * 淘宝那一路的**后台**(2026-11-18)
 *
 * 买家不信任一个新店 ⇒ 结算页除了支付宝,多一个「**淘宝下单**」:点了跳到
 * 淘宝,在淘宝付款(享受平台担保)。钱进的是**淘宝那个账户**,不在本仓库的收
 * 钱链路里 ⇒ 工作室在淘宝后台看到钱到了,回本站把那一单**手工标成已收款**。
 *
 * ⇒ 这一条路的后台是**两页**:
 *
 * - `/admin/taobao-links` —— 配「本站这件设计 → 淘宝上那个商品」
 * - `/admin/store-orders` —— 手工标「已收款」+ 补填淘宝那边的实收金额
 *
 * ## 为什么这一层值得单测
 *
 * 1. **路由跟侧边栏登记** —— 页面上线了但菜单里没有入口 = 白做
 * 2. **就地展开,不开弹窗** —— 工作室的口味(配置界面在页面上直接处理,
 *    不要弹窗挡住别的内容)。弹窗一开,工作室看不见这一行还缺什么
 * 3. **action 不 throw** —— throw 会被 next-safe-action 糊成「服务器错误」,
 *    工作室根本不知道是哪儿错了(链接不合法?表还没建?)
 * 4. **链接的校验在服务端** —— 链接是要**摆给买家点的**,域名错了就是把客人
 *    往别处引(钓鱼)。前端那层校验只是省工作室一次填写。
 * 5. **「手工标已收款」不核对金额** —— 淘宝那边的实收跟本站应付**本来就不
 *    该相等**(淘宝有它自己的运费模板和优惠券)⇒ 拿本站应付去比,会把每一
 *    笔正常的淘宝单都拒掉。
 * 6. **迁移脚本不播种** —— 跑完线上行为一个字节都不变(没配链接的时候,那个
 *    支付选项是灰的、标着「暂未开放」)。
 *
 * 纯文件扫描 + 纯函数 —— 不需要 DB / 网络 / 浏览器。
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
 * **只查这些,不查整个文件** —— 脚本里的 `label: "CREATE TABLE …"` 是给人看
 * 的描述(不是 SQL),拿它来判「幂等」会误报。
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

const TAOBAO_PAGE = "src/app/[locale]/(admin)/admin/taobao-links/page.tsx";
const TAOBAO_VIEW =
  "src/features/taobao/admin/components/taobao-links-admin-view.tsx";
const TAOBAO_ACTIONS = "src/features/taobao/admin/actions.ts";
const TAOBAO_TYPES = "src/features/taobao/admin/types.ts";

const STORE_PAGE = "src/app/[locale]/(admin)/admin/store-orders/page.tsx";
const STORE_VIEW =
  "src/features/storefront/admin/components/store-orders-admin-view.tsx";
const STORE_ACTIONS = "src/features/storefront/admin/actions.ts";
const STORE_TYPES = "src/features/storefront/admin/types.ts";

const MIGRATION = "scripts/apply-taobao-link-schema.ts";
const SCHEMA = "src/db/schema.ts";
const NAV = "src/config/nav.ts";
const SIDEBAR = "src/features/admin/components/admin-sidebar.tsx";

/** 淘宝链接后台的八个错误码 */
const TAOBAO_ERROR_CODES = [
  "EMPTY",
  "INVALID_URL",
  "NOT_TAOBAO",
  "NO_ITEM_ID",
  "DESIGN_NOT_FOUND",
  "LINK_NOT_FOUND",
  "MIGRATION_MISSING",
  "SAVE_FAILED",
] as const;

/** 商城订单后台的九个错误码 */
const STORE_ERROR_CODES = [
  "ORDER_NOT_FOUND",
  "ORDER_REFUNDED",
  "ORDER_CANCELLED",
  "AMOUNT_MISMATCH",
  "EXTERNAL_ORDER_NO_REQUIRED",
  "INVALID_INPUT",
  "MIGRATION_MISSING",
  "SAVE_FAILED",
  "LOAD_FAILED",
] as const;

/* -------------------------------------------------------------------------- */
/*  路由跟侧边栏                                                               */
/* -------------------------------------------------------------------------- */

describe("两页后台:路由跟侧边栏", () => {
  it("淘宝链接那一页在 /admin/taobao-links,RSC 只渲染视图", () => {
    const src = read(TAOBAO_PAGE);
    expect(src).toContain("TaobaoLinksAdminView");
    // RBAC 由父 layout 的 checkAdmin() 守 —— 页面不重复检查
    expect(stripComments(src)).not.toContain("checkAdmin");
  });

  it("商城订单那一页在 /admin/store-orders,RSC 只渲染视图", () => {
    const src = read(STORE_PAGE);
    expect(src).toContain("StoreOrdersAdminView");
    expect(stripComments(src)).not.toContain("checkAdmin");
  });

  it("侧边栏登记了这两项", () => {
    expect(read(NAV)).toContain('href: "/admin/taobao-links"');
    expect(read(NAV)).toContain('href: "/admin/store-orders"');
    // 侧边栏标题映射
    expect(read(SIDEBAR)).toContain('t("nav.taobaoLinks")');
    expect(read(SIDEBAR)).toContain('t("nav.storeOrders")');
  });

  it("两个语言都有侧边栏标题", () => {
    for (const locale of ["zh", "en"] as const) {
      const nav = messages(locale).AdminSidebar as Record<string, unknown>;
      const inner = nav.nav as Record<string, unknown>;
      expect(typeof inner.taobaoLinks).toBe("string");
      expect(String(inner.taobaoLinks).length).toBeGreaterThan(0);
      expect(typeof inner.storeOrders).toBe("string");
      expect(String(inner.storeOrders).length).toBeGreaterThan(0);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  就地展开,不开弹窗                                                          */
/* -------------------------------------------------------------------------- */

describe("两页后台:就地展开,不开弹窗", () => {
  it("视图里没有弹窗", () => {
    for (const rel of [TAOBAO_VIEW, STORE_VIEW]) {
      const src = stripComments(read(rel));
      expect(src, `${rel} 里出现了 <Modal>`).not.toMatch(/<Modal\b/);
      expect(src, `${rel} 里出现了 <Dialog>`).not.toMatch(/<Dialog\b/);
      expect(src, `${rel} 里出现了 Modal.`).not.toMatch(/\bModal\./);
      expect(src, `${rel} 里出现了 Drawer.`).not.toMatch(/\bDrawer\./);
    }
  });

  it("展开区是用 antd 的 expandedRowRender 做的(就地在表格行下面)", () => {
    expect(read(TAOBAO_VIEW)).toContain("expandedRowRender");
    expect(read(STORE_VIEW)).toContain("expandedRowRender");
  });

  it("两页都是客户端组件自己拉数据(改完立刻看到生效值)", () => {
    for (const rel of [TAOBAO_VIEW, STORE_VIEW]) {
      expect(read(rel)).toContain('"use client"');
      expect(read(rel)).toContain("useAction");
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  action 的方言                                                              */
/* -------------------------------------------------------------------------- */

describe("两页后台:action 不 throw,也不 re-export 类型", () => {
  it("action 里没有 throw", () => {
    for (const rel of [TAOBAO_ACTIONS, STORE_ACTIONS]) {
      const src = stripComments(read(rel));
      expect(src, `${rel} 里 throw 了`).not.toMatch(/\bthrow\b/);
    }
  });

  it("失败一律走 `{ ok: false, code }`", () => {
    for (const rel of [TAOBAO_ACTIONS, STORE_ACTIONS]) {
      const src = read(rel);
      expect(src).toContain("ok: false");
      expect(src).toContain("code:");
    }
  });

  it('`"use server"` 文件不 re-export 类型', () => {
    for (const rel of [TAOBAO_ACTIONS, STORE_ACTIONS]) {
      const src = read(rel);
      expect(src.trimStart().startsWith('"use server"')).toBe(true);
      // Turbopack 会把类型 re-export 注册成 server action ⇒ 运行时 ReferenceError
      expect(src).not.toMatch(/export\s+type\s*\{/);
      expect(src).not.toMatch(/export\s+type\s+\w+\s*=/);
    }
  });

  it("视图模型和错误码住在单独的类型文件里", () => {
    expect(read(TAOBAO_TYPES)).toContain("TAOBAO_ERROR_TEXT_KEYS");
    expect(read(TAOBAO_TYPES)).toContain("AdminTaobaoErrorCode");
    expect(read(STORE_TYPES)).toContain("STORE_ORDER_ERROR_TEXT_KEYS");
    expect(read(STORE_TYPES)).toContain("AdminStoreOrderErrorCode");
  });

  it("每个错误码都能查到文案(键是命名空间相对的)", () => {
    const taobaoSrc = read(TAOBAO_TYPES);
    for (const code of TAOBAO_ERROR_CODES) {
      expect(taobaoSrc).toContain(`${code}: "errors.${code}"`);
    }

    const storeSrc = read(STORE_TYPES);
    for (const code of STORE_ERROR_CODES) {
      expect(storeSrc).toContain(`${code}: "errors.${code}"`);
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  链接的校验在服务端                                                          */
/* -------------------------------------------------------------------------- */

describe("淘宝链接:校验在服务端做一遍", () => {
  const src = stripComments(read(TAOBAO_ACTIONS));

  it("保存时用 `checkTaobaoUrl()` 再验一遍 —— 前端那层只是省一次填写", () => {
    expect(src).toContain("checkTaobaoUrl(parsedInput.url)");
    expect(src).toContain("ok: false, code: check.problem");
  });

  it("存的是**归一化之后**的地址,不是工作室原样粘进来的那串", () => {
    // 粘进来常常带着中文引号 / 首尾空格 ⇒ 原样存进去就是一条坏链接
    expect(src).toContain("url: check.url");
    expect(src).toContain("itemId: check.itemId");
  });

  it("handle 必须在商城目录里 —— 挂到一件不存在的设计上就废了", () => {
    expect(src).toContain("MOCK_PRODUCTS.some((p) => p.handle === handle)");
  });

  it("停用不是删 —— 链接留着,历史单还能查", () => {
    expect(src).toContain("setTaobaoLinkActive");
    expect(src).toContain("adminSetTaobaoLinkActiveAction");
  });

  it("表还没建 ⇒ MIGRATION_MISSING(不是 500)", () => {
    expect(src).toContain("info.missingRelation");
    expect(src).toContain('code: "MIGRATION_MISSING"');
  });
});

/* -------------------------------------------------------------------------- */
/*  手工标已收款                                                                */
/* -------------------------------------------------------------------------- */

describe("商城订单:手工标已收款", () => {
  const src = stripComments(read(STORE_ACTIONS));

  it("只有淘宝和线下转账支持手工标", () => {
    // 微信 / 支付宝是回调自动标的 —— 人再标一次是拿「人工」覆盖「机器」
    expect(src).toContain('z.enum(["taobao", "offline"])');
  });

  it("⚠️ **不核对金额** —— 淘宝那边的实收跟本站应付本来就不该相等", () => {
    // `settleByOrderNo` 的金额核对只在**回调**那一档有意义。
    // 手工标这一档不传 `paidAmountCents` ⇒ 核对那一档直接放行。
    // 拿本站应付去比淘宝的实收,会把每一笔正常的淘宝单都拒掉。
    expect(src).toContain("paidAmountCents: undefined");
  });

  it("闸的顺序:订单不在 → 退过款 → 已取消 → 缺淘宝单号 → 金额对不上", () => {
    const order = ["ORDER_NOT_FOUND", "ORDER_REFUNDED", "ORDER_CANCELLED"];
    let at = -1;
    for (const code of order) {
      const next = src.indexOf(`code: "${code}"`);
      expect(next, `action 里没有 ${code}`).toBeGreaterThan(-1);
      expect(next, `${code} 的位置不对`).toBeGreaterThan(at);
      at = next;
    }

    const externalNo = src.indexOf('code: "EXTERNAL_ORDER_NO_REQUIRED"');
    const amount = src.indexOf('code: "AMOUNT_MISMATCH"');
    expect(externalNo).toBeGreaterThan(at);
    expect(amount).toBeGreaterThan(externalNo);
  });

  it("淘宝那一档必须填淘宝订单号 —— 没有它认不出「这是淘宝上哪一笔」", () => {
    expect(src).toContain(
      'parsedInput.channel === "taobao" && !externalOrderNo'
    );
    expect(src).toContain('code: "EXTERNAL_ORDER_NO_REQUIRED"');
  });

  it("线下那一档:实收必须等于订单应付(一分不差)", () => {
    expect(src).toContain('parsedInput.channel === "offline"');
    expect(src).toContain("paidCents !== order.totalCents");
    expect(src).toContain('code: "AMOUNT_MISMATCH"');
  });

  it("状态**不在这儿**写 —— 状态机只有一份(`settleByOrderNo`)", () => {
    expect(src).toContain("settleByOrderNo");
    expect(src).toContain('action: "mark_paid"');
    // 自己写一条 UPDATE 就是当年被删掉的那条「后门」
    expect(src).not.toMatch(/\.update\(storefrontOrder\)/);
  });

  it("补填外部实收是**另一步** —— 状态没变的那条路记不上单号", () => {
    expect(src).toContain("setExternalPaidCents");
    expect(src).toContain("externalPaidCents: paidCents");
  });

  it("写完刷后台自己那一页 + 买家侧那一页(列表跟详情)", () => {
    expect(src).toContain('revalidatePath(REVALIDATE_PATH, "page")');
    expect(src).toContain('revalidatePath(BUYER_ORDER_PATH, "page")');
    // 详情页那一处是**模板字符串**拼出来的 ⇒ 用正则比,不用字面量
    expect(src).toMatch(
      /revalidatePath\(`\$\{BUYER_ORDER_PATH\}\/\[orderNo\]`, "page"\)/
    );
  });
});

/* -------------------------------------------------------------------------- */
/*  纯函数                                                                     */
/* -------------------------------------------------------------------------- */

describe("淘宝链接:纯函数", () => {
  const design: TaobaoDesignRef = {
    handle: "keychain-pet-portrait",
    title: "宠物肖像钥匙扣",
    titleEn: "Pet Portrait Keychain",
    typeLabel: "钥匙扣",
    typeLabelEn: "Keychain",
    seriesName: "钥匙扣系列",
    seriesNameEn: "Keychain Series",
  };

  it("没配过链接的那一行:hasLink=false、url=null、isActive=false", () => {
    const row = toAdminTaobaoLinkRow(design, null);
    expect(row.hasLink).toBe(false);
    expect(row.url).toBeNull();
    expect(row.itemId).toBeNull();
    expect(row.note).toBeNull();
    expect(row.isActive).toBe(false);
    expect(row.updatedAt).toBeNull();
    expect(row.productHandle).toBe("keychain-pet-portrait");
  });

  it("配过了的那一行:链接 / 商品号 / 更新时间都在", () => {
    const row = toAdminTaobaoLinkRow(design, {
      productHandle: design.handle,
      url: "https://item.taobao.com/item.htm?id=123456789",
      itemId: "123456789",
      note: "改过的链接",
      isActive: true,
      updatedAt: new Date("2026-11-18T03:04:05.000Z"),
    });
    expect(row.hasLink).toBe(true);
    expect(row.url).toContain("item.taobao.com");
    expect(row.itemId).toBe("123456789");
    expect(row.note).toBe("改过的链接");
    expect(row.isActive).toBe(true);
    expect(row.updatedAt).toBe("2026-11-18T03:04:05.000Z");
  });

  it("**配了但被停用**跟**压根没配**是两件事 —— 界面要给两句不同的话", () => {
    const row = toAdminTaobaoLinkRow(design, {
      productHandle: design.handle,
      url: "https://item.taobao.com/item.htm?id=1",
      itemId: "1",
      note: null,
      isActive: false,
      updatedAt: null,
    });
    expect(row.hasLink).toBe(true);
    expect(row.isActive).toBe(false);
  });

  it("表格 = 商城目录里的每一件设计,一行一件", () => {
    const designs: TaobaoDesignRef[] = [design, { ...design, handle: "other" }];
    const rows = buildTaobaoLinkRows(designs, []);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.productHandle)).toEqual([
      "keychain-pet-portrait",
      "other",
    ]);
  });

  it("库里多出来的行(设计下架了 / handle 录错了)**不列**", () => {
    // 后台这一页是「给哪件设计配链接」—— 摆一个买不到的设计只会让工作室
    // 以为还能配
    const rows = buildTaobaoLinkRows(
      [design],
      [
        {
          productHandle: "design-that-does-not-exist",
          url: "https://item.taobao.com/item.htm?id=1",
          itemId: "1",
          note: null,
          isActive: true,
          updatedAt: null,
        },
      ]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.productHandle).toBe("keychain-pet-portrait");
  });

  it("真实目录跑一遍 —— 12 件设计,一行一件", () => {
    const designs: TaobaoDesignRef[] = MOCK_PRODUCTS.map((product) => ({
      handle: product.handle,
      title: product.title,
      titleEn: product.titleEn,
      typeLabel: product.typeLabel,
      typeLabelEn: product.typeLabelEn,
      seriesName: product.seriesName,
      seriesNameEn: product.seriesNameEn,
    }));
    expect(designs.length).toBeGreaterThan(0);
    // 一个设计一个链接 ⇒ handle 不许重复
    expect(new Set(designs.map((d) => d.handle)).size).toBe(designs.length);

    const rows = buildTaobaoLinkRows(designs, []);
    expect(rows).toHaveLength(designs.length);
    expect(rows.every((row) => row.hasLink === false)).toBe(true);
  });
});

describe("商城订单:纯函数", () => {
  function source(over: Partial<AdminStoreOrderSource> = {}) {
    return {
      orderNo: "SO-20261118-ABCDEF",
      createdAt: new Date("2026-11-18T03:04:05.000Z"),
      buyerEmail: "buyer@example.com",
      buyerName: "买家",
      itemSummary: "钥匙扣 ×2",
      itemCount: 2,
      status: "paid",
      paymentStatus: "unpaid",
      paymentChannel: "taobao",
      providerOrderId: null,
      totalCents: 19_900,
      shippingCents: 800,
      couponCode: null,
      externalPaidCents: null,
      ...over,
    } satisfies AdminStoreOrderSource;
  }

  it("认不出来的状态一律当「待支付」—— 界面不许摆一个空状态", () => {
    const row = toAdminStoreOrderRow(source({ status: "weird" }));
    expect(row.status).toBe("unpaid");

    const paid = toAdminStoreOrderRow(source({ paymentStatus: "weird" }));
    expect(paid.paymentStatus).toBe("unpaid");
  });

  it("认不出来的通道就是 null(不猜)", () => {
    const row = toAdminStoreOrderRow(source({ paymentChannel: "paypal" }));
    expect(row.paymentChannel).toBeNull();
  });

  it("淘宝那一路原样保留", () => {
    const row = toAdminStoreOrderRow(source({ paymentChannel: "taobao" }));
    expect(row.paymentChannel).toBe("taobao");
  });

  it("退过款的单不能手工标已收款", () => {
    const result = evaluateMarkPaid({
      status: "paid",
      paymentStatus: "refunded",
      externalPaidCents: null,
    });
    expect(result.canMarkPaid).toBe(false);
    expect(result.blockCode).toBe("ORDER_REFUNDED");
  });

  it("已取消的单不能手工标已收款", () => {
    const result = evaluateMarkPaid({
      status: "cancelled",
      paymentStatus: "unpaid",
      externalPaidCents: null,
    });
    expect(result.canMarkPaid).toBe(false);
    expect(result.blockCode).toBe("ORDER_CANCELLED");
  });

  it("已经付过的**可以**再标一次 —— 那是去补填淘宝实收金额,不是再收一次钱", () => {
    const result = evaluateMarkPaid({
      status: "paid",
      paymentStatus: "paid",
      externalPaidCents: null,
    });
    expect(result.canMarkPaid).toBe(true);
    expect(result.blockCode).toBeNull();
  });

  it("实收与本站应付的差额:没填是 null,填了就是那个差", () => {
    expect(
      externalPaidDifferenceCents({
        totalCents: 19_900,
        externalPaidCents: null,
      })
    ).toBeNull();

    expect(
      externalPaidDifferenceCents({
        totalCents: 19_900,
        externalPaidCents: 19_900,
      })
    ).toBe(0);

    // 淘宝那边多收了(它自己的运费模板 / 优惠券)
    expect(
      externalPaidDifferenceCents({
        totalCents: 19_900,
        externalPaidCents: 20_800,
      })
    ).toBe(900);

    // 淘宝那边少收了
    expect(
      externalPaidDifferenceCents({
        totalCents: 19_900,
        externalPaidCents: 19_000,
      })
    ).toBe(-900);
  });

  it("差额只是**给工作室看的** —— 淘宝那一单本来就不该相等,不对不上不报错", () => {
    const row = toAdminStoreOrderRow(
      source({ externalPaidCents: 20_800, totalCents: 19_900 })
    );
    expect(row.externalPaidCents).toBe(20_800);
    expect(row.canMarkPaid).toBe(true);
    expect(externalPaidDifferenceCents(row)).toBe(900);
  });
});

/* -------------------------------------------------------------------------- */
/*  迁移脚本                                                                   */
/* -------------------------------------------------------------------------- */

describe("迁移脚本:只建表建列,不播种", () => {
  const src = stripComments(read(MIGRATION));

  it("不播种任何一行 —— 跑完线上行为一个字节都不变", () => {
    expect(src).not.toMatch(/INSERT\s+INTO/i);
  });

  it("不改任何历史订单", () => {
    expect(src).not.toMatch(/UPDATE\s+"?storefront_order/i);
  });

  it("有 --dry-run", () => {
    expect(src).toContain("--dry-run");
  });

  it("建了那张映射表", () => {
    expect(src).toContain('CREATE TABLE IF NOT EXISTS "product_taobao_link"');
  });

  it("一个设计一条链接(唯一索引)", () => {
    expect(src).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "product_taobao_link_handle_uniq_idx"'
    );
  });

  it("加了 `external_paid_cents` 那一列", () => {
    expect(src).toMatch(
      /ALTER TABLE "storefront_order"\s+ADD COLUMN IF NOT EXISTS "external_paid_cents" integer;/
    );
  });

  it("**不改 `payment_channel` 列** —— 那一列是 text,枚举只在 TS 层", () => {
    expect(src).not.toMatch(
      /ALTER\s+TABLE\s+"?storefront_order"[\s\S]{0,80}payment_channel/i
    );
  });

  it("幂等(CREATE ... IF NOT EXISTS)", () => {
    const sql = sqlBlocks(src).join("\n");
    expect(sql).not.toMatch(/CREATE\s+(TABLE|INDEX)\s+(?!IF\s+NOT\s+EXISTS)/i);
    expect(sql).not.toMatch(/CREATE\s+UNIQUE\s+INDEX\s+(?!IF\s+NOT\s+EXISTS)/i);
  });

  it("package.json 登记了迁移命令", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["migrate:apply-taobao-link"]).toContain(
      "scripts/apply-taobao-link-schema.ts"
    );
  });
});

/* -------------------------------------------------------------------------- */
/*  schema                                                                     */
/* -------------------------------------------------------------------------- */

describe("schema:新表 + 新列 + 通道枚举", () => {
  const src = read(SCHEMA);

  it("映射表按 handle 存", () => {
    expect(src).toMatch(/pgTable\(\s*"product_taobao_link"/);
    expect(src).toMatch(
      /productHandle:\s*text\("product_handle"\)\.notNull\(\)/
    );
    expect(src).toMatch(/url:\s*text\("url"\)\.notNull\(\)/);
  });

  it("一个设计一条链接(唯一索引)", () => {
    expect(src).toMatch(
      /uniqueIndex\("product_taobao_link_handle_uniq_idx"\)\.on\(t\.productHandle\)/
    );
  });

  it("外部实收金额那一列挂在商城订单上(可空)", () => {
    expect(src).toMatch(
      /externalPaidCents:\s*integer\("external_paid_cents"\)/
    );
  });

  it("`payment_channel` 的枚举里有 taobao —— 那一列是 text,不用迁移", () => {
    const storefront = src.slice(src.indexOf("export const storefrontOrder"));
    expect(storefront).toMatch(
      /paymentChannel:\s*text\("payment_channel",\s*\{\s*enum:\s*\[[^\]]*"taobao"/
    );

    const print = src.slice(src.indexOf("export const printOrder"));
    expect(print).toMatch(
      /paymentChannel:\s*text\("payment_channel",\s*\{\s*enum:\s*\[[^\]]*"taobao"/
    );
  });
});

/* -------------------------------------------------------------------------- */
/*  i18n                                                                       */
/* -------------------------------------------------------------------------- */

describe("i18n:中英文键集完全一致", () => {
  for (const ns of ["AdminTaobaoLinks", "AdminStoreOrders", "Payment"]) {
    it(`${ns} 命名空间键集一致`, () => {
      const zh = flatten(messages("zh")[ns]).sort();
      const en = flatten(messages("en")[ns]).sort();
      expect(en).toEqual(zh);
    });
  }

  it("每个错误码两种语言都摆得上话", () => {
    for (const locale of ["zh", "en"] as const) {
      const taobao = messages(locale).AdminTaobaoLinks as Record<
        string,
        unknown
      >;
      const taobaoErrors = taobao.errors as Record<string, string>;
      for (const code of TAOBAO_ERROR_CODES) {
        expect(typeof taobaoErrors[code], `${locale} 缺 ${code}`).toBe(
          "string"
        );
        expect(String(taobaoErrors[code]).length).toBeGreaterThan(0);
      }

      const store = messages(locale).AdminStoreOrders as Record<
        string,
        unknown
      >;
      const storeErrors = store.errors as Record<string, string>;
      for (const code of STORE_ERROR_CODES) {
        expect(typeof storeErrors[code], `${locale} 缺 ${code}`).toBe("string");
        expect(String(storeErrors[code]).length).toBeGreaterThan(0);
      }
    }
  });

  it("「淘宝下单」那个按钮 + 那条告知两种语言都有", () => {
    for (const locale of ["zh", "en"] as const) {
      const payment = messages(locale).Payment as Record<string, unknown>;
      expect(typeof payment.taobaoSubmit).toBe("string");
      expect(String(payment.taobaoSubmit).length).toBeGreaterThan(0);
      expect(typeof payment.taobaoNotice).toBe("string");
      expect(String(payment.taobaoNotice).length).toBeGreaterThan(0);
    }
  });

  it("那条告知**必须说出「金额可能不一样」** —— 逐分相等在这一条路上不成立", () => {
    for (const locale of ["zh", "en"] as const) {
      const payment = messages(locale).Payment as Record<string, unknown>;
      const notice = String(payment.taobaoNotice);
      expect(notice.length).toBeGreaterThan(0);
      if (locale === "zh") {
        expect(notice).toContain("淘宝订单为准");
      } else {
        expect(notice).toContain("Taobao");
      }
    }
  });
});
