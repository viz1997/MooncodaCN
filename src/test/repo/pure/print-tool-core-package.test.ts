import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

/**
 * 打印引擎包 `@mooncoda/print-tool-core`(2026-11-16)
 *
 * ## 为什么要有这个包
 *
 * 工作室的要求:**「整理这个模型检测、克重报价工具代码,打包,我其他地方需要
 * 复用这个工具代码」**。
 *
 * ⇒ 模型检测 / 克重 / 报价三件事的**纯计算**部分搬进
 * `packages/print-tool-core/`(pnpm workspace 成员)。
 *
 * ## 这个包**必须**守住的三条
 *
 * | 规矩 | 不守会怎样 |
 * |---|---|
 * | **自包含** —— 包里的 import 只指包内 | 别的项目装上就编译不过(引不到本仓库的路径) |
 * | **同构** —— 零 `node:` import、零 React / three.js | 浏览器 / Worker 里跑不起来 |
 * | **零依赖** —— `package.json` 没有 `dependencies` | 别人装这个包要拖一堆东西进来 |
 *
 * ## 为什么这些断言要跑在**去掉注释之后**的源码上
 *
 * 注释里写着「以前在 `src/features/tools/lib/mesh/`」是**历史说明**,
 * 不是违规。Biome 格式化还会把长行拆开 ⇒ **跨行的精确字符串匹配不可靠**
 * ⇒ 一律用**正则**。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());
/** 包根目录 */
const PKG = join(ROOT, "packages/print-tool-core");
/** 包里的源码目录 */
const PKG_SRC = join(PKG, "src");

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写过什么不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/** 递归列出目录下的 .ts / .tsx */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** 包里的所有源文件 */
const PKG_FILES = listFiles(PKG_SRC);

/** 这个测试文件自己 —— 扫老路径的时候不扫自己(它自己写着那串老路径) */
const SELF = fileURLToPath(import.meta.url);

/** 从源码里抽出 import / export 的说明符(纯类型导入也要) */
function importSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const importRe = /\bfrom\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(importRe)) specs.push(m[1] as string);
  const bareRe = /\bimport\s*["']([^"']+)["']/g;
  for (const m of src.matchAll(bareRe)) specs.push(m[1] as string);
  const dynRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of src.matchAll(dynRe)) specs.push(m[1] as string);
  return specs;
}

// ---------------------------------------------------------------------------
// 边界
// ---------------------------------------------------------------------------

describe("包的边界 —— 自包含 / 同构 / 零依赖", () => {
  it("包里**没有** `@/` 应用侧别名 —— 别的项目引不到本仓库的路径", () => {
    for (const file of PKG_FILES) {
      const specs = importSpecifiers(stripComments(readFileSync(file, "utf8")));
      for (const spec of specs) {
        expect(
          spec.startsWith("@/"),
          `${file.replace(ROOT, "")} 引了应用侧路径 ${spec} —— 包不自包含`
        ).toBe(false);
      }
    }
  });

  it("包里的 import **只指包内** —— 不能回引应用侧", () => {
    for (const file of PKG_FILES) {
      const specs = importSpecifiers(stripComments(readFileSync(file, "utf8")));
      for (const spec of specs) {
        if (!spec.startsWith(".")) continue;
        const base = resolve(dirname(file), spec);
        const candidates = [
          `${base}.ts`,
          join(base, "index.ts"),
        ];
        const resolved = candidates.find((c) => existsSync(c));
        expect(
          resolved,
          `${file.replace(ROOT, "")} 引的 ${spec} 解析不到文件`
        ).toBeTruthy();
        // 相对包根算 —— 跑出包外 = 开头是 `..`
        const inside = relative(PKG, resolved as string);
        expect(
          inside.startsWith(".."),
          `${file.replace(ROOT, "")} 引的 ${spec} 跑到包外了 —— 包不自包含`
        ).toBe(false);
      }
    }
  });

  it("包里**没有** `node:` import —— 浏览器 / Worker 里跑不起来", () => {
    for (const file of PKG_FILES) {
      const specs = importSpecifiers(stripComments(readFileSync(file, "utf8")));
      for (const spec of specs) {
        expect(
          spec.startsWith("node:"),
          `${file.replace(ROOT, "")} 引了 ${spec} —— 包就不是同构的了`
        ).toBe(false);
      }
    }
  });

  it("包里**没有** React / three.js / next-intl / 数据库 —— 只有纯计算", () => {
    const banned = [
      "react",
      "react-dom",
      "three",
      "next-intl",
      "next/navigation",
      "drizzle-orm",
      "@/db",
      "better-auth",
    ];
    for (const file of PKG_FILES) {
      const specs = importSpecifiers(stripComments(readFileSync(file, "utf8")));
      for (const spec of specs) {
        expect(
          banned.some((b) => spec === b || spec.startsWith(`${b}/`)),
          `${file.replace(ROOT, "")} 引了 ${spec} —— 那是界面 / 数据库的东西,不属于引擎`
        ).toBe(false);
      }
    }
  });

  it("`package.json` **没有** dependencies —— 零依赖", () => {
    const pkg = JSON.parse(read("packages/print-tool-core/package.json"));

    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it("读环境变量的那个 helper 带 `typeof process` 守卫 —— 纯浏览器里不炸", () => {
    const code = stripComments(
      read("packages/print-tool-core/src/quote/pricing-settings.ts")
    );

    expect(code).toContain('if (typeof process === "undefined")');
  });

  it("包里没有**裸**的 `process.env` 访问 —— 全走那个 helper", () => {
    for (const file of PKG_FILES) {
      const code = stripComments(readFileSync(file, "utf8"));
      // `readEnv` 内部那一处是合法的 —— 它自己带了守卫
      const hits = code
        .split("\n")
        .filter((line) => /process\.env/.test(line))
        .filter((line) => !/return process\.env/.test(line));
      expect(
        hits,
        `${file.replace(ROOT, "")} 里有裸的 process.env 访问: ${hits.join(" | ")}`
      ).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 公开面
// ---------------------------------------------------------------------------

describe("公开面 —— barrel 与 exports 都对得上", () => {
  const SUB_DIRS = ["mesh", "parse", "pricing", "quote", "weight"];

  it("五个子目录都有 barrel,根 barrel 把它们全导出去", () => {
    for (const dir of SUB_DIRS) {
      expect(existsSync(join(PKG_SRC, dir, "index.ts"))).toBe(true);
    }
    const root = stripComments(read("packages/print-tool-core/src/index.ts"));
    for (const dir of SUB_DIRS) {
      expect(root).toContain(`export * from "./${dir}"`);
    }
  });

  it("`package.json` 的 `exports` 覆盖了根 / 五个子目录 / 细路径", () => {
    const pkg = JSON.parse(read("packages/print-tool-core/package.json"));

    expect(pkg.exports["."]).toBeTruthy();
    for (const dir of SUB_DIRS) {
      expect(pkg.exports[`./${dir}`], `exports 少了 ./${dir}`).toBeTruthy();
    }
    // 细路径:`@mooncoda/print-tool-core/mesh/weld`
    expect(pkg.exports["./*"]).toBeTruthy();
    expect(pkg.exports["./package.json"]).toBeTruthy();
  });

  it("主入口指向 **src/**(source-first)—— 不用 build 就能用", () => {
    const pkg = JSON.parse(read("packages/print-tool-core/package.json"));

    expect(pkg.main).toContain("src/");
    expect(pkg.types).toContain("src/");
    // 不设 `"type": "module"` —— 跟仓库(CJS)一致,免得 tsx 的解析出问题
    expect(pkg.type).toBeUndefined();
  });

  it("每个 barrel 都真的导出了东西 —— 空 barrel 是漏搬", () => {
    for (const dir of SUB_DIRS) {
      const code = read(join("packages", "print-tool-core", "src", dir, "index.ts"));
      const exports = code.match(/export\s+\*\s+from/g) ?? [];
      expect(exports.length, `${dir}/index.ts 一个都没导出`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 接线 —— 三处,少一处就有一边跑不起来
// ---------------------------------------------------------------------------

describe("接线 —— tsconfig / vitest / pnpm workspace 三处", () => {
  it("`tsconfig.json` 的 paths 有根 + 通配两条", () => {
    const tsconfig = JSON.parse(read("tsconfig.json"));
    const paths = tsconfig.compilerOptions.paths;

    expect(paths["@mooncoda/print-tool-core"]).toBeTruthy();
    expect(paths["@mooncoda/print-tool-core/*"]).toBeTruthy();
  });

  it("`vitest.config.ts` 的 alias 有它", () => {
    const code = read("vitest.config.ts");

    expect(code).toContain("@mooncoda/print-tool-core");
  });

  it("`pnpm-workspace.yaml` 登记了这个包", () => {
    const code = read("pnpm-workspace.yaml");

    expect(code).toContain("packages/print-tool-core");
  });
});

// ---------------------------------------------------------------------------
// 旧路径清干净
// ---------------------------------------------------------------------------

describe("搬走前的老路径 —— 全仓一个引用都不许剩", () => {
  /**
   * 引擎搬走前的位置。**全仓都不许再出现** —— 出现了就说明有人从老地方
   * import(文件已经不在那儿 ⇒ 编译不过),或者注释忘了改(误导人)。
   */
  const OLD_PATHS = [
    "src/features/tools/lib/mesh/",
    "src/features/print-quote/lib/pricing-settings",
    "src/features/print-quote/lib/delivery-tier",
    "src/features/print-quote/lib/rounding",
    "src/features/print-quote/lib/coupon-base",
    "src/features/pricing/lib/pricing-engine",
    "src/features/pricing/lib/angle-optimizer\"",
    "src/features/pricing/lib/angle-optimizer-protocol",
    "src/features/pricing/lib/model-units",
    "src/features/pricing/lib/material-weight",
    "src/features/pricing/lib/pricing-geometry",
    "src/features/pricing/lib/relief-detect",
    "src/features/pricing/lib/pose-comparison",
    "src/features/pricing/lib/support-cache-key",
    "src/features/pricing/lib/obj-parser",
    "src/features/pricing/lib/obj-text",
  ];

  it("`src/` 与 `scripts/` 里没有残留引用", () => {
    const files = [
      ...listFiles(join(ROOT, "src")),
      ...listFiles(join(ROOT, "scripts")),
    ];
    const offenders: string[] = [];

    for (const file of files) {
      // 这个测试文件**自己**写着那串老路径(要拿来扫别人)—— 自己不扫自己
      if (file === SELF) continue;
      const src = readFileSync(file, "utf8");
      for (const old of OLD_PATHS) {
        if (src.includes(old)) {
          offenders.push(`${file.replace(ROOT, "")} → ${old}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(0);
  });

  it("应用侧那几个**留在原地**的文件还在 —— 别连锅端", () => {
    // 引擎搬走了,但这些是应用专属的,还在原处
    const KEPT = [
      "src/features/pricing/lib/angle-optimizer-client.ts",
      "src/features/pricing/lib/angle-optimizer-handler.ts",
      "src/features/pricing/lib/obj-exporter.ts",
      "src/features/pricing/lib/zip-extractor.ts",
      "src/features/pricing/lib/batch-processor.ts",
      "src/features/print-quote/lib/quote-server.ts",
      "src/features/print-quote/lib/quote-types.ts",
      "src/features/print-quote/lib/pricing-store.ts",
    ];
    for (const kept of KEPT) {
      expect(existsSync(join(ROOT, kept)), `${kept} 不见了`).toBe(true);
    }
  });

  it("应用侧那两个壳**再导出一次**引擎 —— 已有 import 一个字都不用改", () => {
    const quoteServer = stripComments(
      read("src/features/print-quote/lib/quote-server.ts")
    );
    expect(quoteServer).toContain(
      'export { computePrintQuote } from "@mooncoda/print-tool-core/quote/compute-quote"'
    );

    const quoteTypes = stripComments(
      read("src/features/print-quote/lib/quote-types.ts")
    );
    expect(quoteTypes).toContain("PrintQuoteInput");
    expect(quoteTypes).toContain("PublicPrintQuote");
  });
});

// ---------------------------------------------------------------------------
// zip 产物 —— 「拷进别的项目」那条路
// ---------------------------------------------------------------------------

describe("zip 产物 —— 解开就是一个能带走的目录", () => {
  /** zip 的位置 */
  const ZIP_PATH = join(ROOT, "public", "print-tool-core.zip");

  /** zip 里的顶层目录名 */
  const TOP = "print-tool-core";

  /**
   * 解开 zip —— 解不开就当场炸(产物坏了还过测试才是灾难)。
   *
   * 只在**确实有那个文件**的时候解;文件不在,后面那些断言自己会炸。
   */
  function unzip(): Record<string, Uint8Array> {
    if (!existsSync(ZIP_PATH)) return {};
    return unzipSync(readFileSync(ZIP_PATH));
  }

  it("产物在 `public/print-tool-core.zip` —— 线上能直接下载", () => {
    expect(
      existsSync(ZIP_PATH),
      "public/print-tool-core.zip 不见了 —— 跑一遍 pnpm print-tool:pack"
    ).toBe(true);
  });

  it("构建脚本登记在 `package.json` 里 —— `pnpm print-tool:pack`", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["print-tool:pack"]).toContain(
      "scripts/build-print-tool-core-zip.ts"
    );
  });

  it("顶层目录**只有一个** `print-tool-core/` —— 解开就是能拷走的目录", () => {
    const entries = unzip();
    const tops = new Set(
      Object.keys(entries).map((name) => name.split("/")[0] as string)
    );

    expect([...tops]).toEqual([TOP]);
  });

  it("zip 里的引擎源文件跟包里的**逐个字节相同** —— 一个真理源", () => {
    const entries = unzip();
    const srcFiles = listFiles(PKG_SRC);

    expect(srcFiles.length).toBeGreaterThan(0);

    for (const file of srcFiles) {
      const rel = relative(PKG_SRC, file).split("\\").join("/");
      const key = `${TOP}/src/${rel}`;
      expect(entries[key], `zip 里少了 ${key}`).toBeTruthy();

      // 逐字节比 —— 构建脚本是**原样拷**的,不该有任何加工
      const fromZip = Buffer.from(entries[key] as Uint8Array);
      const fromPkg = readFileSync(file);
      expect(
        fromZip.equals(fromPkg),
        `${rel} 在 zip 里跟仓库里不是一个东西 —— 跑一遍 pnpm print-tool:pack`
      ).toBe(true);
    }
  });

  it("根上那几个文件都在 —— README / INSTALL / package.json / 两个 tsconfig", () => {
    const entries = unzip();

    for (const name of [
      "README.md",
      "INSTALL.md",
      "package.json",
      "tsconfig.json",
      "tsconfig.build.json",
    ]) {
      expect(entries[`${TOP}/${name}`], `zip 里少了 ${name}`).toBeTruthy();
    }
  });

  it("`INSTALL.md` 写了那两条口径 —— 别的项目照着改才不会踩坑", () => {
    const entries = unzip();
    const raw = entries[`${TOP}/INSTALL.md`];
    expect(raw).toBeTruthy();

    const text = Buffer.from(raw as Uint8Array).toString("utf8");

    // ① 金额一律分 + 向上取整
    expect(text).toContain("分");
    expect(text).toMatch(/向上取整/);
    // ② 服务端不信客户端带来的价
    expect(text).toMatch(/服务端不信客户端带来的价/);
  });

  it("zip 里**没有**依赖 / 应用侧的痕迹 —— 还是自包含的", () => {
    const entries = unzip();
    const pkgRaw = entries[`${TOP}/package.json`];
    expect(pkgRaw).toBeTruthy();

    const pkg = JSON.parse(Buffer.from(pkgRaw as Uint8Array).toString("utf8"));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();

    // 源码里不许有 `@/` 应用侧别名
    for (const [name, bytes] of Object.entries(entries)) {
      if (!name.endsWith(".ts") && !name.endsWith(".tsx")) continue;
      const text = Buffer.from(bytes).toString("utf8");
      const specs = importSpecifiers(stripComments(text));
      for (const spec of specs) {
        expect(
          spec.startsWith("@/"),
          `${name} 引了应用侧路径 ${spec} —— zip 不是自包含的`
        ).toBe(false);
      }
    }
  });
});
