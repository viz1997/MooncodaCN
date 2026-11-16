import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildTawkEmbedUrl,
  isValidTawkId,
  normalizeTawkId,
  resolveTawkConfig,
  TAWK_DEFAULT_PROPERTY_ID,
  TAWK_DEFAULT_WIDGET_ID,
  TAWK_EMBED_BASE,
} from "@/features/tawk/lib/tawk-config";

/**
 * tawk.to 在线客服(2026-11-16)
 *
 * 工作室的要求:**「接入 https://developer.tawk.to/jsapi/ 在线客服功能」**。
 *
 * ## 为什么这件事值得单测
 *
 * tawk 的 embed 地址是 `https://embed.tawk.to/{propertyId}/{widgetId}` ——
 * **两个 ID 会被拼进一个 URL**。后台那两个框是自由输入 ⇒ 不严校验就是
 * 「后台可配的字段能变成任意地址」。
 *
 * 链路上另外三样容易出错的东西:
 *
 * 1. **回退链** —— DB 那一行 → 环境变量 → **内置默认** → 没配。跟站内其它
 *    设置一个口径:「DB 里存了空串」= **明确关掉**,不是「没配」。
 * 2. **两个 ID 是一个原子** —— 少一个就装不上(那是 tawk 那边硬性的)。
 * 3. **小窗永远是匿名的** —— 访客的姓名 / 邮箱**一律不发出去**(工作室
 *    2026-11-16 拍板)⇒ 这条不是「默认关」,是**代码里根本没有那条通路**。
 *
 * 纯函数 + 文件扫描 —— 不需要 DB / 网络 / 浏览器。
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

const CONFIG = "src/features/tawk/lib/tawk-config.ts";
const WIDGET = "src/features/tawk/components/tawk-widget.tsx";
const LAYOUT = "src/app/[locale]/(marketing-atelier)/layout.tsx";
const STORE = "src/features/site-settings/lib/site-setting-store.ts";
const PURE_SITE = "src/features/site-settings/lib/site-setting.ts";
const ACTIONS = "src/features/site-settings/admin/actions.ts";
const VIEW =
  "src/features/site-settings/admin/components/site-settings-admin-view.tsx";

describe("tawk:ID 的形状与校验", () => {
  it("归一化:只去首尾空格(大小写敏感 —— tawk 的 ID 改了就对不上)", () => {
    expect(normalizeTawkId("  5f9a8b7c6d  ")).toBe("5f9a8b7c6d");
    expect(normalizeTawkId("AbC")).toBe("AbC");
    expect(normalizeTawkId(null)).toBe("");
    expect(normalizeTawkId(undefined)).toBe("");
  });

  it("合法 ID:字母 / 数字 / 下划线 / 短横线", () => {
    expect(isValidTawkId("5f9a8b7c6d")).toBe(true);
    expect(isValidTawkId("1a2b3c")).toBe(true);
    expect(isValidTawkId("abc_def-123")).toBe(true);
  });

  it("不合法 ID 一律拒掉 —— 这两个 ID 会被拼进脚本地址", () => {
    // 路径穿越 / 换查询串 / 协议 —— 一个都不许
    expect(isValidTawkId("../../evil")).toBe(false);
    expect(isValidTawkId("abc?x=1")).toBe(false);
    expect(isValidTawkId("abc#frag")).toBe(false);
    expect(isValidTawkId("abc/def")).toBe(false);
    expect(isValidTawkId("javascript:alert(1)")).toBe(false);
    expect(isValidTawkId("abc def")).toBe(false);
    expect(isValidTawkId("")).toBe(false);
    expect(isValidTawkId(null)).toBe(false);
  });

  it("超长 ⇒ 拒掉", () => {
    expect(isValidTawkId("a".repeat(64))).toBe(true);
    expect(isValidTawkId("a".repeat(65))).toBe(false);
  });
});

describe("tawk:embed 地址", () => {
  it("两个 ID 凑成一条地址", () => {
    expect(buildTawkEmbedUrl("5f9a8b7c6d", "1a2b3c")).toBe(
      `${TAWK_EMBED_BASE}/5f9a8b7c6d/1a2b3c`
    );
    expect(buildTawkEmbedUrl("5f9a8b7c6d", "1a2b3c")).toBe(
      "https://embed.tawk.to/5f9a8b7c6d/1a2b3c"
    );
  });

  it("少一个 ⇒ **不装**(宁可不装,也不要装一个 404 的脚本地址)", () => {
    expect(buildTawkEmbedUrl("5f9a8b7c6d", "")).toBeNull();
    expect(buildTawkEmbedUrl("", "1a2b3c")).toBeNull();
    expect(buildTawkEmbedUrl(null, null)).toBeNull();
  });

  it("地址里**没有尾斜杠 / 查询串 / 片段** —— 官方 embed 就是这个形状", () => {
    const url = buildTawkEmbedUrl("5f9a8b7c6d", "1a2b3c");
    expect(url).not.toMatch(/\/$/);
    expect(url).not.toContain("?");
    expect(url).not.toContain("#");
  });
});

describe("tawk:生效值的回退链", () => {
  it("DB 里有 ⇒ 它说了算(哪怕环境变量也配着)", () => {
    const resolved = resolveTawkConfig({
      dbPropertyId: "dbpid",
      dbWidgetId: "dbwid",
      envPropertyId: "envpid",
      envWidgetId: "envwid",
    });
    expect(resolved.propertyId).toBe("dbpid");
    expect(resolved.widgetId).toBe("dbwid");
    expect(resolved.source).toBe("db");
    expect(resolved.configured).toBe(true);
    expect(resolved.embedUrl).toBe("https://embed.tawk.to/dbpid/dbwid");
  });

  it("DB 里存了**空串** ⇒ 明确关掉(不是「没配」)", () => {
    const resolved = resolveTawkConfig({
      dbPropertyId: "",
      dbWidgetId: "",
      envPropertyId: "envpid",
      envWidgetId: "envwid",
    });
    expect(resolved.propertyId).toBe("");
    expect(resolved.widgetId).toBe("");
    expect(resolved.source).toBe("db");
    expect(resolved.configured).toBe(false);
    // 「什么都没填」**不是**「贴错了」—— 别吓工作室
    expect(resolved.invalid).toBe(false);
  });

  it("DB 里没存过 ⇒ 看环境变量", () => {
    const resolved = resolveTawkConfig({
      dbPropertyId: null,
      dbWidgetId: null,
      envPropertyId: "envpid",
      envWidgetId: "envwid",
    });
    expect(resolved.propertyId).toBe("envpid");
    expect(resolved.widgetId).toBe("envwid");
    expect(resolved.source).toBe("env");
    expect(resolved.configured).toBe(true);
  });

  it("**逐个 ID** 回退 —— 只存了 property id,widget id 仍从环境变量来", () => {
    const resolved = resolveTawkConfig({
      dbPropertyId: "dbpid",
      dbWidgetId: null,
      envPropertyId: "envpid",
      envWidgetId: "envwid",
    });
    expect(resolved.propertyId).toBe("dbpid");
    expect(resolved.widgetId).toBe("envwid");
    expect(resolved.source).toBe("db");
    expect(resolved.configured).toBe(true);
  });

  it("哪儿都没配 ⇒ 没配(页面上没有客服小窗)", () => {
    const resolved = resolveTawkConfig({
      dbPropertyId: null,
      dbWidgetId: null,
      envPropertyId: "",
      envWidgetId: "",
    });
    expect(resolved.source).toBe("none");
    expect(resolved.configured).toBe(false);
    expect(resolved.invalid).toBe(false);
    expect(resolved.embedUrl).toBe("");
  });

  it("填了但不像 ID ⇒ 标成 **invalid**(后台要摆一句说人话的提示)", () => {
    const resolved = resolveTawkConfig({
      dbPropertyId: "not a valid id!",
      dbWidgetId: "1a2b3c",
      envPropertyId: "",
      envWidgetId: "",
    });
    expect(resolved.configured).toBe(false);
    expect(resolved.invalid).toBe(true);
    expect(resolved.source).toBe("db");
  });

  it("只填了一半 ⇒ 也算 invalid(装不上就是装不上)", () => {
    const resolved = resolveTawkConfig({
      dbPropertyId: "dbpid",
      dbWidgetId: null,
      envPropertyId: "",
      envWidgetId: "",
    });
    expect(resolved.configured).toBe(false);
    expect(resolved.invalid).toBe(true);
  });
});

describe("tawk:内置默认那一档(2026-11-16)", () => {
  /**
   * 工作室把官方那段 embed 代码贴过来了 ⇒ 这一对 ID **不是密钥**
   * (官方脚本明文写在页面源码里,谁看源码都能拿到)⇒ 预置成回退链的
   * **最后一档**:部署上去小窗就在,不用先去后台点一次保存。
   *
   * 回退链:**DB(存了 ⇒ 赢,哪怕空串)→ 环境变量 → 内置默认 → 没配**
   */
  it("什么都没配 ⇒ 内置默认那一档生效(小窗直接就在)", () => {
    const resolved = resolveTawkConfig({
      dbPropertyId: null,
      dbWidgetId: null,
      envPropertyId: "",
      envWidgetId: "",
      defaultPropertyId: TAWK_DEFAULT_PROPERTY_ID,
      defaultWidgetId: TAWK_DEFAULT_WIDGET_ID,
    });
    expect(resolved.source).toBe("default");
    expect(resolved.configured).toBe(true);
    expect(resolved.invalid).toBe(false);
    expect(resolved.propertyId).toBe(TAWK_DEFAULT_PROPERTY_ID);
    expect(resolved.widgetId).toBe(TAWK_DEFAULT_WIDGET_ID);
  });

  it("内置默认拼出来的地址 == 工作室贴的那段官方 embed 地址", () => {
    expect(
      buildTawkEmbedUrl(TAWK_DEFAULT_PROPERTY_ID, TAWK_DEFAULT_WIDGET_ID)
    ).toBe("https://embed.tawk.to/6afb1e688e6f59d4de4958a2/1k7ietiul");
    // 顺带钉住这两个 ID 本身是合法的(不然上面那一条会返 null)
    expect(isValidTawkId(TAWK_DEFAULT_PROPERTY_ID)).toBe(true);
    expect(isValidTawkId(TAWK_DEFAULT_WIDGET_ID)).toBe(true);
  });

  it("DB 赢过内置默认", () => {
    const resolved = resolveTawkConfig({
      dbPropertyId: "dbpid",
      dbWidgetId: "dbwid",
      envPropertyId: "",
      envWidgetId: "",
      defaultPropertyId: TAWK_DEFAULT_PROPERTY_ID,
      defaultWidgetId: TAWK_DEFAULT_WIDGET_ID,
    });
    expect(resolved.source).toBe("db");
    expect(resolved.propertyId).toBe("dbpid");
    expect(resolved.widgetId).toBe("dbwid");
  });

  it("环境变量赢过内置默认", () => {
    const resolved = resolveTawkConfig({
      dbPropertyId: null,
      dbWidgetId: null,
      envPropertyId: "envpid",
      envWidgetId: "envwid",
      defaultPropertyId: TAWK_DEFAULT_PROPERTY_ID,
      defaultWidgetId: TAWK_DEFAULT_WIDGET_ID,
    });
    expect(resolved.source).toBe("env");
    expect(resolved.propertyId).toBe("envpid");
    expect(resolved.widgetId).toBe("envwid");
  });

  it("**DB 存空串 ⇒ 明确关掉** —— 也赢过内置默认(小窗不出现)", () => {
    const resolved = resolveTawkConfig({
      dbPropertyId: "",
      dbWidgetId: "",
      envPropertyId: "",
      envWidgetId: "",
      defaultPropertyId: TAWK_DEFAULT_PROPERTY_ID,
      defaultWidgetId: TAWK_DEFAULT_WIDGET_ID,
    });
    expect(resolved.source).toBe("db");
    expect(resolved.configured).toBe(false);
    // 「什么都没填」**不是**「贴错了」
    expect(resolved.invalid).toBe(false);
    expect(resolved.embedUrl).toBe("");
  });

  it("没传默认档 ⇒ 这一档不存在(退回「没配」)", () => {
    const resolved = resolveTawkConfig({
      dbPropertyId: null,
      dbWidgetId: null,
      envPropertyId: "",
      envWidgetId: "",
    });
    expect(resolved.source).toBe("none");
    expect(resolved.configured).toBe(false);
  });

  it("store 那一层**每个**调用点都传了默认档(漏一个 = 读库失败时小窗消失)", () => {
    const src = read(STORE);
    // 四个调用点(两个函数的 try 分支 + catch 兜底分支)
    const calls = src.match(/resolveTawkConfig\(\{/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    // 每个调用点后面都跟着默认那两个常量
    const pattern =
      /resolveTawkConfig\(\{[\s\S]{0,900}?defaultPropertyId: TAWK_DEFAULT_PROPERTY_ID[\s\S]{0,200}?defaultWidgetId: TAWK_DEFAULT_WIDGET_ID/g;
    const matched = src.match(pattern) ?? [];
    expect(matched.length).toBe(calls.length);
    // 常量本身是从纯逻辑那一层 import 的(不是就地写一遍字符串)
    expect(src).toContain("TAWK_DEFAULT_PROPERTY_ID");
    expect(src).toContain("TAWK_DEFAULT_WIDGET_ID");
  });

  it("后台那一页:表单初值走默认档 + banner 有「默认」那一档", () => {
    const src = read(VIEW);
    expect(src).toContain("tawkDefaultPropertyId");
    expect(src).toContain("tawkDefaultWidgetId");
    expect(src).toContain('overview.tawkSource === "default"');
  });

  it("i18n:「默认」那一档的中英文都摆得上话", () => {
    const zh = messages("zh").AdminSiteSettings as {
      banner: Record<string, string>;
      current: Record<string, string>;
    };
    const en = messages("en").AdminSiteSettings as {
      banner: Record<string, string>;
      current: Record<string, string>;
    };
    expect(zh.banner.tawkDefaultFallback).toBeTruthy();
    expect(en.banner.tawkDefaultFallback).toBeTruthy();
    expect(zh.current.tawkDefault).toBeTruthy();
    expect(en.current.tawkDefault).toBeTruthy();
    // 中文那条要点明「内置默认」和「关掉」是两件事
    expect(zh.banner.tawkDefaultFallback).toContain("内置默认");
    expect(zh.banner.tawkDefaultFallback).toContain("关掉");
    // 「明确关掉」也有一句单独的提示
    expect(zh.banner.tawkTurnedOff).toBeTruthy();
    expect(en.banner.tawkTurnedOff).toBeTruthy();
  });
});

describe("tawk:页面上那个小窗", () => {
  it("layout 挂了那个组件,且**配了才挂**", () => {
    const src = read(LAYOUT);
    expect(src).toContain("TawkWidget");
    expect(src).toContain("getTawkWidgetConfig");
    expect(src).toContain("tawk.configured");
  });

  it("layout **不自己算** —— 生效配置来自 store 那一层", () => {
    const src = read(LAYOUT);
    expect(src).toContain("getTawkWidgetConfig");
    // 别在 layout 里手搓回退链(注释里提到那个变量名是「它在哪」的说明)
    expect(stripComments(src)).not.toContain("NEXT_PUBLIC_TAWK_");
  });

  it("组件自己注入脚本 —— **不用 next/script**", () => {
    // 注释里提到 `next/script` 是「**为什么**不用它」—— 那是说明,不是代码
    const src = stripComments(read(WIDGET));
    expect(src).not.toContain("next/script");
    expect(src).not.toContain("beforeInteractive");
    // 自己插一条带 id 的脚本
    expect(src).toContain('document.createElement("script")');
    expect(src).toContain("TAWK_SCRIPT_ID");
    expect(src).toContain("appendChild(script)");
  });

  it("脚本地址是**拼出来的那条**", () => {
    const src = read(WIDGET);
    expect(src).toContain("buildTawkEmbedUrl");
  });

  it("**永远是匿名的** —— 代码里没有发访客身份的那条路(2026-11-16)", () => {
    const src = stripComments(read(WIDGET));
    // `visitor` 一词都不许出现在**代码**里(注释里解释「为什么不发」不算)
    expect(src).not.toContain("visitor");
    expect(src).not.toContain("useSession");
  });

  it("不重复注入(StrictMode 双挂载 / 客户端路由)", () => {
    const src = read(WIDGET);
    expect(src).toContain("getElementById(TAWK_SCRIPT_ID)");
  });

  it("方法调用前判存在 —— 方法是 widget 起来之后才装上的", () => {
    const src = read(WIDGET);
    expect(src).toContain('typeof api.setAttributes === "function"');
  });

  it("**渲染 `null`** —— 服务端和客户端输出一样(不许 hydration mismatch)", () => {
    const src = stripComments(read(WIDGET));
    expect(src).not.toContain("typeof window");
    expect(src).toContain("return null;");
  });
});

describe("tawk:配置跟 DB / 环境变量的接线", () => {
  it("两个键写进 `site_setting`", () => {
    const src = read(PURE_SITE);
    expect(src).toContain("tawk_property_id");
    expect(src).toContain("tawk_widget_id");
  });

  it("store 那层读 DB + 环境变量,且**读挂了不抛**", () => {
    const src = read(STORE);
    expect(src).toContain("NEXT_PUBLIC_TAWK_PROPERTY_ID");
    expect(src).toContain("NEXT_PUBLIC_TAWK_WIDGET_ID");
    expect(src).toContain("getTawkWidgetConfig");
    expect(src).toContain("resolveTawkConfig");
    expect(src).toMatch(/catch[\s\S]{0,600}resolveTawkConfig/);
  });

  it("后台保存两个 ID 一个事务", () => {
    const src = read(ACTIONS);
    expect(src).toContain("saveSiteSettings");
    expect(src).toContain("SITE_SETTING_KEYS.tawkPropertyId");
    expect(src).toContain("SITE_SETTING_KEYS.tawkWidgetId");
  });

  it("ID 不合法 ⇒ 报**它自己那个码**(两个框长得一样,得说清改哪个)", () => {
    const src = read(ACTIONS);
    expect(src).toContain("INVALID_TAWK_ID");
    expect(src).toContain("isValidTawkId");
  });

  it("「删掉后台这两行」是**单独一个 action**(两个 ID 是一套配置)", () => {
    const src = read(ACTIONS);
    expect(src).toContain("adminResetTawkSettingsAction");
    expect(src).toContain("deleteSiteSettings");
    // 按键删那条**不动** —— 它那套语义是「删掉一项」
    expect(src).toContain("deleteSiteSetting(parsedInput.key)");
  });

  it("后台那一页:两个输入框 + 一颗 tawk 重置按钮", () => {
    const src = read(VIEW);
    expect(src).toContain("tawkPropertyId");
    expect(src).toContain("tawkWidgetId");
    expect(src).toContain("adminResetTawkSettingsAction");
    expect(src).toContain("resetTawk");
  });

  it("后台那一页**不开弹窗**(工作室的口味)", () => {
    const src = stripComments(read(VIEW));
    expect(src).not.toContain("<Modal");
    expect(src).not.toContain("<Dialog");
  });
});

describe("tawk:小窗永远是匿名的(2026-11-16 工作室拍板)", () => {
  it("**整条数据外发的路都不存在** —— 代码里没有开关、也没有那一条通路", () => {
    // 结构性保证:不是「默认关」,而是**根本没有那条代码**
    const src = stripComments(read(CONFIG));
    expect(src).not.toContain("shareIdentity");
    expect(src).not.toContain("TawkVisitor");
    expect(src).not.toContain("visitor");
  });

  it("匿名版 widget 不碰会话 —— 连 `/api/auth/get-session` 那一次请求都不发", () => {
    const src = stripComments(read(WIDGET));
    expect(src).not.toContain("useSession");
    expect(src).not.toContain("visitor");
  });

  it("**没有「带身份版」那个组件文件** —— 别把它捡回来", () => {
    expect(() =>
      read("src/features/tawk/components/tawk-widget-identity.tsx")
    ).toThrow();
  });

  it("layout 只挂**匿名版** —— 没有按开关挑组件那一步", () => {
    const src = stripComments(read(LAYOUT));
    expect(src).toContain("TawkWidget");
    expect(src).not.toContain("TawkWidgetWithIdentity");
    expect(src).not.toContain("shareIdentity");
  });

  it("`site_setting` 里**没有**那颗开关的键", () => {
    const src = stripComments(read(PURE_SITE));
    expect(src).not.toContain("tawk_share_identity");
    expect(src).not.toContain("tawkShareIdentity");
  });

  it("store 那一层不读那个环境变量", () => {
    const src = stripComments(read(STORE));
    expect(src).not.toContain("NEXT_PUBLIC_TAWK_SHARE_IDENTITY");
    expect(src).not.toContain("tawkShareIdentity");
  });

  it("后台 action 里没有那颗开关 —— 存的就是那两个 ID", () => {
    const src = stripComments(read(ACTIONS));
    expect(src).not.toContain("tawkShareIdentity");
    expect(src).not.toContain("shareIdentity");
  });

  it("后台那一页**没有那颗开关**(也没多出 `<Switch>`)", () => {
    const src = stripComments(read(VIEW));
    expect(src).not.toContain("tawkShareIdentity");
    expect(src).not.toContain("<Switch");
  });

  it("语言包里**没有**身份那几条文案", () => {
    const zh = messages("zh").AdminSiteSettings as {
      form: Record<string, string>;
      current: Record<string, string>;
    };
    const en = messages("en").AdminSiteSettings as {
      form: Record<string, string>;
      current: Record<string, string>;
    };
    expect(zh.form.tawkShareIdentityLabel).toBeUndefined();
    expect(zh.form.tawkShareIdentityExtra).toBeUndefined();
    expect(zh.current.tawkShareIdentity).toBeUndefined();
    expect(zh.current.tawkShareIdentityOn).toBeUndefined();
    expect(zh.current.tawkShareIdentityOff).toBeUndefined();
    expect(en.form.tawkShareIdentityLabel).toBeUndefined();
    expect(en.form.tawkShareIdentityExtra).toBeUndefined();
    expect(en.current.tawkShareIdentityOn).toBeUndefined();
    expect(en.current.tawkShareIdentityOff).toBeUndefined();
  });
});

describe("tawk:i18n", () => {
  it("中英文 key 一致", () => {
    const zh = messages("zh").AdminSiteSettings as Record<string, unknown>;
    const en = messages("en").AdminSiteSettings as Record<string, unknown>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  it("嵌套的 key 也一致(current / banner / form / actions / messages / errors)", () => {
    const zh = messages("zh").AdminSiteSettings as Record<
      string,
      Record<string, unknown>
    >;
    const en = messages("en").AdminSiteSettings as Record<
      string,
      Record<string, unknown>
    >;
    for (const group of [
      "current",
      "banner",
      "form",
      "actions",
      "messages",
      "errors",
    ]) {
      const zhGroup = zh[group] as Record<string, unknown>;
      const enGroup = en[group] as Record<string, unknown>;
      expect(Object.keys(enGroup).sort()).toEqual(Object.keys(zhGroup).sort());
    }
  });

  it("每个错误码两种语言都摆得上话", () => {
    const zh = messages("zh").AdminSiteSettings as {
      errors: Record<string, unknown>;
    };
    const en = messages("en").AdminSiteSettings as {
      errors: Record<string, unknown>;
    };
    for (const code of [
      "INVALID_URL",
      "NOT_HTTP",
      "INVALID_QR_URL",
      "INVALID_TAWK_ID",
      "MIGRATION_MISSING",
      "SAVE_FAILED",
    ]) {
      expect(zh.errors[code]).toBeTruthy();
      expect(en.errors[code]).toBeTruthy();
    }
  });

  it("纯逻辑那一层**零 import** —— 能进 unit project 跑单测", () => {
    const src = stripComments(read(CONFIG));
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toContain("@/db");
    expect(src).not.toContain("server-only");
  });
});
