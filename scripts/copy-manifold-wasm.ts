/**
 * 把 manifold-3d 的 wasm 拷进 `public/`
 *
 * ## 为什么要有这个脚本
 *
 * 磁吸孔切割工具(`/tools/magnet`)的布尔运算跑在 **Manifold3D(WASM)** 上。
 * 浏览器里加载 wasm 要走 `Module({ locateFile: () => "/manifold.wasm" })`,
 * 所以那个二进制文件**必须放在 `public/` 下**才能被 HTTP 拿到。
 *
 * ## 为什么产物要提交进仓库
 *
 * 新克隆的机器上如果没人跑这个脚本,`public/manifold.wasm` 就是缺的 ⇒
 * 页面加载时 wasm 404 ⇒ 白屏。所以**产物一起提交** —— 让「克隆下来就能跑」
 * 是默认状态,而不是「记得先跑一条命令」。
 *
 * 依赖升级(改了 `package.json` 里的 `manifold-3d` 版本)之后重跑一次:
 *
 * ```bash
 * pnpm magnet:wasm
 * ```
 *
 * ## 幂等
 *
 * 拷贝是「有变化才写」,文件内容一样就不动它(免得每次都改 git 状态)。
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录(这个脚本在 `scripts/` 下) */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 源:node_modules 里那个包自带的 wasm */
const source = join(repoRoot, "node_modules", "manifold-3d", "manifold.wasm");
/** 目标:Next.js 的静态资源目录 */
const targetDir = join(repoRoot, "public");
const target = join(targetDir, "manifold.wasm");

if (!existsSync(source)) {
  console.error(
    `[magnet:wasm] 找不到 ${source}\n` +
      `  先装依赖:pnpm add manifold-3d --ignore-scripts`
  );
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });

const srcBytes = readFileSync(source);
const digest = (buf: Buffer) =>
  createHash("sha256").update(buf).digest("hex").slice(0, 16);

const existing = existsSync(target) ? readFileSync(target) : null;
if (existing?.equals(srcBytes)) {
  console.log(
    `[magnet:wasm] 已经是最新 ${target} (${srcBytes.length} 字节, sha256:${digest(srcBytes)})`
  );
  process.exit(0);
}

copyFileSync(source, target);
console.log(
  `[magnet:wasm] 已拷贝 ${srcBytes.length} 字节 → ${target}\n` +
    `  sha256:${digest(srcBytes)}`
);
