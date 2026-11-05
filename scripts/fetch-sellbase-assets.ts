#!/usr/bin/env -S npx tsx

/**
 * 取 Sellbase 的 Edge Function 包(2026-11-04)
 *
 * ## 为什么需要这个脚本
 *
 * `supabase/functions/` 下那三个 Edge Function 是 **Sellbase 编译好的产物**
 * (`sellbase-api` / `sellbase-webhooks` / `sellbase-jobs`),从 npm 的
 * `sellbase` 包里原样搬过来的 —— 一共 **12 MB** 的压缩过的 JS。
 *
 * 它们**不入库**(`supabase/functions/` 在 `.gitignore` 里):既不是本仓库
 * 写的代码,也不该占仓库体积。要部署的时候跑一次本脚本拉回来就行。
 *
 * 入库的是 `supabase/migrations/*.sql` —— 迁移是数据库状态的唯一真相,
 * 必须跟着仓库走。
 *
 * ## 版本跟谁对齐
 *
 * 跟 **`@sellbase/sdk`** 对齐 —— SDK 是本仓库真正 import 的东西,
 * 边函数是它调的那一端。两边版本对不上会出现「SDK 发的新字段边函数不认」。
 * 所以默认从 `node_modules/@sellbase/sdk/package.json` 读版本号。
 *
 * ## 跑法
 *
 * ```bash
 * pnpm tsx scripts/fetch-sellbase-assets.ts              # 用 SDK 的版本
 * pnpm tsx scripts/fetch-sellbase-assets.ts --version 0.3.3
 * ```
 *
 * 跑完 `supabase/functions/<name>/index.js` 就在位,可以
 * `supabase functions deploy sellbase-api --no-verify-jwt`。
 *
 * ## 顺带打两个补丁
 *
 * 1. **token 前缀**:把 bundle 里的 `BRAND.tokenPrefix` 从 `sb_live_` 改成
 *    `mooncoda_live_` —— Sellbase 默认的 `sb_` 前缀撞了 Supabase 自己的
 *    API key 命名空间,网关会在进函数之前就把请求 401 掉。细节和踩坑记录见
 *    `scripts/lib/sellbase-token.ts`。
 * 2. **Stripe 支付方式**:把 `payment_method_types: ["card"]` 扩成
 *    `["card", "alipay", "wechat_pay"]`,并给微信补上
 *    `payment_method_options[wechat_pay][client] = "web"`。
 *
 * 补丁**每次取回都重打一遍**,所以升级 Sellbase 版本不会漏。
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import { SELLBASE_TOKEN_PREFIX } from "./lib/sellbase-token";

/** 要拉的三个 Edge Function */
const FUNCTIONS = [
  "sellbase-api",
  "sellbase-webhooks",
  "sellbase-jobs",
] as const;

/**
 * 额外的 Stripe 支付方式 —— 环境变量名
 *
 * 跟账号所在地区有关,不是一份写死的清单:香港的 Stripe 账号支持微信支付
 * 和支付宝,别的地区不一定支持 —— Stripe 会拒收**没有开通**的支付方式,
 * 而且是整个 Checkout Session 建不出来(连银行卡也一起挂)。
 *
 * 所以这个清单**可配**:想关就把它设成空串,重新取一次 + 重新部署。
 */
const PAYMENT_METHODS_ENV = "SELLBASE_STRIPE_PAYMENT_METHODS";

/** 仓库里放它们的地方 */
const OUT_DIR = resolve(process.cwd(), "supabase", "functions");

/** `--version 0.3.3` → "0.3.3";没给就返回 null */
function readVersionFlag(): string | null {
  const index = process.argv.indexOf("--version");
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
}

/**
 * `--patch-only` → 只重打补丁,不重新下载
 *
 * 改了支付方式清单(或者换了 token 前缀)之后,只想把补丁重打一遍,不想再从
 * npm 拉 12 MB 的 bundle —— 这个模式就是干这个的。
 */
function readPatchOnlyFlag(): boolean {
  return process.argv.includes("--patch-only");
}

/** 跟 `@sellbase/sdk` 对齐 —— 边函数是它调的那一端 */
function readSdkVersion(): string {
  const pkgPath = resolve(
    process.cwd(),
    "node_modules/@sellbase/sdk/package.json"
  );
  if (!existsSync(pkgPath)) {
    throw new Error(
      "找不到 node_modules/@sellbase/sdk —— 先 pnpm install(或用 --version 指定版本)"
    );
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

/**
 * 找到能用的 npm
 *
 * Windows 上有两个坑:
 * 1. `pnpm tsx` 跑的时候 PATH 里**没有** npm(会被 ENOENT)
 * 2. Node 20 之后 `execFileSync` 不带 shell 直接 spawn `.cmd` 会 EINVAL
 *
 * 所以走 npm 自带的 js 入口 `npm-cli.js`,用 node 自己跑 —— 不依赖 PATH,
 * 也不碰 `.cmd` 的 shell 限制。
 */
function packCommand(): { cmd: string; args: string[] } {
  const cli = join(
    dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js"
  );
  if (existsSync(cli)) {
    return { cmd: process.execPath, args: [cli] };
  }
  // 非标准 node 安装(比如 nvm)退回裸 npm
  return { cmd: "npm", args: [] };
}

/** npm pack:下 tarball 到临时目录,返回 tarball 路径 */
function npmPack(version: string, dest: string): string {
  const { cmd, args } = packCommand();
  const stdout = execFileSync(
    cmd,
    [
      ...args,
      "pack",
      `sellbase@${version}`,
      "--pack-destination",
      dest,
      "--silent",
    ],
    { encoding: "utf8" }
  );
  const name = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!name) throw new Error(`npm pack 没产出文件名:\n${stdout}`);
  return join(dest, name);
}

/**
 * 从 tarball 里取出指定的文件
 *
 * 自己解 tar,不用外部 `tar` 命令 —— Windows 上 GNU tar 会把 `C:\…` 当成
 * 「远程主机:路径」(`Cannot connect to C: resolve failed`),macOS 的 bsdtar
 * 又是另一套行为。tar 格式本身很简单(512 字节头 + 数据块),自己读反而
 * 跨平台一致。
 *
 * @param tarball  .tgz 路径
 * @param wanted   tarball 内路径 → 本地落盘路径
 */
function extractFromTarball(
  tarball: string,
  wanted: Record<string, string>
): void {
  const buf = gunzipSync(readFileSync(tarball));
  const BLOCK = 512;

  for (let offset = 0; offset + BLOCK <= buf.length; ) {
    const header = buf.subarray(offset, offset + BLOCK);

    // 全零块 = tar 结束
    if (header.every((byte) => byte === 0)) break;

    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = Number.parseInt(
      header
        .subarray(124, 136)
        .toString("ascii")
        .replace(/[^0-7]/g, ""),
      8
    );
    const typeFlag = String.fromCharCode(header[156]);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;

    // 只认普通文件(typeflag '0');目录 / 符号链接都跳过
    if (typeFlag === "0" || typeFlag === "\0") {
      const dest = wanted[name];
      if (dest) {
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, buf.subarray(dataStart, dataEnd));
      }
    }

    // 数据块按 512 对齐
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }
}

/**
 * 把 bundle 里的 token 前缀改成我们的
 *
 * Sellbase 默认的 `sb_live_` 撞了 Supabase 自己的 API key 命名空间 ——
 * 网关会在进函数之前把 `Authorization: Bearer sb_…` 当成 Supabase API key
 * 查表,查不到就 401,函数里的代码根本没机会跑。细节见
 * `scripts/lib/sellbase-token.ts`。
 *
 * `BRAND.tokenPrefix` 是 bundle 里的一个字面量,它的三处用途(鉴权闸门 /
 * 生成 token / 错误文案)都读同一个变量 —— 改这一处就全改对了。
 *
 * 断言「每个 bundle 正好改到 1 处」:改不到(上游改了结构)或者改到多处
 * (上游又加了别的地方)都直接报错退出 —— 宁可停下,也不要部署一个前缀
 * 半对半错的 bundle。
 */
function patchTokenPrefix(file: string): void {
  const needle = 'tokenPrefix: "sb_live_"';
  const replacement = `tokenPrefix: "${SELLBASE_TOKEN_PREFIX}"`;

  const source = readFileSync(file, "utf8");

  // 已经打过补丁了 —— 幂等,`--patch-only` 重跑不报错
  if (source.includes(replacement)) return;

  const hits = source.split(needle).length - 1;

  if (hits !== 1) {
    throw new Error(
      `${file}: 期望正好改到 1 处 \`${needle}\`,实际 ${hits} 处 —— ` +
        "上游 bundle 结构变了,补丁要跟着改(别硬来)"
    );
  }

  writeFileSync(file, source.replace(needle, replacement), "utf8");
}

/**
 * 读额外支付方式清单
 *
 * 没设这个环境变量 = 用默认的 `alipay,wechat_pay`(工作室要收微信和支付宝)。
 * 设成空串 = 什么都不加,只留银行卡。
 */
function readExtraPaymentMethods(): string[] {
  const raw = process.env[PAYMENT_METHODS_ENV];
  if (raw === undefined) return ["alipay", "wechat_pay"];
  return raw
    .split(",")
    .map((method) => method.trim())
    .filter(Boolean);
}

/**
 * 把 Stripe 的支付方式扩成「银行卡 + 微信 + 支付宝」
 *
 * ## 为什么改 bundle 而不是改配置
 *
 * Sellbase 的 `createCheckout()` 把 `payment_method_types: ["card"]` **写死**
 * 在 bundle 里 —— 没有 store 级的配置项,`supportedMethods(country)` 也是
 * 硬编码的常量。想在收银台里出「微信支付 / 支付宝」,只能改 bundle。
 *
 * 改的位置在 `scripts/fetch-sellbase-assets.ts` 里 —— 每次取回都重打一遍,
 * 所以升级 Sellbase 版本不会漏(不会像「手工改 dist」那样被覆盖掉)。
 *
 * ## 为什么微信要额外给 `payment_method_options`
 *
 * Stripe 的微信支付在 Checkout Session 里必须显式指定客户端类型
 * (`client`)。我们走的是**网页跳转**(`mode: "redirect"`),所以是
 * `web`;`mobile` 是给小程序 / App 的原生 SDK 用的,配错了会直接报错。
 *
 * 支付宝不需要 options。
 *
 * ## 微信 + 支付宝对 CNY 的支持
 *
 * Stripe 的微信支付 / 支付宝都支持 CNY 结算 —— 这一点实测过(测试模式
 * 建 Session 成功)。但**用户所在地区**有要求(微信 / 支付宝各有支持的国家
 * 列表),这是 Stripe 那边按付款人所在地判的,不是我们能配的。
 *
 * ## 改了之后要做什么
 *
 * 改完只是 bundle 变了,还要:
 *
 * 1. `supabase functions deploy sellbase-api --no-verify-jwt`
 * 2. 在 Stripe Dashboard 里**开通**这些支付方式(Settings → Payment
 *    methods)—— 测试模式能用不代表线上能用
 */
function patchStripePaymentMethods(file: string, extra: string[]): void {
  const source = readFileSync(file, "utf8");

  const allMethods = ["card", ...extra.filter((m) => m !== "card")];
  const methodsLiteral = allMethods.map((m) => `"${m}"`).join(", ");

  // ① `payment_method_types` —— 真正决定收银台出哪些支付方式
  const typeMatch = source.match(
    /^([ \t]*)payment_method_types: \["card"\],$/m
  );

  if (!typeMatch) {
    // 已经打过补丁了 —— 幂等,`--patch-only` 重跑不报错
    if (source.includes(`payment_method_types: [${methodsLiteral}],`)) return;
    throw new Error(
      `${file}: 找不到 \`payment_method_types: ["card"]\` —— ` +
        "上游 bundle 结构变了,补丁要跟着改(别硬来)"
    );
  }

  const indent = typeMatch[1] ?? "";
  let replacement = `payment_method_types: [${methodsLiteral}],`;
  // 微信必须有 client —— 网页跳转是 "web",小程序 / App 才是 "mobile"
  if (extra.includes("wechat_pay")) {
    replacement +=
      `\n${indent}payment_method_options: { wechat_pay: { client: "web" } },`;
  }

  let patched = source.replace(typeMatch[0], `${indent}${replacement}`);

  // ② `supportedMethods` —— 报告给前端的「支持哪些方式」。目前 bundle 里
  //    没有调用点,但上游哪天接上了就会用这份清单,一起改掉省得返工。
  const supportedNeedle = 'country === "MX" ? ["card", "oxxo"] : ["card"]';
  if (patched.includes(supportedNeedle)) {
    const extraLiteral = extra.map((m) => `"${m}"`).join(", ");
    const fallback = `["card"${extraLiteral ? `, ${extraLiteral}` : ""}]`;
    patched = patched.replace(
      supportedNeedle,
      `country === "MX" ? ["card", "oxxo"] : ${fallback}`
    );
  }

  writeFileSync(file, patched, "utf8");
}

function main(): void {
  const patchOnly = readPatchOnlyFlag();
  const version = readVersionFlag() ?? readSdkVersion();
  console.log(`[fetch-sellbase] 版本:${version}`);

  const extraMethods = readExtraPaymentMethods();
  console.log(
    `[fetch-sellbase] Stripe 支付方式:card${
      extraMethods.length > 0 ? ` + ${extraMethods.join(" + ")}` : "(只有银行卡)"
    }`
  );

  const tmp = patchOnly ? null : mkdtempSync(join(tmpdir(), "sellbase-assets-"));
  try {
    if (tmp) {
      const tarball = npmPack(version, tmp);
      console.log(`[fetch-sellbase] 已下载 ${tarball}`);

      // tarball 里的路径是 package/assets/functions/<fn>/index.js
      const wanted: Record<string, string> = {};
      for (const fn of FUNCTIONS) {
        wanted[`package/assets/functions/${fn}/index.js`] = join(
          OUT_DIR,
          fn,
          "index.js"
        );
      }
      extractFromTarball(tarball, wanted);
    } else {
      console.log("[fetch-sellbase] --patch-only:只重打补丁,不重新下载");
    }

    for (const fn of FUNCTIONS) {
      const file = join(OUT_DIR, fn, "index.js");
      if (!existsSync(file)) {
        throw new Error(`${fn}/index.js 没从 tarball 里取出来`);
      }

      // 改 token 前缀(见 patchTokenPrefix 的注释)
      patchTokenPrefix(file);

      // 扩 Stripe 支付方式(见 patchStripePaymentMethods 的注释)
      patchStripePaymentMethods(file, extraMethods);

      const bytes = readFileSync(file);
      const hash = createHash("sha256")
        .update(bytes)
        .digest("hex")
        .slice(0, 12);
      console.log(
        `[fetch-sellbase] ✅ ${fn}/index.js (${(bytes.length / 1024 / 1024).toFixed(1)} MB, sha256:${hash}, 前缀已改成 ${SELLBASE_TOKEN_PREFIX})`
      );
    }

    console.log(
      "\n[fetch-sellbase] 现在可以部署了:\n" +
        "  supabase functions deploy sellbase-api sellbase-webhooks sellbase-jobs --no-verify-jwt"
    );
    if (extraMethods.length > 0) {
      console.log(
        "\n[fetch-sellbase] ⚠️  别忘了在 Stripe Dashboard 里开通这些支付方式" +
          "(Settings → Payment methods)。测试模式能用 ≠ 线上能用。"
      );
    }
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error("\n[fetch-sellbase] 失败:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
