import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 命令行自检 `pnpm payment:check-sandbox`(2026-11-13)
 *
 * 工作室 2026-11-13 的要求:**「支付宝、微信支付先用沙盒测试验证」**。
 *
 * ## 为什么这个脚本值得单测
 *
 * 它是**上线前唯一一次**能自动验「凭据对不对 / 端点对不对 / 签名对不对」的
 * 工具 —— 商户资质下来之前只有沙箱能验。四条特别容易出错的:
 *
 * 1. **签名不许自己写一份** —— 脚本另写一份签名 = 「探针通了但生产签名是错的」
 *    ⇒ 那种错要等到真收钱那天才炸。所以脚本**必须 import 生产模块**,
 *    而且**不许**自己出现 `createSign` / 硬编码端点。
 * 2. **dotenv 必须排第一** —— `src/db/index.ts` 在模块顶层就查
 *    `DATABASE_URL` ⇒ `import "./lib/load-env"` 排第一,守卫排第二。
 *    顺序反了 = 用户看到一坨栈,不是一句人话。
 * 3. **微信沙箱 path 没有权威文档** —— 必须**两个候选都探**,而且靠**返回码**
 *    区分(404 = 路径不存在 ⇒ 换下一个)。
 * 4. **正式模式会真扣钱** —— 没加 `--allow-production` 必须**跳过**测试单。
 *
 * 纯文件扫描 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里**提到**那个名字不算违规(那儿恰恰要解释区别) */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

const SCRIPT = "scripts/payment-sandbox-check.ts";

/** 脚本的代码(去掉注释) */
function code(): string {
  return stripComments(read(SCRIPT));
}

describe("支付自检:脚本里绝不重新实现签名 / 拼 URL", () => {
  it("签名、端点、订单号**全部 import 生产模块**", () => {
    const src = code();
    // 端点解析
    expect(src).toContain('from "@/features/payments/lib/sandbox"');
    expect(src).toContain("resolveWechatEndpointParts");
    // 微信签名 + 发请求
    expect(src).toContain('from "@/features/payments/providers/wechat/native"');
    expect(src).toContain("postNativeOrderRequest");
    // 微信下单参数
    expect(src).toContain('from "@/features/payments/providers/wechat/env"');
    expect(src).toContain("buildWechatNativeParams");
    // 建支付会话(生产同一条代码路径)
    expect(src).toContain('from "@/features/payments/lib/registry"');
    expect(src).toContain("getPaymentProvider");
    // 1 分钱的自检单
    expect(src).toContain('from "@/features/payments/lib/test-order"');
    expect(src).toContain("buildTestPaymentRequest");
  });

  it("**不自己签名** —— 不许出现 `createSign`", () => {
    const src = code();
    expect(src).not.toContain("createSign");
    expect(src).not.toContain("node:crypto");
    expect(src).not.toContain("signWithPrivateKey");
  });

  it("**不硬编码端点** —— 端点只能从解析器拿", () => {
    const src = code();
    expect(src).not.toContain("api.mch.weixin.qq.com");
    expect(src).not.toContain("alipaydev.com");
    expect(src).not.toContain("alipay.com");
  });

  it("沙箱凭据**从 DB 读**,不读环境变量", () => {
    // 沙箱凭据住在 `payment_setting` 表 —— 脚本直接读环境变量就绕开了后台那份
    const src = code();
    expect(src).toContain("getPaymentSettingsOverview");
    expect(src).toContain("getPaymentChannelRawValues");
    expect(src).not.toContain("process.env.");
  });
});

describe("支付自检:dotenv 必须排第一", () => {
  it("`load-env` 第一,守卫第二,`@/` 的 import 排在它们后面", () => {
    const src = read(SCRIPT);
    const loadEnv = src.indexOf('import "./lib/load-env";');
    const guard = src.indexOf('import "./lib/require-database-url";');
    const aliased = src.indexOf('from "@/');

    expect(loadEnv).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(-1);
    expect(aliased).toBeGreaterThan(-1);

    // 顺序反了 = `src/db/index.ts` 在模块顶层就抛
    expect(loadEnv).toBeLessThan(guard);
    expect(guard).toBeLessThan(aliased);
  });

  it("守卫是**只有副作用**的模块(缺 DATABASE_URL 就地退出)", () => {
    const src = read("scripts/lib/require-database-url.ts");
    expect(src).toContain("DATABASE_URL");
    expect(src).toContain("process.exit(1)");
  });
});

describe("支付自检:微信路径探针", () => {
  it("**两个候选 path 都探**", () => {
    // 微信的沙箱 path 没有权威文档 —— 只探一个就是在赌
    const src = code();
    expect(src).toContain("WECHAT_SANDBOX_NATIVE_PATH");
    expect(src).toContain("WECHAT_SANDBOX_NATIVE_PATH_ALT");
    expect(src).toContain("probeCandidates");
  });

  it("靠**返回码**区分路径对不对", () => {
    const src = code();
    expect(src).toContain("res.status === 200");
    expect(src).toContain("res.status === 400");
    expect(src).toContain("res.status === 404");
    expect(src).toContain("res.status === 401");
  });

  it("404 ⇒ 换下一个候选;200/400/401 ⇒ 路径是存在的", () => {
    const src = code();
    expect(src).toContain("confirmsPath");
    expect(src).toMatch(
      /function confirmsPath[\s\S]{0,400}?"path-ok"[\s\S]{0,200}?"params"[\s\S]{0,200}?"auth"/
    );
  });

  it("最后给一行**可以直接贴进后台**的建议值", () => {
    const src = code();
    expect(src).toContain("wechat_sandbox_native_path = ");
  });

  it("探针发的是**真实签名**的真实请求", () => {
    const src = code();
    expect(src).toContain("buildWechatNativeParams");
    expect(src).toContain("postNativeOrderRequest");
    expect(src).toContain("totalCents: 1");
  });
});

describe("支付自检:正式模式不许顺手扣钱", () => {
  it("正式模式下**没加 `--allow-production` 就跳过**测试单", () => {
    const src = code();
    expect(src).toContain("--allow-production");
    expect(src).toMatch(
      /runtime\.mode === "production" && !allowProduction[\s\S]{0,300}?skipped: true/
    );
  });

  it("正式模式是**红字**「会真的扣钱」", () => {
    const src = code();
    expect(src).toContain("会真的扣钱");
    expect(src).toMatch(/red\([\s\S]{0,300}?会真的扣钱/);
  });
});

describe("支付自检:输出与退出码", () => {
  it("打印**确切端点** —— 微信连 path 一起打(path 是签名的一部分)", () => {
    const src = code();
    expect(src).toContain("确切端点");
    expect(src).toContain("签名 path");
    expect(src).toContain("path 是签名的一部分");
  });

  it("打印微信的 `code_url` 和支付宝的**完整跳转地址**", () => {
    const src = code();
    expect(src).toContain("order.qrCodeUrl");
    expect(src).toContain("order.redirectUrl");
  });

  it("退出码:全绿 0,有红 1", () => {
    const src = code();
    expect(src).toContain("return 0;");
    expect(src).toContain("return 1;");
    expect(src).toContain("process.exitCode");
  });

  it("**没有顶层 await** —— tsx 走 CJS,顶层 await 会炸", () => {
    const src = code();
    // 顶层 await = **行首**(没有缩进)的 await。函数体里的 await 当然允许。
    expect(src).not.toMatch(/^await\s/m);
    expect(src).toContain(".then((code) => exitWith(code))");
  });

  it("stdout 排空再退 —— 管道里退出不能把最后几行吞掉", () => {
    const src = code();
    expect(src).toContain("writableLength");
    expect(src).toContain('process.stdout.once("drain"');
  });
});

describe("支付自检:登记在 package.json 里", () => {
  it("`payment:check-sandbox` 指到那个脚本", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["payment:check-sandbox"]).toContain(
      "payment-sandbox-check.ts"
    );
  });
});
