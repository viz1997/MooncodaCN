import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SERVICE_WECHAT_QR_PATH,
  normalizeStorefrontUrl,
  resolveInternationalStoreUrl,
  resolveServiceWechatQrUrl,
  SITE_SETTING_KEYS,
  validateServiceQrUrl,
  validateStorefrontUrl,
} from "@/features/site-settings/lib/site-setting";

/**
 * 站点设置后台(2026-11-11)
 *
 * 工作室 2026-11-11 的要求:**「海外独立站入口 —— 不需要环境变量,在后台设置」**。
 *
 * ## 为什么这件事值得单测
 *
 * 真理源从「环境变量」搬到「DB」之后,链路上多了三样容易出错的东西:
 *
 * 1. **回退链** —— DB 那一行 → 环境变量 → 空。三档的边界很容易搞错:
 *    「DB 里存了空串」**不是**「没配」,那是「**明确关掉**」。搞错了 ⇒
 *    工作室明明在后台关了入口,页面上还挂着(或者反过来)。
 * 2. **校验** —— 地址会被渲染成 `<a href=…>`。一个 `javascript:` 挂在页面上
 *    就是一条能点就执行的链接。⇒ **不合法的地址一律不显示**(fail closed)。
 * 3. **缓存** —— 读带缓存(`unstable_cache` + tag),后台保存时要作废缓存 +
 *    刷 layout。漏了任一样 ⇒ 工作室改完刷新看到旧地址,以为功能坏了。
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

const PURE = "src/features/site-settings/lib/site-setting.ts";
const STORE = "src/features/site-settings/lib/site-setting-store.ts";
const ACTIONS = "src/features/site-settings/admin/actions.ts";
const TYPES = "src/features/site-settings/admin/types.ts";
const VIEW =
  "src/features/site-settings/admin/components/site-settings-admin-view.tsx";
const ADMIN_PAGE = "src/app/[locale]/(admin)/admin/site-settings/page.tsx";
const MIGRATION = "scripts/apply-site-setting-schema.ts";
const SCHEMA = "src/db/schema.ts";

describe("站点设置:生效值的回退链", () => {
  it("键名是写死在代码里的那一个", () => {
    expect(SITE_SETTING_KEYS.internationalStoreUrl).toBe(
      "international_store_url"
    );
  });

  it("DB 里有这一行 ⇒ 它说了算(哪怕环境变量也配着)", () => {
    const resolved = resolveInternationalStoreUrl({
      dbValue: "https://db.myshopify.com",
      envValue: "https://env.myshopify.com",
    });
    expect(resolved.url).toBe("https://db.myshopify.com");
    expect(resolved.source).toBe("db");
    expect(resolved.invalid).toBe(false);
  });

  it("DB 里存了**空串** ⇒ 明确关掉(不是「没配」)", () => {
    // 这是「在后台设置」的意义 —— 工作室能自己把入口关掉,
    // 哪怕环境变量还配着。
    const resolved = resolveInternationalStoreUrl({
      dbValue: "",
      envValue: "https://env.myshopify.com",
    });
    expect(resolved.url).toBe("");
    expect(resolved.source).toBe("db");
    expect(resolved.invalid).toBe(false);
  });

  it("DB 里没这一行 ⇒ 看环境变量", () => {
    const resolved = resolveInternationalStoreUrl({
      dbValue: null,
      envValue: "https://env.myshopify.com",
    });
    expect(resolved.url).toBe("https://env.myshopify.com");
    expect(resolved.source).toBe("env");
  });

  it("哪儿都没配 ⇒ 没有地址(入口不出现)", () => {
    const resolved = resolveInternationalStoreUrl({
      dbValue: null,
      envValue: "",
    });
    expect(resolved.url).toBe("");
    expect(resolved.source).toBe("none");
    expect(resolved.invalid).toBe(false);
  });

  it("不合法 ⇒ **不显示**(fail closed),但要标出来", () => {
    // 一个手改过的库行塞了 `javascript:` ⇒ 绝不能渲染成 href
    const resolved = resolveInternationalStoreUrl({
      dbValue: "javascript:alert(1)",
      envValue: "https://env.myshopify.com",
    });
    expect(resolved.url).toBe("");
    expect(resolved.invalid).toBe(true);
    // 来源仍然是 db —— 后台要告诉工作室「你存的那个地址不能用」
    expect(resolved.source).toBe("db");
  });

  it("环境变量那一档不合法也一样不显示", () => {
    const resolved = resolveInternationalStoreUrl({
      dbValue: null,
      envValue: "javascript:alert(1)",
    });
    expect(resolved.url).toBe("");
    expect(resolved.invalid).toBe(true);
    expect(resolved.source).toBe("env");
  });
});

describe("站点设置:归一化与校验", () => {
  it("归一化:去空格、去结尾的斜杠", () => {
    expect(normalizeStorefrontUrl("  https://x.myshopify.com/  ")).toBe(
      "https://x.myshopify.com"
    );
    expect(normalizeStorefrontUrl("https://x.myshopify.com///")).toBe(
      "https://x.myshopify.com"
    );
    expect(normalizeStorefrontUrl(null)).toBe("");
    expect(normalizeStorefrontUrl(undefined)).toBe("");
  });

  it("只认 http / https", () => {
    expect(validateStorefrontUrl("https://x.myshopify.com").ok).toBe(true);
    expect(validateStorefrontUrl("http://x.myshopify.com").ok).toBe(true);

    const js = validateStorefrontUrl("javascript:alert(1)");
    expect(js.ok).toBe(false);
    expect(js.ok === false && js.code).toBe("NOT_HTTP");

    const mail = validateStorefrontUrl("mailto:a@b.com");
    expect(mail.ok).toBe(false);
    expect(mail.ok === false && mail.code).toBe("NOT_HTTP");
  });

  it("根本不是一个 URL ⇒ INVALID_URL", () => {
    const bad = validateStorefrontUrl("不是网址");
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.code).toBe("INVALID_URL");
  });

  it("空串 ⇒ EMPTY(保存时空串是合法的 —— 那是「明确关掉」)", () => {
    const empty = validateStorefrontUrl("");
    expect(empty.ok).toBe(false);
    expect(empty.ok === false && empty.code).toBe("EMPTY");
  });
});

describe("站点设置:读的那一层", () => {
  it("读 DB(不是只读环境变量)", () => {
    const src = read(STORE);
    expect(src).toContain("siteSetting");
    expect(src).toContain("NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL");
    // 真理源是 DB 那一行
    expect(src).toContain("resolveInternationalStoreUrl");
  });

  it("读带缓存 ⇒ 营销站不会被读一次库拖成永远动态渲染", () => {
    const src = read(STORE);
    expect(src).toContain("unstable_cache");
    expect(src).toContain("SITE_SETTINGS_TAG");
    // 同一个请求内只查一次
    expect(src).toContain("cache(");
  });

  it("读挂了 ⇒ 退回环境变量,**不抛**", () => {
    // 这个地址挂在每一个页面头上 —— 抛出去整站就塌了。
    const src = read(STORE);
    expect(src).toContain("catch");
    expect(src).toMatch(/catch[\s\S]{0,400}resolveInternationalStoreUrl/);
  });

  it("渲染路径上**再校验一次**(不许只靠写入时那一次)", () => {
    // 有人直接改库 ⇒ 渲染路径也得挡住坏地址
    expect(read(PURE)).toContain("validateStorefrontUrl");
    expect(read(STORE)).toContain("resolveInternationalStoreUrl");
  });
});

describe("站点设置:后台那一页", () => {
  it("路由在 /admin/site-settings", () => {
    const src = read(ADMIN_PAGE);
    expect(src).toContain("SiteSettingsAdminView");
    // RSC 只渲染视图,鉴权由父 layout 守(注释里提到 checkAdmin 不算)
    expect(stripComments(src)).not.toContain("checkAdmin(");
  });

  it("侧边栏登记了这一项", () => {
    expect(read("src/config/nav.ts")).toContain("/admin/site-settings");
    expect(read("src/features/admin/components/admin-sidebar.tsx")).toContain(
      "nav.siteSettings"
    );
  });

  it("配置界面在页面上直接处理,不开弹窗", () => {
    // 工作室的口味(跟打印定价 / 优惠码后台一个套路)
    const src = stripComments(read(VIEW));
    expect(src).not.toContain("<Modal");
    expect(src).not.toContain("<Dialog");
  });

  it("两个按钮分开:保存 vs 删掉后台这一行", () => {
    const src = read(VIEW);
    expect(src).toContain("adminSaveSiteSettingsAction");
    expect(src).toContain("adminResetSiteSettingsAction");
  });

  it("写操作走 adminAction(后台要管理员)", () => {
    const src = read(ACTIONS);
    expect(src).toContain("adminAction");
    expect(src).toContain('"use server"');
  });

  it("出错返回 `{ok:false, code}`,不 throw", () => {
    const src = read(ACTIONS);
    expect(src).toContain("MIGRATION_MISSING");
    expect(src).toContain("SAVE_FAILED");
    expect(src).toContain("INVALID_URL");
    expect(src).toContain("NOT_HTTP");
  });

  it("保存完要作废缓存 + 刷 layout", () => {
    // 漏了任一样 ⇒ 工作室改完刷新看到旧地址
    const src = read(ACTIONS);
    expect(src).toContain("revalidateTag");
    expect(src).toContain("revalidatePath");
    expect(src).toContain('revalidatePath("/[locale]", "layout")');
  });

  it("「use server」文件**不 re-export 类型**", () => {
    // Turbopack 会把类型 re-export 注册成 server action → 运行时 ReferenceError
    // → 整个页面 500(见 src/test/repo/pure/use-server-exports.test.ts)
    const src = read(ACTIONS);
    expect(src).not.toMatch(/^\s*export\s+type\s*\{/m);
    expect(src).not.toMatch(/^\s*export\s*\*\s*from/m);
    // 类型住在纯类型模块里
    expect(read(TYPES)).toContain("AdminSiteSettingsView");
  });

  it("DB 表建在 schema 里", () => {
    const src = read(SCHEMA);
    expect(src).toContain("siteSetting");
    expect(src).toContain("site_setting");
  });
});

describe("站点设置:迁移脚本", () => {
  it("脚本在仓库里,幂等,不播种配置行", () => {
    const src = read(MIGRATION);
    expect(src).toContain("CREATE TABLE IF NOT EXISTS");
    expect(src).toContain('"site_setting"');
    // **不写配置行** —— 跑完脚本线上行为一个字节都不变
    expect(stripComments(src)).not.toMatch(/INSERT\s+INTO/i);
  });

  it("支持 --dry-run", () => {
    expect(read(MIGRATION)).toContain("--dry-run");
  });

  it("package.json 登记了命令", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["migrate:apply-site-setting"]).toContain(
      "apply-site-setting-schema.ts"
    );
  });
});

describe("站点设置:i18n", () => {
  it("中英文 key 一致", () => {
    const zh = messages("zh").AdminSiteSettings as Record<string, unknown>;
    const en = messages("en").AdminSiteSettings as Record<string, unknown>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  it("四个错误码两种语言都摆得上话", () => {
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
      "MIGRATION_MISSING",
      "SAVE_FAILED",
    ]) {
      expect(zh.errors[code]).toBeTruthy();
      expect(en.errors[code]).toBeTruthy();
    }
  });

  it("侧边栏标题两种语言都有", () => {
    const zh = messages("zh").AdminSidebar as {
      nav: Record<string, unknown>;
    };
    const en = messages("en").AdminSidebar as {
      nav: Record<string, unknown>;
    };
    expect(zh.nav.siteSettings).toBeTruthy();
    expect(en.nav.siteSettings).toBeTruthy();
  });
});

/**
 * 客服微信二维码(2026-11-13)
 *
 * 工作室的要求:**「底部增加客服联系方式,比如点击后展示客服的微信二维码」**。
 *
 * 这一项跟海外独立站地址**共用那套回退链**,只有两处不同:
 *
 * 1. **多一档「内置默认」** —— `/service/wechat-qr.png`。二维码图往往是放进
 *    仓库里的一张静态文件,不是公网地址;后台那一栏不填时,页面照样去找它。
 * 2. **多认一档站内路径** —— 二维码图不是链接,`<img src>` 认站内路径。
 *
 * ⚠️ **站内路径只认单个斜杠开头** —— `//evil.com/x.png` 是「协议相对地址」,
 * 浏览器会当成 `https://evil.com/x.png` 去请求 ⇒ 等于让一个后台可配的字段
 * 变成「从别的站加载图片」的入口。
 */
describe("站点设置:客服微信二维码", () => {
  it("键名是写死在代码里的那一个", () => {
    expect(SITE_SETTING_KEYS.serviceWechatQrUrl).toBe("service_wechat_qr_url");
  });

  it("DB 里有这一行 ⇒ 它说了算", () => {
    const resolved = resolveServiceWechatQrUrl({
      dbValue: "https://cdn.example.com/qr.png",
      envValue: "/service/wechat-qr.png",
    });
    expect(resolved.url).toBe("https://cdn.example.com/qr.png");
    expect(resolved.source).toBe("db");
    expect(resolved.invalid).toBe(false);
  });

  it("DB 里存了**空串** ⇒ 明确关掉(页脚不摆二维码)", () => {
    const resolved = resolveServiceWechatQrUrl({
      dbValue: "",
      envValue: "/service/wechat-qr.png",
    });
    expect(resolved.url).toBe("");
    expect(resolved.source).toBe("db");
    expect(resolved.invalid).toBe(false);
  });

  it("DB 里没这一行 ⇒ 看环境变量", () => {
    const resolved = resolveServiceWechatQrUrl({
      dbValue: null,
      envValue: "https://cdn.example.com/qr.png",
    });
    expect(resolved.url).toBe("https://cdn.example.com/qr.png");
    expect(resolved.source).toBe("env");
  });

  it("环境变量也没有 ⇒ 走内置默认那一张静态图", () => {
    const resolved = resolveServiceWechatQrUrl({
      dbValue: null,
      envValue: "",
    });
    expect(resolved.url).toBe(DEFAULT_SERVICE_WECHAT_QR_PATH);
    expect(resolved.url).toBe("/service/wechat-qr.png");
    expect(resolved.source).toBe("default");
    expect(resolved.invalid).toBe(false);
  });

  it("不合法 ⇒ **不显示**(fail closed)", () => {
    const resolved = resolveServiceWechatQrUrl({
      dbValue: "javascript:alert(1)",
      envValue: "/service/wechat-qr.png",
    });
    expect(resolved.url).toBe("");
    expect(resolved.invalid).toBe(true);
    expect(resolved.source).toBe("db");
  });

  it("站内路径合法(单斜杠开头)", () => {
    const ok = validateServiceQrUrl("/service/wechat-qr.png");
    expect(ok.ok).toBe(true);
    expect(ok.ok === true && ok.value).toBe("/service/wechat-qr.png");
  });

  it("**协议相对地址不认** —— `//evil.com/x.png` 不是站内路径", () => {
    // 浏览器会把它当成 https://evil.com/x.png 去请求 ⇒ 后台可配的字段
    // 变成了「从别的站加载图片」的入口。
    const bad = validateServiceQrUrl("//evil.com/x.png");
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.code).toBe("INVALID_URL");
  });

  it("javascript: / mailto: 一律拒掉", () => {
    expect(validateServiceQrUrl("javascript:alert(1)").ok).toBe(false);
    expect(validateServiceQrUrl("mailto:a@b.com").ok).toBe(false);
  });

  it("读的那一层读的是**环境变量兜底 + DB**", () => {
    const src = read(STORE);
    expect(src).toContain("NEXT_PUBLIC_SERVICE_WECHAT_QR_URL");
    expect(src).toContain("resolveServiceWechatQrUrl");
    expect(src).toContain("getServiceWechatQrUrl");
  });

  it("读挂了 ⇒ 退回默认路径,**不抛**(页脚的客服入口不能整个没了)", () => {
    const src = read(STORE);
    expect(src).toMatch(/catch[\s\S]{0,400}resolveServiceWechatQrUrl/);
  });

  it("后台保存**两个键一个事务** —— 不会写一半", () => {
    const src = read(ACTIONS);
    expect(src).toContain("saveSiteSettings");
    expect(src).toContain("SITE_SETTING_KEYS.internationalStoreUrl");
    expect(src).toContain("SITE_SETTING_KEYS.serviceWechatQrUrl");
  });

  it("重置是**按键**的 —— 不能顺手把另一项也退回去", () => {
    const src = read(ACTIONS);
    expect(src).toContain("resetSchema");
    expect(src).toContain("SITE_SETTING_KEYS.serviceWechatQrUrl");
    expect(src).toContain("deleteSiteSetting(parsedInput.key)");
  });

  it("二维码不合法 ⇒ 报**它自己那个码**(工作室要知道改哪个输入框)", () => {
    const src = read(ACTIONS);
    expect(src).toContain("INVALID_QR_URL");
    expect(src).toContain("validateServiceQrUrl");
  });

  it("后台那一页:两个字段 + 两颗重置按钮", () => {
    const src = read(VIEW);
    expect(src).toContain("serviceWechatQrUrl");
    expect(src).toContain("adminResetSiteSettingsAction");
    // 两颗重置 ⇒ 两个 hook
    expect(src).toContain("resetStore");
    expect(src).toContain("resetQr");
  });

  it("类型在纯类型模块里(「use server」文件不 re-export 类型)", () => {
    const src = read(ACTIONS);
    expect(src).not.toMatch(/^\s*export\s+type\s*\{/m);
    expect(src).not.toMatch(/^\s*export\s*\*\s*from/m);
    expect(read(TYPES)).toContain("serviceQrUrl");
  });
});
