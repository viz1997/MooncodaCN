import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALIPAY_REQUIREMENTS,
  allChannelFields,
  shouldShowSandboxFields,
  WECHAT_REQUIREMENTS,
} from "@/features/payments/lib/sandbox";

/**
 * 支付设置后台 `/admin/payment-settings`(2026-11-13)
 *
 * 工作室 2026-11-13 的要求:**「支付宝、微信支付先用沙盒测试验证」**,外加一句
 * **「可以后台配置」**。
 *
 * ## 为什么这一页值得单测
 *
 * 这一页是**唯一**能改「钱往哪儿收」的界面,链路上有四处特别容易出错:
 *
 * 1. **密钥留空 = 保持原值** —— 密钥原文永远不回显(只给「已配置(…abcd)」),
 *    表单提交时那个输入框**本来就是空的**。如果空串 = 清空,工作室点一次
 *    「保存」就把私钥擦了 —— 下一次支付以「签名错误」的形式炸出来,极难
 *    联想到「我刚才点了个保存」。⇒ **空 = 不动这一行**。
 * 2. **非密钥留空 = 清空** —— 端点 / 通知地址留空是有意义的(「留空 = 用默认」)
 *    ⇒ 空串要**写进去**。这两条方向相反,写反了就是上面的事故。
 * 3. **正式模式下的测试单会真扣钱** —— 一颗写着「跑一笔 ¥0.01 测试单」的按钮
 *    在正式模式下是真的会扣 1 分钱 ⇒ 服务端必须要求**显式确认**。
 * 4. **密钥不进浏览器** —— 正式模式那一档的 `values` 必须强制为空。
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

const ACTIONS = "src/features/payments/admin/actions.ts";
const TYPES = "src/features/payments/admin/types.ts";
const VIEW =
  "src/features/payments/admin/components/payment-settings-admin-view.tsx";
const ADMIN_PAGE = "src/app/[locale]/(admin)/admin/payment-settings/page.tsx";
const MIGRATION = "scripts/apply-payment-setting-schema.ts";
const SCHEMA = "src/db/schema.ts";
/** 共享的 1 分钱自检单(后台按钮 + 命令行自检都 import 它) */
const TEST_ORDER = "src/features/payments/lib/test-order.ts";
/** 命令行自检脚本 */
const CHECK_SCRIPT = "scripts/payment-sandbox-check.ts";

/** 两个通道的全部字段(表单 / 缺字段诊断 / 写入全靠这一份清单) */
const ALL_FIELDS = [
  ...allChannelFields(WECHAT_REQUIREMENTS),
  ...allChannelFields(ALIPAY_REQUIREMENTS),
];

describe("支付设置:后台那一页", () => {
  it("路由在 /admin/payment-settings", () => {
    const src = read(ADMIN_PAGE);
    expect(src).toContain("PaymentSettingsAdminView");
    // RSC 只渲染视图,鉴权由父 layout 守(注释里提到 checkAdmin 不算)
    expect(stripComments(src)).not.toContain("checkAdmin(");
  });

  it("侧边栏登记了这一项(导航 + 标题映射)", () => {
    const nav = read("src/config/nav.ts");
    expect(nav).toContain("/admin/payment-settings");
    expect(nav).toContain("CreditCard");

    const sidebar = read("src/features/admin/components/admin-sidebar.tsx");
    expect(sidebar).toContain("nav.paymentSettings");
  });

  it("配置界面在页面上直接处理,不开弹窗", () => {
    // 工作室的口味(跟打印定价 / 优惠码 / 站点设置后台一个路子)
    const src = stripComments(read(VIEW));
    expect(src).not.toContain("<Modal");
    expect(src).not.toContain("<Dialog");
    expect(src).not.toContain("Modal.");
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
    expect(src).toContain("DELETE_FAILED");
    expect(src).toContain("TEST_NOT_CONFIGURED");
    expect(src).toContain("TEST_MODE_INVALID");
    expect(src).toContain("TEST_NEEDS_PRODUCTION_CONFIRM");
    expect(src).toContain("TEST_PROVIDER_FAILED");
  });

  it("保存完要作废缓存 + 刷路由", () => {
    // 漏了任一样 ⇒ 工作室改完刷新看到旧值
    const src = read(ACTIONS);
    expect(src).toContain("revalidateTag");
    expect(src).toContain("revalidatePath");
    expect(src).toContain("{ expire: 0 }");
    expect(src).toContain('revalidatePath("/[locale]", "layout")');
  });

  it("「use server」文件**不 re-export 类型**", () => {
    // Turbopack 会把类型 re-export 注册成 server action → 运行时 ReferenceError
    // → 整个页面 500(见 src/test/repo/pure/use-server-exports.test.ts)
    const src = read(ACTIONS);
    expect(src).not.toMatch(/^\s*export\s+type\s*\{/m);
    expect(src).not.toMatch(/^\s*export\s*\*\s*from/m);
    // 类型住在纯类型模块里
    expect(read(TYPES)).toContain("AdminPaymentSettingsView");
  });

  it("DB 表建在 schema 里", () => {
    const src = read(SCHEMA);
    expect(src).toContain("paymentSetting");
    expect(src).toContain("payment_setting");
  });
});

describe("支付设置:保存的口径", () => {
  it("两个开关**必填、没有默认值** —— 漏传不能默默切正式", () => {
    // 「默默当正式」= **真收钱**;「默默当沙箱」= 白测一次。两种都不能猜。
    const src = read(ACTIONS);
    expect(src).toContain("wechatSandboxEnabled: z.boolean()");
    expect(src).toContain("alipaySandboxEnabled: z.boolean()");
    expect(src).not.toContain("wechatSandboxEnabled: z.boolean().default");
    expect(src).not.toContain("alipaySandboxEnabled: z.boolean().default");
  });

  it('开关永远写 —— 存的是 "true" / "false"', () => {
    const src = read(ACTIONS);
    expect(src).toContain(
      'value: parsedInput.wechatSandboxEnabled ? "true" : "false"'
    );
    expect(src).toContain(
      'value: parsedInput.alipaySandboxEnabled ? "true" : "false"'
    );
  });

  it("**密钥留空 = 保持原值**(不是清空)", () => {
    const src = read(ACTIONS);
    // 密钥分支里必须有一句「空串就跳过」
    expect(src).toMatch(
      /if\s*\(field\.secret\)\s*\{[\s\S]{0,400}?if\s*\(trimmed\s*===\s*""\)\s*continue;/
    );
  });

  it("**非密钥留空 = 清空**(退回默认值)", () => {
    const src = read(ACTIONS);
    // 非密钥分支必须把空串写进去
    expect(src).toContain("writes.push({ key: field.key, value: trimmed });");
  });

  it("表单没带这一项 ⇒ 不动它(不是清空)", () => {
    const src = read(ACTIONS);
    expect(src).toMatch(/if\s*\(raw\s*===\s*undefined\)\s*continue;/);
  });

  it("PEM 在**写入时**就规范化 —— 各用各通道那份实现", () => {
    const src = read(ACTIONS);
    expect(src).toContain("normalizeWechatPem");
    expect(src).toContain("normalizeAlipayPem");
    expect(src).toContain("PEM_NORMALIZERS");
  });

  it("白名单在代码里 —— 只认 `FieldGroup` 那一份清单", () => {
    const src = read(ACTIONS);
    expect(src).toContain("ALL_FIELD_GROUPS");
    expect(src).toContain("allChannelFields(WECHAT_REQUIREMENTS)");
    expect(src).toContain("allChannelFields(ALIPAY_REQUIREMENTS)");
  });

  it("删行是**按键**的 —— 想清空一个密钥走这条路", () => {
    const src = read(ACTIONS);
    expect(src).toContain("adminDeletePaymentSettingAction");
    expect(src).toContain("deletePaymentSetting(parsedInput.key)");
    expect(src).toContain("ALL_PAYMENT_SETTING_KEYS");
  });
});

describe("支付设置:密钥不进浏览器", () => {
  it("正式模式那一档的 `values` 强制为空", () => {
    // 生产环境变量的原文**不发到浏览器** —— 那一档只需要「配好了没 /
    // 缺哪几个 / 掩码」这些信息。
    const src = read(ACTIONS);
    // 第三个参数是通知地址那一档(2026-11-14 加的)⇒ 这两条断言只锁前两个
    expect(src).toMatch(/toModeView\(runtime\.production,\s*false/);
    expect(src).toMatch(/toModeView\(runtime\.sandbox,\s*true/);
    expect(src).toMatch(
      /const values = exposeValues \? status\.values : \{\};/
    );
  });

  it("密钥字段的 `value` 永远是空串", () => {
    const src = read(ACTIONS);
    expect(src).toContain(
      'value: field.secret ? "" : (values[field.key] ?? "")'
    );
  });

  it("表单预填时密钥留空(原文没回来)", () => {
    const src = read(VIEW);
    expect(src).toContain(
      'values[field.key] = field.secret ? "" : (field.value ?? "")'
    );
  });

  it("密钥只显示掩码", () => {
    // PEM 显示「已配置(RSA PRIVATE KEY)」,别的显示「已配置(…abcd)」
    const src = read("src/features/payments/lib/sandbox.ts");
    expect(src).toContain("maskSecret");
    expect(src).toContain("RSA PRIVATE KEY");
  });
});

describe("支付设置:通知地址一眼看得出对不对", () => {
  it("生效通知地址走**纯函数**那一层解析", () => {
    // 诊断逻辑在 `lib/notify-url.ts`(零 import)⇒ 能进 unit project 跑单测
    const src = read(ACTIONS);
    expect(src).toContain('from "../lib/notify-url"');
    expect(src).toContain("resolveNotifyUrl({");
  });

  it("两个通道各用各的通知路径", () => {
    const src = read(ACTIONS);
    expect(src).toContain("ALIPAY_NOTIFY_PATH");
    expect(src).toContain("WECHAT_PAY_NOTIFY_PATH");
  });

  it("通知地址**不从环境变量里漏出去** —— 只给解析结果", () => {
    // 通知地址不是密钥,但它会暴露站点地址 ⇒ 照样只在解析结果里给
    const src = read(ACTIONS);
    expect(src).toContain("notifyUrl: diagnosis.notifyUrl");
    expect(src).toContain("notifyUrlSource: diagnosis.source");
    expect(src).toContain("notifyUrlProblems: diagnosis.problems");
  });

  it("界面把通知地址摆出来 —— 有问题就报,没问题也说一声", () => {
    const src = read(VIEW);
    expect(src).toContain("channel.notifyUrl");
    expect(src).toContain("channel.notifyUrlProblems");
    expect(src).toContain("notifyUrlProblem");
  });

  it("有问题 ⇒ 页面顶部挂一条红色横幅(两个通道都算)", () => {
    const src = stripComments(read(VIEW));
    expect(src).toContain("notifyProblems");
    expect(src).toContain("banner.notifyUrlTitle");
  });

  it("中英文文案都在", () => {
    const zh = messages("zh").AdminPaymentSettings as {
      banner: Record<string, unknown>;
      status: Record<string, unknown>;
    };
    const en = messages("en").AdminPaymentSettings as {
      banner: Record<string, unknown>;
      status: Record<string, unknown>;
    };
    for (const key of ["notifyUrlTitle", "notifyUrlDetail"]) {
      expect(zh.banner[key], `zh 缺 banner.${key}`).toBeTruthy();
      expect(en.banner[key], `en 缺 banner.${key}`).toBeTruthy();
    }
    for (const key of [
      "notifyUrl",
      "notifyUrlMissing",
      "notifyUrlSource",
      "notifyUrlSourceExplicit",
      "notifyUrlSourceSite",
      "notifyUrlSourceNone",
      "siteUrl",
      "notifyUrlOk",
    ]) {
      expect(zh.status[key], `zh 缺 status.${key}`).toBeTruthy();
      expect(en.status[key], `en 缺 status.${key}`).toBeTruthy();
    }
  });

  it("四个问题码两种语言都摆得上话", () => {
    // 问题码是**大写**的(`NotifyUrlProblem` 联合类型)—— 跟 `keyProblem.*`
    // 那套小写的不一样。
    const zh = messages("zh").AdminPaymentSettings as {
      status: { notifyUrlProblem: Record<string, unknown> };
    };
    const en = messages("en").AdminPaymentSettings as {
      status: { notifyUrlProblem: Record<string, unknown> };
    };
    for (const code of [
      "MISSING",
      "INVALID_URL",
      "NOT_HTTPS",
      "LOCAL_ADDRESS",
    ]) {
      expect(zh.status.notifyUrlProblem[code], `zh 缺 ${code}`).toBeTruthy();
      expect(en.status.notifyUrlProblem[code], `en 缺 ${code}`).toBeTruthy();
    }
    expect(Object.keys(en.status.notifyUrlProblem).sort()).toEqual(
      Object.keys(zh.status.notifyUrlProblem).sort()
    );
  });
});

describe("支付设置:测试单", () => {
  it("走**生产的同一条代码路径**(`provider.createSession()`)", () => {
    // 另写一份「测试实现」等于什么都没验 —— 签名拼错了、端点拼错了,
    // 那份「测试实现」照样能跑通。
    const src = read(ACTIONS);
    expect(src).toContain("provider.createSession(request)");
    expect(src).toContain("getPaymentProvider(channel)");
  });

  it("这一笔是 **1 分钱**", () => {
    // 金额住在**共享的那一份**里(`lib/test-order.ts`)—— 后台按钮和命令行自检
    // 必须建出同一笔单子,各写一份的话两边表现不一致时根本分不清是凭据的
    // 问题还是单子本身的问题。
    const src = read(TEST_ORDER);
    expect(src).toContain("unitPriceCents: 1");
    expect(src).toContain("shippingCents: 0");
  });

  it("后台按钮跟命令行自检**共用同一份**自检单", () => {
    // 两处都 import 那一份 —— 不许各写一份订单号 / 金额
    expect(read(ACTIONS)).toContain("buildTestPaymentRequest");
    expect(read(CHECK_SCRIPT)).toContain("buildTestPaymentRequest");
  });

  it("**不落本地订单** —— 只在平台上建单", () => {
    const src = read(ACTIONS);
    // 写进去就是一张永远不发货的僵尸单
    expect(src).not.toContain("storefrontOrder");
    expect(src).not.toContain("insert(");
  });

  it("正式模式 ⇒ 要**显式确认**才真跑", () => {
    const src = read(ACTIONS);
    expect(src).toContain("allowProduction: z.boolean().default(false)");
    expect(src).toMatch(
      /runtime\.mode === "production" && !parsedInput\.allowProduction[\s\S]{0,200}?TEST_NEEDS_PRODUCTION_CONFIRM/
    );
  });

  it("开关的值认不出来 ⇒ **不猜**", () => {
    const src = read(ACTIONS);
    expect(src).toMatch(
      /if\s*\(runtime\.modeInvalid\)[\s\S]{0,200}?TEST_MODE_INVALID/
    );
  });

  it("缺字段 ⇒ 重试没用,得先把凭据配上", () => {
    const src = read(ACTIONS);
    expect(src).toMatch(
      /if\s*\(!runtime\.canTransact\)[\s\S]{0,300}?TEST_NOT_CONFIGURED/
    );
  });

  it("返回微信的 `code_url` 和支付宝的**完整跳转地址**", () => {
    const src = read(ACTIONS);
    expect(src).toContain("qrCodeUrl: session.qrCodeUrl");
    expect(src).toContain("redirectUrl: session.redirectUrl");
  });

  it("界面把两个结果都摆出来(码 + 跳转地址)", () => {
    const src = read(VIEW);
    expect(src).toContain("PaymentQrCode");
    expect(src).toContain("result.qrCodeUrl");
    expect(src).toContain("result.redirectUrl");
    // 跳转地址能直接贴到浏览器里打开
    expect(src).toContain('target="_blank"');
    expect(src).toContain('rel="noopener noreferrer"');
  });

  it("正式模式的确认是**就地展开**的一小块(仍然不弹窗)", () => {
    const src = stripComments(read(VIEW));
    expect(src).not.toContain("<Modal");
    expect(src).not.toContain("<Dialog");
    expect(src).toContain("needsConfirm");
  });
});

describe("支付设置:字段清单只有一份", () => {
  it("表单 / 缺字段诊断 / 写入全靠 `FieldGroup` 那一份", () => {
    const src = read(ACTIONS);
    expect(src).toContain("allChannelFields(WECHAT_REQUIREMENTS)");
    expect(src).toContain("allChannelFields(ALIPAY_REQUIREMENTS)");
  });

  it("每个字段都有 DB 键 / 环境变量名 / 标签", () => {
    for (const field of ALL_FIELDS) {
      expect(field.key).toBeTruthy();
      expect(field.envVar).toBeTruthy();
      expect(field.label).toBeTruthy();
    }
  });

  it("沙箱字段的键**都带 `_sandbox_`** —— 两套命名空间完全不相干", () => {
    // 半配置不会变成「一半沙箱一半正式」的混合签名
    for (const field of ALL_FIELDS) {
      expect(field.key).toContain("_sandbox_");
    }
  });
});

describe("支付设置:沙箱字段**只在开关拨到「开」的时候才出现**", () => {
  it("判定是纯函数 —— `undefined` 按「关」处理", () => {
    // 工作室 2026-11-14 的原话:「开启后才展示沙箱字段内容,而不是全部直接
    // 展示」/「关闭后不展示」。
    expect(shouldShowSandboxFields(true)).toBe(true);
    expect(shouldShowSandboxFields(false)).toBe(false);
    // 首帧 `useWatch` 返回 undefined(字段还没注册)⇒ 按「关」
    expect(shouldShowSandboxFields(undefined)).toBe(false);
  });

  it("视图**盯着那口开关** —— 用 `useWatch`,不是自己存一份状态", () => {
    const src = read(VIEW);
    expect(src).toContain("Form.useWatch(channelKey, form)");
    expect(src).toContain("shouldShowSandboxFields(");
  });

  it("字段块**整个**挂在开关上 —— 关着的时候那些输入框压根不在页面上", () => {
    const src = stripComments(read(VIEW));
    // 三元:`{sandboxOn ? ( 字段块 ) : ( 一句说明 )}`
    expect(src).toContain("{sandboxOn ? (");
    expect(src).toContain('t("form.productionOnly")');
    // 「删掉这一行」按钮也在字段块里 ⇒ 关着的时候那个按钮同样不出现
    const fieldsBlock = src.slice(src.indexOf("{sandboxOn ? ("));
    expect(fieldsBlock).toContain("fields.map((field) => (");
    expect(fieldsBlock).toContain("actions.deleteRow");
  });

  it("两个通道都把 form 实例传下去(不然 watch 不到)", () => {
    const src = stripComments(read(VIEW));
    // `<Form form={form} …>` 是外层那一个(本来就有的)⇒ 这里只数
    // **传给 `<ChannelForm>` 的**那两个 —— 少了任何一个,那个通道就 watch 不到开关。
    const passed = src.match(/<ChannelForm[\s\S]{0,400}?form=\{form\}/g) ?? [];
    expect(passed.length).toBe(2);
    // 两个通道都在里面
    expect(src).toMatch(
      /channelKey="wechatSandboxEnabled"[\s\S]{0,400}?form=\{form\}/
    );
    expect(src).toMatch(
      /channelKey="alipaySandboxEnabled"[\s\S]{0,400}?form=\{form\}/
    );
  });

  it("**关掉不删数据** —— 表单里没有的键,服务端直接跳过", () => {
    // 藏起来的字段不进提交体 ⇒ 服务端拿到 `undefined` ⇒ 那行沙箱配置不动
    const actions = read(ACTIONS);
    expect(actions).toMatch(/if\s*\(raw\s*===\s*undefined\)\s*continue;/);
    // 开关本身**永远写** ⇒ 「关」这个状态是存下来的,不是靠界面推断
    expect(actions).toContain(
      'value: parsedInput.wechatSandboxEnabled ? "true" : "false"'
    );
    expect(actions).toContain(
      'value: parsedInput.alipaySandboxEnabled ? "true" : "false"'
    );
  });

  it("「关着」那句话两种语言都有", () => {
    const zh = messages("zh").AdminPaymentSettings as {
      form: Record<string, unknown>;
    };
    const en = messages("en").AdminPaymentSettings as {
      form: Record<string, unknown>;
    };
    expect(zh.form.productionOnly).toBeTruthy();
    expect(en.form.productionOnly).toBeTruthy();
    // form 命名空间的 key 集也一致
    expect(Object.keys(en.form).sort()).toEqual(Object.keys(zh.form).sort());
  });
});

describe("支付设置:迁移脚本", () => {
  it("脚本在仓库里,幂等,不播种任何一行", () => {
    const src = read(MIGRATION);
    expect(src).toContain("CREATE TABLE IF NOT EXISTS");
    expect(src).toContain('"payment_setting"');
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
    expect(pkg.scripts["migrate:apply-payment-setting"]).toContain(
      "apply-payment-setting-schema.ts"
    );
  });
});

describe("支付设置:i18n", () => {
  it("中英文 key 一致", () => {
    const zh = messages("zh").AdminPaymentSettings as Record<string, unknown>;
    const en = messages("en").AdminPaymentSettings as Record<string, unknown>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  it("**每个字段都有中英文标签**", () => {
    const zh = messages("zh").AdminPaymentSettings as {
      fields: Record<string, unknown>;
    };
    const en = messages("en").AdminPaymentSettings as {
      fields: Record<string, unknown>;
    };
    for (const field of ALL_FIELDS) {
      expect(zh.fields[field.key], `zh 缺 ${field.key}`).toBeTruthy();
      expect(en.fields[field.key], `en 缺 ${field.key}`).toBeTruthy();
    }
    // 字段清单里的字段**一个都不多**
    expect(Object.keys(zh.fields).sort()).toEqual(
      ALL_FIELDS.map((f) => f.key).sort()
    );
  });

  it("十个错误码两种语言都摆得上话", () => {
    const zh = messages("zh").AdminPaymentSettings as {
      errors: Record<string, unknown>;
    };
    const en = messages("en").AdminPaymentSettings as {
      errors: Record<string, unknown>;
    };
    for (const code of [
      "INVALID_INPUT",
      "MIGRATION_MISSING",
      "LOAD_FAILED",
      "SAVE_FAILED",
      "DELETE_FAILED",
      "TEST_CHANNEL_UNSUPPORTED",
      "TEST_NOT_CONFIGURED",
      "TEST_MODE_INVALID",
      "TEST_NEEDS_PRODUCTION_CONFIRM",
      "TEST_PROVIDER_FAILED",
    ]) {
      expect(zh.errors[code], `zh 缺 ${code}`).toBeTruthy();
      expect(en.errors[code], `en 缺 ${code}`).toBeTruthy();
    }
  });

  it("侧边栏标题两种语言都有", () => {
    const zh = messages("zh").AdminSidebar as {
      nav: Record<string, unknown>;
    };
    const en = messages("en").AdminSidebar as {
      nav: Record<string, unknown>;
    };
    expect(zh.nav.paymentSettings).toBeTruthy();
    expect(en.nav.paymentSettings).toBeTruthy();
  });
});
