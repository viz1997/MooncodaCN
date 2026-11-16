import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildTawkEmbedUrl,
  isValidTawkId,
  normalizeTawkId,
  resolveTawkConfig,
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
 * 1. **回退链** —— DB 那一行 → 环境变量 → 没配。跟站内其它设置一个口径:
 *    「DB 里存了空串」= **明确关掉**,不是「没配」。
 * 2. **两个 ID 是一个原子** —— 少一个就装不上(那是 tawk 那边硬性的)。
 * 3. **身份要在脚本下载之前设上** —— 晚设就不认。
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

  it("身份在脚本下载**之前**设上", () => {
    const src = read(WIDGET);
    const visitorAt = src.indexOf("api.visitor");
    const createAt = src.indexOf('document.createElement("script")');
    expect(visitorAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(-1);
    // visitor 的赋值必须排在插脚本**之前**
    expect(visitorAt).toBeLessThan(createAt);
  });

  it("不重复注入(StrictMode 双挂载 / 客户端路由)", () => {
    const src = read(WIDGET);
    expect(src).toContain("getElementById(TAWK_SCRIPT_ID)");
  });

  it("方法调用前判存在 —— 方法是 widget 起来之后才装上的", () => {
    const src = read(WIDGET);
    expect(src).toContain('typeof api.setAttributes === "function"');
  });

  it("会话在**客户端**取 —— 服务端读 session 会让整个公开站变成动态渲染", () => {
    const src = read(WIDGET);
    expect(src).toContain("useSession");
    // 注释里提到 `headers()` 是「**为什么**不用它」—— 那是说明,不是代码
    expect(stripComments(src)).not.toContain("headers()");
  });

  it("会话等**有上限** —— 不能让客服小窗一直卡着不出现", () => {
    const src = read(WIDGET);
    expect(src).toContain("TAWK_SESSION_WAIT_MS");
    expect(src).toContain("clearTimeout");
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
