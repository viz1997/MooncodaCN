/**
 * 把打印引擎打包成一个 **zip**(2026-11-16)
 *
 * ## 为什么要有这个脚本
 *
 * 工作室的原话:**「整理这个模型检测、克重报价工具代码,打包,我其他地方需要
 * 复用这个工具代码」**。
 *
 * 「我其他地方」= 工作室**别的项目** ⇒ 需要一份**能直接带走**的东西。
 * 一个 zip(解开就是一个自包含的目录)比「装 npm 包」更省事:
 * 解开 → 拷进你的项目 → 改一行 import 就能用。
 *
 * ## 一个真理源
 *
 * zip 里的 `src/**` **就是** `packages/print-tool-core/src/**` ——
 * 构建的时候原样拷进去,不另写一份。
 *
 * ⇒ 不会出现「zip 里那份跟仓库里那份不是一个东西」。
 * 改完源码跑一遍这个脚本重新构建就行:
 *
 * ```bash
 * pnpm print-tool:pack
 * ```
 *
 * ## 产物提交进仓库
 *
 * 跟 ``public/manifold.wasm`` / ``public/magnet/mooncoda_magnet_bridge.zip``
 * 一个道理 —— 产物提交,让「克隆下来就能用」「线上直接能下载」是默认状态。
 *
 * ⚠️ **`.zip` 已经在 `src/proxy.ts` 的 matcher 排除名单里** ——
 * 静态文件躲开 next-intl 的 locale 前缀重定向(`/print-tool-core.zip` 不会
 * 被 307 到 `/zh/print-tool-core.zip`)。
 *
 * ## zip 的形状
 *
 * ```
 * print-tool-core/
 * ├── INSTALL.md        ← 怎么装进你的项目(这个脚本生成的)
 * ├── README.md         ← API 说明(仓库里那份,原样拷)
 * ├── package.json      ← 原样拷
 * ├── tsconfig.json     ← 原样拷
 * ├── tsconfig.build.json ← 原样拷
 * └── src/              ← **引擎本体**(原样拷)
 *     ├── index.ts
 *     ├── mesh/  parse/  pricing/  quote/  weight/
 * ```
 *
 * 顶层目录名固定 `print-tool-core` —— 解开就是一个可以直接拷走的目录。
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { strToU8, zipSync } from "fflate";

/** 仓库根目录(这个脚本在 `scripts/` 下) */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 包根目录 */
const pkgRoot = join(repoRoot, "packages", "print-tool-core");

/** zip 里的顶层目录名 */
const TOP_DIR = "print-tool-core";

/** 产物 */
const targetPath = join(repoRoot, "public", "print-tool-core.zip");

/**
 * 装法说明 —— **这个脚本生成的**
 *
 * 为什么单独生成而不是直接拷仓库那份 README:仓库那份讲的是
 * 「同一个仓库里怎么接线」,这份讲的是**「你怎么把它装进你自己的项目」**。
 * 两件事不一样。
 */
const INSTALL_MD = `# 把打印引擎装进你的项目

这个 zip 解开就是一个自包含的目录:\`print-tool-core/\`。

里面**只有纯计算**:模型检测(焊接 / 拓扑 / 自检摘要 / WJP 报告)、
克重(耗材 / 支撑 / 模型单位判定)、报价(定价引擎 / 交期档位 / 取整 /
浮雕档位 / 智能摆盘)。

**没有** React 组件、three.js 视口、next-intl 文案、数据库、支付、模型上传
—— 那些是**界面 / 应用层**的事,各项目自己做。

## 装法一:拷进你的项目(最省事)

\`\`\`bash
unzip print-tool-core.zip -d /你的项目/
# 得到 /你的项目/print-tool-core/src/**
\`\`\`

包里的 import **全是相对路径** ⇒ 拷到哪儿都能编译。

给你自己的项目加一条路径别名(这样 import 好看):

\`\`\`jsonc
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "print-tool-core/*": ["./print-tool-core/src/*"]
    }
  }
}
\`\`\`

然后:

\`\`\`ts
import { computePrintQuote } from "print-tool-core/quote/compute-quote";
import { weldAndAnalyzeTopology } from "print-tool-core/mesh/weld";
import { detectModelUnitScale } from "print-tool-core/weight/model-units";
\`\`\`

> **Vitest / Vite 也得配一条同样的 alias** —— 它们的解析器不读
> tsconfig 的 paths(除非你专门接了插件)。

## 装法二:当依赖装(不想动自己的目录结构)

\`\`\`bash
pnpm add file:./print-tool-core
# 或者 npm i file:./print-tool-core
\`\`\`

然后按包名引:

\`\`\`ts
import { computePrintQuote } from "@mooncoda/print-tool-core/quote/compute-quote";
\`\`\`

⚠️ 这个包是 **source-first**(\`main\` 指的是 \`./src/index.ts\`,不是
\`dist/\`)⇒ 宿主项目直接吃 TS 源码。Next.js / Vite / webpack 都行;
**别用** \`"type": "module"\` 之类的 ESM-only 工具链(这个包是 CJS 口径)。

想发成真正的 JS 产物:

\`\`\`bash
cd print-tool-core
npx tsc -p tsconfig.build.json
# 产出 dist/ —— 然后把 package.json 的 main / types 改成 ./dist/index.js
\`\`\`

## 两条口径(改之前先读)

1. **金额一律「分」,一律向上取整** —— \`quote/rounding.ts\`。
   \`ceilCents()\` / \`yuanToCentsCeil()\` 是唯一的两个入口(浮点误差用
   \`1e-9\` 的 epsilon 挡掉,\`-0\` 归一化成 \`+0\`)。
2. **服务端不信客户端带来的价** —— \`computePrintQuote()\` **只吃几何**
   (体积 / 表面积 / 尺寸 / 支撑克重),价格永远由服务端那一份 \`settings\`
   算出来。客户端报的单价一律不认。

## 几个容易踩的坑

- **\`supportWeightG\` 一定要算出来再提交** —— 服务端按
  \`input.supportWeightG ?? 0\` 算支撑费,少了它支撑费算成 **0**(少收钱)。
- **浮雕档位是钱的口径,不是显示细节** —— 浮雕 1mm 托底、手办 5mm 托底,
  托底**算进支撑体积** ⇒ 算进支撑克重 ⇒ 算进支撑加价。
  判定在 \`pricing/relief-detect.ts\`(纯几何)。
- **模型单位要先判** —— AI 导出的模型坐标常常是**归一化的**(±1),不是毫米。
  \`detectModelUnitScale()\` 看**最大边**判(≥10mm 当毫米),归一化到
  最大边 100mm。详见 \`weight/model-units.ts\`。
- **支撑外壳是「某个姿态下的一次结果」** —— 姿态变了手里那块就作废,
  得按新姿态重算。\`SupportShellData.pose\` 带着算它时的姿态。

## 许可

MIT
`;

/** 递归收集目录下的所有文件(相对路径 → 绝对路径) */
function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full, base));
    } else {
      out.push(relative(base, full));
    }
  }
  return out;
}

function main(): void {
  if (!existsSync(pkgRoot)) {
    console.error(`[print-tool:pack] 找不到 ${pkgRoot}`);
    process.exit(1);
  }

  /** zip 的内容:路径 → 字节 */
  const entries: Record<string, Uint8Array> = {};

  // ① 引擎本体 —— 原样拷(一个字节都不改)
  const srcDir = join(pkgRoot, "src");
  const srcFiles = listFiles(srcDir);
  if (srcFiles.length === 0) {
    console.error(`[print-tool:pack] ${srcDir} 是空的`);
    process.exit(1);
  }
  for (const rel of srcFiles) {
    entries[`${TOP_DIR}/src/${rel.split("\\").join("/")}`] = readFileSync(
      join(srcDir, rel)
    );
  }

  // ② 那几个「根上」的文件 —— 原样拷
  for (const name of [
    "README.md",
    "package.json",
    "tsconfig.json",
    "tsconfig.build.json",
  ]) {
    const full = join(pkgRoot, name);
    if (!existsSync(full)) {
      console.error(`[print-tool:pack] 找不到 ${full}`);
      process.exit(1);
    }
    entries[`${TOP_DIR}/${name}`] = readFileSync(full);
  }

  // ③ 装法说明 —— 这个脚本生成的
  entries[`${TOP_DIR}/INSTALL.md`] = strToU8(INSTALL_MD);

  const zipped = zipSync(entries, {
    level: 9,
    // 固定时间戳 ⇒ 同样的源码构建出**同样的字节** ⇒ git 里不会每次都
    // 冒出「内容没变但文件变了」的改动。
    mtime: new Date("2026-01-01T00:00:00Z"),
  });

  writeFileSync(targetPath, zipped);

  const digest = createHash("sha256").update(zipped).digest("hex").slice(0, 16);
  console.log(
    `[print-tool:pack] 已构建 ${targetPath}\n` +
      `  ${zipped.length} 字节 · sha256:${digest}\n` +
      `  ${srcFiles.length} 个引擎源文件 + README / INSTALL / package.json / tsconfig`
  );
}

main();
