import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 访客可以先量,下单时才引导登录(2026-11-16)
 *
 * 工作室的要求:
 *
 * > 「用户不登陆也可以使用工具检测模型、克重等等,但是用户点击报价下单需要
 * > 引导用户登录」
 *
 * ## 这一条跟仓库原来的口径冲突过
 *
 * CLAUDE.md 原来写着「**必须先登录再量**」—— 理由是登录那一下是**整页跳转**
 * (`sign-in-form.tsx` 走 `window.location.href`)⇒ 内存里那个模型选不回来。
 *
 * 那是**被整页跳转逼出来的妥协**,不是业务要求。2026-11-16 改成:
 *
 * - **检查 / 克重 / 预估报价** —— 不用登录
 * - **下单** —— 要账号(工单挂在账号名下,模型落到用户自己的 R2 分区)
 * - 登录在**报价弹窗里就地**完成 ⇒ **模型不丢**
 *
 * ## 这个测试守住什么
 *
 * | 守卫 | 为什么 |
 * |---|---|
 * | 工具页**公开**(不把访客踢去登录) | 访客能用的工具被挡住 = 这一条白写 |
 * | 报价接口**不拦访客** | 访客看不到预估 = 「可以先量」名不副实 |
 * | 下单接口**要 session** | 工单挂不到账号名下 / 模型落进别人的分区 |
 * | 就地登录**不传 `callbackURL`** | 传了就是整页跳转 ⇒ 模型没了(回到老问题) |
 * | 就地登录用**同源** baseURL | `NEXT_PUBLIC_APP_URL` 在预览部署上是别的域名 ⇒ cookie 落错地方 |
 * | 登录完 `router.refresh()` | 不刷新就换不回登录态 / 地址簿 |
 * | 「先登录再量」那句文案**删了** | 文案还在劝人先登录 = 界面跟要求打架 |
 * | 中英文键集**一样** | 少一个语言 = 那一侧显示 key 名 |
 */

const ROOT = resolve(process.cwd());

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着「以前是…」不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/** 把 JSON 里某个命名空间的叶子键列出来(点路径) */
function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}

/** 按点路径取值 —— `readPath(zh, "PrintQuote.entry.signIn.errors.invalidCredentials")` */
function readPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

const WORKBENCH_PAGE =
  "src/app/[locale]/(marketing-atelier)/tools/workbench/page.tsx";
const QUOTE_DIALOG =
  "src/features/print-quote/components/print-service-quote-dialog.tsx";
const INLINE_SIGN_IN =
  "src/features/print-quote/components/print-service-inline-sign-in.tsx";
const AUTH_CLIENT = "src/lib/auth/client.ts";
const PRINT_QUOTE_ROUTE = "src/app/api/print-quote/route.ts";
const PRINT_ORDERS_ROUTE = "src/app/api/print-orders/route.ts";
const EMAIL_SIGN_IN = "src/features/auth/components/sign-in-form.tsx";
const PHONE_SIGN_IN = "src/features/auth/components/phone-sign-in-form.tsx";

describe("访客可以先量 —— 工具页是公开的", () => {
  it("工作台**不把访客踢去登录**", () => {
    const code = stripComments(read(WORKBENCH_PAGE));

    // 只查登录态,不 redirect —— 访客照样能进、能拖模型、能量
    expect(code).not.toMatch(/redirect\([^)]*sign-?in/i);
    expect(code).not.toContain("requireSession");
  });

  it("工具页把登录态当**数据**传下去,不当**门禁**", () => {
    const code = stripComments(read(WORKBENCH_PAGE));

    expect(code).toContain("isLoggedIn={isLoggedIn}");
    // 没登录时地址簿是空的(不是报错)
    expect(code).toContain("const addresses = session?.user?.id");
  });
});

describe("访客可以先量 —— 报价接口不拦访客", () => {
  it("报价接口**不因为没登录就 401**", () => {
    const code = stripComments(read(PRINT_QUOTE_ROUTE));

    expect(code).not.toContain("AUTH_REQUIRED");
    // 访客能不能看价,由后台那个开关说了算 ⇒ 403 而不是 401
    expect(code).toContain("GUEST_PRICING_DISABLED");
    expect(code).toContain("allowGuestPricing");
  });

  it("下单接口**要 session** —— 工单挂不到账号名下就不许建", () => {
    const code = stripComments(read(PRINT_ORDERS_ROUTE));

    expect(code).toContain("AUTH_REQUIRED");
    expect(code).toContain("getPrintOrderUser");
  });
});

describe("访客可以先量 —— 弹窗里就地登录", () => {
  it("没登录时弹窗摆的是**就地登录**,不是只给一个链接", () => {
    const code = stripComments(read(QUOTE_DIALOG));

    expect(code).toContain("<PrintServiceInlineSignIn");
    // 已登录才摆下单表单
    expect(code).toContain("<PrintServiceOrderForm");
  });

  it("就地登录**不传 `callbackURL`** —— 传了就是整页跳转,模型没了", () => {
    const code = stripComments(read(INLINE_SIGN_IN));

    expect(code).toContain("signInWithEmailInPlace");
    expect(code).not.toContain("callbackURL");
    expect(code).not.toContain("callbackUrl");
  });

  it("登录完 `router.refresh()` —— 换回登录态 / 地址簿,模型留在内存里", () => {
    const code = stripComments(read(INLINE_SIGN_IN));

    expect(code).toContain("router.refresh()");
    // **不许**整页跳转
    expect(code).not.toContain("window.location.href");
  });

  it("就地登录用**同源** baseURL —— `NEXT_PUBLIC_APP_URL` 在预览部署上是别的域名", () => {
    const code = stripComments(read(AUTH_CLIENT));

    // 就地登录那个客户端必须是懒创建的同源客户端
    const inPlace =
      code.match(/function getInPlaceAuthClient\(\)[\s\S]*?\n\}/)?.[0] ?? "";
    expect(inPlace).toContain("window.location.origin");
    expect(inPlace).not.toContain("NEXT_PUBLIC_APP_URL");

    // 就地登录本身**不传** callbackURL
    const signInFn =
      code.match(
        /export async function signInWithEmailInPlace\([\s\S]*?\n\}/
      )?.[0] ?? "";
    expect(signInFn).toContain("client.signIn.email");
    expect(signInFn).not.toContain("callbackURL");
  });
});

describe("访客可以先量 —— 登录页记得用户从哪儿来", () => {
  it("邮箱那条路不再写死跳 `/dashboard`", () => {
    const code = stripComments(read(EMAIL_SIGN_IN));

    expect(code).toContain("resolvePostSignInUrlFromBrowser");
    expect(code).not.toContain('window.location.href = "/dashboard"');
  });

  it("手机号 + 验证码那条路也不再写死 `/dashboard`", () => {
    const code = stripComments(read(PHONE_SIGN_IN));

    expect(code).toContain("resolvePostSignInUrlFromBrowser");
    expect(code).not.toContain('window.location.href = "/dashboard"');
  });
});

describe("访客可以先量 —— 文案", () => {
  it("「先登录再量」那句**删了** —— 文案不该劝人先登录", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    expect(zh.PrintQuote.entry.descSignIn).not.toContain("先登录再量");
    expect(en.PrintQuote.entry.descSignIn).not.toContain("Sign in first");
    // 新文案说的是「在这里登录就能继续下单」
    expect(zh.PrintQuote.entry.descSignIn).toContain("登录");
  });

  it("就地登录那几个键**中英文一样** —— 少一个语言 = 那一侧显示 key 名", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    expect(leafPaths(en.PrintQuote.entry.signIn).sort()).toEqual(
      leafPaths(zh.PrintQuote.entry.signIn).sort()
    );
  });

  it("就地登录要有的键都在", () => {
    const zh = JSON.parse(read("messages/zh.json"));

    for (const key of [
      "title",
      "emailLabel",
      "emailPlaceholder",
      "passwordLabel",
      "passwordPlaceholder",
      "submit",
      "submitting",
      "hint",
      "altHint",
      "errors.missingFields",
      "errors.invalidCredentials",
      "errors.emailNotVerified",
    ]) {
      expect(readPath(zh, `PrintQuote.entry.signIn.${key}`)).toBeTruthy();
    }
  });

  it("弹窗和组件里用到的键**在 messages 里都有**", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const inline = read(INLINE_SIGN_IN);
    const dialog = read(QUOTE_DIALOG);

    // 就地登录用的键
    for (const key of [
      "title",
      "emailLabel",
      "emailPlaceholder",
      "passwordLabel",
      "passwordPlaceholder",
      "submit",
      "submitting",
      "hint",
      "errors.missingFields",
      "errors.invalidCredentials",
      "errors.emailNotVerified",
    ]) {
      expect(inline).toContain(`"${key}"`);
      expect(readPath(zh, `PrintQuote.entry.signIn.${key}`)).toBeTruthy();
    }

    // 弹窗用到的键
    expect(dialog).toContain('t("entry.signIn.altHint")');
    expect(readPath(zh, "PrintQuote.entry.signIn.altHint")).toBeTruthy();
    expect(dialog).toContain('t("entry.descSignIn")');
    expect(readPath(zh, "PrintQuote.entry.descSignIn")).toBeTruthy();
  });
});
