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
 * ## 顺带打一个补丁
 *
 * 取回之后会把 bundle 里的 `BRAND.tokenPrefix` 从 `sb_live_` 改成
 * `mooncoda_live_` —— Sellbase 默认的 `sb_` 前缀撞了 Supabase 自己的
 * API key 命名空间,网关会在进函数之前就把请求 401 掉。细节和踩坑记录见
 * `scripts/lib/sellbase-token.ts`。
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

/** 仓库里放它们的地方 */
const OUT_DIR = resolve(process.cwd(), "supabase", "functions");

/** `--version 0.3.3` → "0.3.3";没给就返回 null */
function readVersionFlag(): string | null {
  const index = process.argv.indexOf("--version");
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : null;
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
  const hits = source.split(needle).length - 1;

  if (hits !== 1) {
    throw new Error(
      `${file}: 期望正好改到 1 处 \`${needle}\`,实际 ${hits} 处 —— ` +
        "上游 bundle 结构变了,补丁要跟着改(别硬来)"
    );
  }

  writeFileSync(file, source.replace(needle, replacement), "utf8");
}

function main(): void {
  const version = readVersionFlag() ?? readSdkVersion();
  console.log(`[fetch-sellbase] 版本:${version}`);

  const tmp = mkdtempSync(join(tmpdir(), "sellbase-assets-"));
  try {
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

    for (const fn of FUNCTIONS) {
      const file = join(OUT_DIR, fn, "index.js");
      if (!existsSync(file)) {
        throw new Error(`${fn}/index.js 没从 tarball 里取出来`);
      }

      // 改 token 前缀(见 patchTokenPrefix 的注释)
      patchTokenPrefix(file);

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
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error("\n[fetch-sellbase] 失败:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
