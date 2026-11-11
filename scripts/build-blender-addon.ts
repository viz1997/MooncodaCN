/**
 * 把磁吸孔桥接打包成**能装的 Blender 插件**
 *
 * ## 为什么要有这个脚本
 *
 * 工作室的原话(2026-11-11):**「在 Blender 里 Scripting → 新建文本 →
 * 把插件粘进去 → Run Script,桥接就起了。做出插件」** ——
 * 「粘进去跑一下」那套太别扭了,用户得自己动手。
 *
 * 真正的插件应该长这样:
 *
 * ```
 * Edit → Preferences → Add-ons → Install from Disk… → 选那个 zip → 勾上启用
 * ```
 *
 * 装完**一打开 Blender 桥接就自动起了**(端口在插件偏好里改),
 * 面板在 3D 视图右侧(N 面板)→ Mooncoda。
 *
 * ## 一个真理源
 *
 * 插件里的实现**就是** ``public/magnet/blender_bridge.py`` 那份文件 ——
 * 构建的时候原样拷进 zip 的 ``mooncoda_magnet_bridge/bridge.py``。
 *
 * ⇒ **不会出现「网页那份跟插件那份不是一个东西」**。
 * 改完源码跑一遍这个脚本重新构建就行:
 *
 * ```bash
 * pnpm magnet:addon
 * ```
 *
 * ## 产物提交进仓库
 *
 * 跟 ``public/manifold.wasm`` 一个道理 —— 新克隆的机器上没人跑这个脚本
 * 的话,插件包就是缺的,页面上的「下载插件」链接会给一个 404。
 *
 * **所以产物一起提交**,让「克隆下来就能用」是默认状态。
 *
 * ## zip 的形状
 *
 * Blender 装 zip 插件时要求:**压缩包里只有一个顶层目录**,目录名 = 插件
 * 模块名。所以:
 *
 * ```
 * mooncoda_magnet_bridge/
 * ├── __init__.py   ← 插件入口(bl_info + register/unregister)
 * └── bridge.py     ← 实现(blender_bridge.py 的原样拷贝)
 * ```
 *
 * 顶层目录名**不能改** —— 改了 `bl_info` 里的插件名没事,但 Blender 会按
 * 目录名去找模块,用户启用的名字跟网页端的提示就对不上了。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { strToU8, zipSync } from "fflate";

/** 仓库根目录(这个脚本在 `scripts/` 下) */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 插件的顶层目录名(= Blender 里的模块名) */
const ADDON_DIR = "mooncoda_magnet_bridge";

/** 真理源:那份实现 */
const sourcePath = join(repoRoot, "public", "magnet", "blender_bridge.py");

/** 产物 */
const targetPath = join(
  repoRoot,
  "public",
  "magnet",
  `${ADDON_DIR}.zip`
);

/**
 * 插件入口 —— 内容是**生成**的
 *
 * 只做两件事:把 `bl_info` / `register` / `unregister` 从 `bridge.py` 里
 * 再导出一次(Blender 认这三个名字),剩下的说明写在这儿。
 *
 * ⚠️ **`bl_info` 不在这儿再抄一份** —— 抄了就会跟 `bridge.py` 里那份
 * 漂移(版本号改了、名字改了,两处不一样)。再导出就永远一致。
 */
const initPy = `# -*- coding: utf-8 -*-
"""Mooncoda 磁吸孔桥接插件(Mooncoda Magnet Bridge)

这是**装成 Blender 插件**用的入口 —— 实现在同目录的 \`bridge.py\` 里
(跟网页给的那份 \`blender_bridge.py\` 是同一个文件,构建时拷进来的)。

装法:Edit → Preferences → Add-ons → Install from Disk… → 选
\`${ADDON_DIR}.zip\` → 勾上启用。

启用之后桥接**自动就起了**;要手动开关:3D 视图右侧(N 面板)→ Mooncoda。
端口在 Preferences → Add-ons → Mooncoda Magnet Bridge 里改。

⚠️ **别改这个文件里的东西** —— 改 \`bridge.py\`(仓库里的
\`public/magnet/blender_bridge.py\`)之后要重新构建:\`pnpm magnet:addon\`。
"""

from .bridge import bl_info, register, unregister  # noqa: F401

__all__ = ["bl_info", "register", "unregister"]
`;

function main(): void {
  if (!existsSync(sourcePath)) {
    console.error(`[magnet:addon] 找不到 ${sourcePath}`);
    process.exit(1);
  }

  const source = readFileSync(sourcePath);
  const sourceText = source.toString("utf8");

  // 装成插件之前先确认那份文件**确实是个插件** —— 少了 bl_info / register
  // 的话,Blender 装了也起不来(而且不报错,只是插件列表里看不见)。
  for (const needle of ["bl_info", "def register(", "def unregister("]) {
    if (!sourceText.includes(needle)) {
      console.error(
        `[magnet:addon] ${sourcePath} 里没有 ${needle} —— 那份文件不是个插件`
      );
      process.exit(1);
    }
  }

  const zipped = zipSync(
    {
      [`${ADDON_DIR}/__init__.py`]: strToU8(initPy),
      [`${ADDON_DIR}/bridge.py`]: source,
    },
    {
      level: 9,
      // 固定时间戳 ⇒ 同样的源码构建出**同样的字节** ⇒ git 里不会每次都
      // 冒出「内容没变但文件变了」的改动。
      mtime: new Date("2026-01-01T00:00:00Z"),
    }
  );

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, zipped);

  const digest = createHash("sha256").update(zipped).digest("hex").slice(0, 16);
  console.log(
    `[magnet:addon] 已构建 ${targetPath}\n` +
      `  ${zipped.length} 字节 · sha256:${digest}\n` +
      `  内容:${ADDON_DIR}/__init__.py + ${ADDON_DIR}/bridge.py`
  );
}

main();
