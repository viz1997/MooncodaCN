#!/usr/bin/env -S npx tsx
/**
 * 自托管字体 —— 把三套 Google Fonts 拉进仓库(2026-11-14)
 *
 * ## 为什么要有这个脚本
 *
 * 原来三套字体都走 `next/font/google` —— **构建期**去 fonts.googleapis.com
 * 拉 CSS、再按 CSS 里的 `url()` 去 fonts.gstatic.com 拉 woff2。
 * 2026-11-14 Vercel 上构建直接炸了(32 个 Turbopack 报错):
 *
 * ```
 * Module not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'
 * next/font/google queries have exactly one entry
 * ```
 *
 * 根因**不在本仓库的代码** —— 是 Google 偶尔返回**没有扩展名**的字体地址
 * (`/l/font?kit=…` 而不是 `/s/…/xxx.woff2`),Next 16.1.4 的 Turbopack
 * 解析不了那个形状(上游 issue vercel/next.js#99114,至今没有修复版)。
 * ⇒ **构建结果取决于当天 Google 返回什么** —— 这不能接受。
 *
 * 修法:**字体自托管** —— 构建期不再碰 Google,文件进仓库。
 * 顺带解决境内访问 gstatic 不稳的问题(用户主要在国内)。
 *
 * ## 三套字体各自怎么落
 *
 * | 字体 | 档 | 为什么 |
 * |---|---|---|
 * | Inter | `next/font/local` | latin 一个切片就够(正文);走 local 有 preload + 哈希文件名 + 兜底字体度量 |
 * | Playfair Display | `next/font/local` | normal / italic 各一个 latin 切片 |
 * | Noto Serif SC | **手写 @font-face** | 中文是**切片字体**(101 个文件),`next/font/local` **不支持 unicode-range** —— 用它的话浏览器会把 101 个切片全下一遍 |
 *
 * ## 中文那一套为什么「原样搬」
 *
 * Google 的 CSS 对同一个文件给出**多条** `@font-face`(每个字重一条,
 * 码位范围相同)。那 101 个文件是**可变字体**(wght 轴)—— 500 和 600 指向
 * **同一个文件**。
 *
 * ⇒ 生成的那份 CSS **逐条照抄 Google 的**(只把 `url()` 换成本地路径):
 * 每一块都钉死自己的 `font-weight` 和 `unicode-range`,**跟今天线上
 * `next/font/google` 生成的完全一样**。
 * 合并成「一个文件 + `font-weight: 500 600`」也能跑,但那是**另一个口径** ——
 * 万一 Google 哪天把某个切片改成静态字体,合并版会渲染错。
 *
 * ## 产物提交进仓库
 *
 * 跟 `public/manifold.wasm` 一个道理:「克隆下来就能跑」是默认状态。
 * 字体文件一共 ~6MB(其中 Noto Serif SC 占 5.9MB —— 汉字字体本来就大)。
 *
 * 三套字体都是 **SIL Open Font License**(可自由自托管 / 再分发),
 * 许可正文一并拉下来放在各自目录里(`OFL.txt`)。
 *
 * ## 重新拉
 *
 * ```bash
 * pnpm fonts:sync
 * ```
 *
 * 脚本**幂等**:同样的输入产出同样的字节 —— 用 Next 自己那个 User-Agent
 * 发请求,拿到的就是 Next 会拿到的那一批文件。
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** 仓库根目录(这个脚本在 `scripts/` 下) */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** 字体落地目录 */
const fontsDir = join(repoRoot, "src", "fonts");

/**
 * Next 自己发请求时用的 User-Agent
 *
 * 抄 `next/dist/compiled/@next/font/dist/google/fetch-resource.js` ——
 * 换成这个 UA,Google 才返回**同一批**文件(不同 UA 会返回不同的子集切法)。
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/104.0.0.0 Safari/537.36";

/** 一条 `@font-face` */
type Face = {
  /** 字体族名(Google 给的) */
  family: string;
  /** normal / italic */
  style: string;
  /** "500" 或 "100 900"(可变字体) */
  weight: string;
  /** 字体文件的绝对地址 */
  url: string;
  /**
   * 子集名(Google 在注释里写:latin / latin-ext / cyrillic …)
   *
   * `null` = **这条前面没有子集注释** —— 中文切片就是这种
   * (Google 只给最后几个拉丁子集写注释,CJK 切片一个注释都没有)。
   */
  subset: string | null;
  /** 字符范围(没有就是没有) */
  unicodeRange: string | null;
  /** 这条块在原 CSS 里的原文 —— 生成时按原样还原 */
  block: string;
};

/* -------------------------------------------------------------------------- */
/*  拉 CSS                                                                       */
/* -------------------------------------------------------------------------- */

async function fetchCss(family: string): Promise<string> {
  const url = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    throw new Error(`拉 ${url} 失败:HTTP ${res.status}`);
  }
  return await res.text();
}

/**
 * 解析 Google 的 CSS
 *
 * 形状:`@font-face { … }`,前面**可能**有一行 `/* subset *\/` 注释。
 *
 * ⚠️ **注释不是每块都有** —— 中文切片的 194 块一个注释都没有,
 * 只有最后几个拉丁子集带注释。⇒ 解析时**注释可选**,不许拿它当必需项
 * (踩过:先前那版把注释当必需,202 条只认出 4 条,CJK 切片全丢了)。
 */
function parseFaces(css: string): Face[] {
  const faces: Face[] = [];
  const re = /(?:\/\*\s*([^*]+?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g;
  let m = re.exec(css);
  while (m !== null) {
    const subset = m[1] ? m[1].trim() : null;
    const body = m[2];
    const pick = (prop: string): string | null => {
      const hit = new RegExp(`${prop}\\s*:\\s*([^;]+);`).exec(body);
      return hit ? hit[1].trim() : null;
    };
    const src = pick("src");
    const urlHit = src ? /url\(([^)]+)\)/.exec(src) : null;
    const familyHit = /font-family\s*:\s*['"]([^'"]+)['"]/.exec(body);
    if (urlHit && familyHit) {
      faces.push({
        family: familyHit[1],
        style: pick("font-style") ?? "normal",
        weight: pick("font-weight") ?? "400",
        url: urlHit[1].trim().replace(/^['"]|['"]$/g, ""),
        subset,
        unicodeRange: pick("unicode-range"),
        block: m[0].trim(),
      });
    }
    m = re.exec(css);
  }
  return faces;
}

/* -------------------------------------------------------------------------- */
/*  下载                                                                         */
/* -------------------------------------------------------------------------- */

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    throw new Error(`拉 ${url} 失败:HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** 文件名(去掉查询串) */
function basename(url: string): string {
  const clean = url.split("?")[0];
  const parts = clean.split("/");
  return parts[parts.length - 1] ?? "font.woff2";
}

/**
 * 「这个地址是不是那个坏形状」
 *
 * Google 偶尔返回 `/l/font?kit=…` 这种**没有扩展名**的地址 ——
 * 浏览器照样能加载(声明了 `format('woff2')`),但 Next 的 Turbopack
 * 解析不了(就是 2026-11-14 那次构建炸掉的原因)。
 *
 * 自托管的产物必须是**正经的 .woff2 文件** ⇒ 遇到这种地址直接失败,
 * 让人重跑脚本(下一次请求就正常了),别把坏形状存进仓库。
 */
function assertProperWoff2(url: string): string {
  const name = basename(url);
  if (!name.endsWith(".woff2")) {
    throw new Error(
      `Google 返回了没有扩展名的字体地址(${url})—— ` +
        `这正是 2026-11-14 炸构建的那种形状。重新跑一次 pnpm fonts:sync。`
    );
  }
  return name;
}

function writeFile(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

/**
 * 把目录里**这次没写**的旧字体文件清掉
 *
 * 脚本改了切法(Google 换了版本 ⇒ 文件名变了)时,旧文件会留在仓库里
 * 白占地方。⇒ 每次跑完把「不在这次产物里」的 woff2 删掉。
 */
function pruneStale(dir: string, keep: Set<string>): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".woff2")) continue;
    if (!keep.has(name)) {
      rmSync(join(dir, name));
      console.log(`  删掉旧文件 ${name}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  weight 集合 → CSS 里写什么                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 把一堆 weight 声明合成一个描述符
 *
 * - 只有一个 ⇒ 就写那一个("500")
 * - 连续的一段 ⇒ 写成区间("400 700")—— **可变字体**就是这么写的
 * - 不连续 ⇒ 写成空格分隔的列表("100 900")
 *
 * ⚠️ 输入可能**本身就是区间**("100 900")—— 得拆开算,
 * 直接 `parseInt` 会把它读成 100(踩过:Inter 的 `100 900` 被写成了 `100`)。
 */
function mergeWeightDescriptors(raws: string[]): string {
  const nums = new Set<number>();
  for (const raw of raws) {
    for (const part of raw.trim().split(/\s+/)) {
      const n = Number.parseInt(part, 10);
      if (Number.isFinite(n)) nums.add(n);
    }
  }
  const sorted = [...nums].sort((a, b) => a - b);
  if (sorted.length === 0) return "400";
  if (sorted.length === 1) return String(sorted[0]);
  const contiguous = sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
  if (contiguous) return `${sorted[0]} ${sorted[sorted.length - 1]}`;
  return sorted.map(String).join(" ");
}

/* -------------------------------------------------------------------------- */
/*  档 A:next/font/local(拉丁字体)                                               */
/* -------------------------------------------------------------------------- */

type LocalFontResult = {
  files: Array<{ style: string; weight: string; file: string; bytes: number }>;
};

/**
 * 拉丁字体 —— Inter / Playfair Display
 *
 * 只取 **latin** 一个子集:
 *
 * - 站点的正文/标题是中文 + 英文,latin 覆盖了实际会出现的字形;
 * - latin-ext(ā ő ū 那些)在中文/英文站点上几乎不会出现,缺了也只是
 *   逐字形回退到系统字体;
 * - `next/font/local` **不支持 unicode-range** ⇒ 一个文件只能对应一个子集
 *   (要 latin-ext 就得再写一份 @font-face,不值得)。
 *
 * ⚠️ 变量字体:Google 对同一个 (子集, 字形) 只给**一个**文件,
 * 多个字重共用它 ⇒ `next/font/local` 声明成区间("400 700")。
 */
async function syncLocalFont(options: {
  /** css2 的 family 参数 */
  query: string;
  /** 目录名 */
  dir: string;
  /** 人类可读的名字(报错时用) */
  label: string;
}): Promise<LocalFontResult> {
  const css = await fetchCss(options.query);
  const faces = parseFaces(css).filter((f) => f.subset === "latin");
  if (faces.length === 0) {
    throw new Error(
      `${options.label}:CSS 里没有 latin 子集 —— ` +
        `Google 改了子集名,这个脚本要跟着改`
    );
  }

  const byStyle = new Map<string, { url: string; weights: string[] }>();
  for (const face of faces) {
    const hit = byStyle.get(face.style);
    if (!hit) {
      byStyle.set(face.style, { url: face.url, weights: [face.weight] });
      continue;
    }
    hit.weights.push(face.weight);
    if (hit.url !== face.url) {
      throw new Error(
        `${options.label}:同一个 (子集, 字形) 返回了两个文件 —— ` +
          `Google 改切法了,这个脚本要跟着改`
      );
    }
  }

  const out: LocalFontResult["files"] = [];
  const written = new Set<string>();
  for (const [style, info] of byStyle) {
    assertProperWoff2(info.url);
    const file = style === "italic" ? "latin-italic.woff2" : "latin.woff2";
    const bytes = await download(info.url);
    writeFile(join(fontsDir, options.dir, file), bytes);
    written.add(file);
    const weight = mergeWeightDescriptors(info.weights);
    out.push({
      style,
      weight,
      file: join(options.dir, file),
      bytes: bytes.byteLength,
    });
    console.log(
      `  ${options.label} ${style} → ${options.dir}/${file} ` +
        `(字重 ${info.weights.join("/")} 合成 "${weight}", ` +
        `${(bytes.byteLength / 1024).toFixed(1)} KB)`
    );
  }
  pruneStale(join(fontsDir, options.dir), written);
  return { files: out };
}

/* -------------------------------------------------------------------------- */
/*  档 B:手写 @font-face(中文切片字体)                                           */
/* -------------------------------------------------------------------------- */

/**
 * 中文切片字体 —— Noto Serif SC
 *
 * 汉字字体是**切片**的:一个文件只覆盖一小段码位,靠 `unicode-range`
 * 告诉浏览器「这段字形归我」⇒ 页面只用到哪几个字,就只下哪几个切片。
 *
 * `next/font/local` **不支持 unicode-range**(它一个文件一条 @font-face,
 * 没有逐条写码位范围的口子)⇒ 用它的话 101 个切片会被浏览器**全下下来**
 * (6MB/页)⇒ 这一套只能手写 @font-face。
 *
 * 生成的那份 CSS **逐条照抄 Google 的** —— 只把 `url()` 换成本地路径。
 * (同一条文件对应多个字重 ⇒ 多个块,每块钉死自己的 `font-weight`。)
 */
async function syncSlicedFont(options: {
  /** css2 的 family 参数 */
  query: string;
  /** 目录名 */
  dir: string;
  /** CSS 里的 family 名 */
  cssFamily: string;
  /** 暴露成哪个 CSS 变量 */
  variable: string;
  /** 人类可读的名字 */
  label: string;
}): Promise<{ files: number; bytes: number; blocks: number }> {
  const css = await fetchCss(options.query);
  const faces = parseFaces(css);
  if (faces.length === 0) {
    throw new Error(`${options.label}:CSS 里没有 @font-face`);
  }

  const written = new Set<string>();
  let totalBytes = 0;
  /** 文件名 → 本地路径 */
  const localPath = new Map<string, string>();

  for (const face of faces) {
    const name = assertProperWoff2(face.url);
    if (!localPath.has(name)) {
      const bytes = await download(face.url);
      writeFile(join(fontsDir, options.dir, name), bytes);
      written.add(name);
      totalBytes += bytes.byteLength;
      localPath.set(name, `./${name}`);
    }
  }

  // 逐条还原 Google 的块 —— 只换 url()
  const blocks = faces.map((face) => {
    const name = basename(face.url);
    const local = localPath.get(name);
    if (!local) {
      throw new Error(`${options.label}:文件 ${name} 没下载下来`);
    }
    return face.block.replace(
      /url\(\s*['"]?https:\/\/fonts\.gstatic\.com\/[^)]+?\s*\)/,
      `url("${local}")`
    );
  });

  const cssText = [
    "/* eslint-disable */",
    "/*",
    " * 生成文件 —— **别手改**。",
    " *",
    " * 改法:改 `scripts/fetch-self-hosted-fonts.ts`,然后 `pnpm fonts:sync`。",
    " *",
    " * 这份 CSS 是 **Noto Serif SC**(中文衬线)的切片表 —— 汉字字体按码位切片,",
    " * 靠 `unicode-range` 告诉浏览器「这段字形归哪个文件」⇒ 页面只用到哪几个字",
    " * 就只下哪几个切片。",
    " *",
    " * ⚠️ `next/font/local` 做不到这件事(它没有 unicode-range 这个口子)——",
    " * 用它的话 101 个切片会被浏览器全下下来。",
    " *",
    " * 下面的 `@font-face` 是**逐条照抄 Google 的**(只把 `url()` 换成本地路径)",
    " * —— 每一块都钉死自己的 `font-weight` 和 `unicode-range`,",
    " * 跟线上 `next/font/google` 生成的完全一致。",
    " */",
    "",
    "/* 中文衬线 —— 标题里汉字的逐字形回退(拉丁字形走 Playfair) */",
    ":root {",
    `  --${options.variable}: "${options.cssFamily}", Georgia, serif;`,
    "}",
    "",
    ...blocks,
    "",
  ].join("\n");

  writeFile(join(fontsDir, options.dir, "font.css"), Buffer.from(cssText, "utf8"));
  pruneStale(join(fontsDir, options.dir), written);
  console.log(
    `  ${options.label} → ${options.dir}/ (${written.size} 个切片 / ` +
      `${blocks.length} 条 @font-face, ${(totalBytes / 1024 / 1024).toFixed(2)} MB)`
  );
  return { files: written.size, bytes: totalBytes, blocks: blocks.length };
}

/* -------------------------------------------------------------------------- */
/*  许可正文                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 把 OFL 正文拉下来放在字体目录里
 *
 * SIL Open Font License 要求:再分发字体时**许可正文要跟着走**。
 * 拉不到不算失败(只是提醒),不该把整个脚本拖挂。
 */
async function syncLicense(dir: string, googleFontsPath: string): Promise<void> {
  const url = `https://raw.githubusercontent.com/google/fonts/main/${googleFontsPath}/OFL.txt`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  拉不到许可正文(${url})—— HTTP ${res.status},跳过`);
      return;
    }
    const text = await res.text();
    writeFile(join(fontsDir, dir, "OFL.txt"), Buffer.from(text, "utf8"));
    console.log(`  ${dir}/OFL.txt ✓`);
  } catch (error) {
    console.warn(`  拉不到许可正文(${url})—— ${String(error)},跳过`);
  }
}

/* -------------------------------------------------------------------------- */
/*  README                                                                       */
/* -------------------------------------------------------------------------- */

function writeReadme(lines: string[]): void {
  writeFile(join(fontsDir, "README.md"), Buffer.from(lines.join("\n"), "utf8"));
}

/* -------------------------------------------------------------------------- */
/*  主流程                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log("[fonts:sync] 拉 Google Fonts(UA 跟 Next 自己那个一致)");
  mkdirSync(fontsDir, { recursive: true });

  console.log("[fonts:sync] 拉丁字体(走 next/font/local)");
  const inter = await syncLocalFont({
    query: "Inter:wght@100..900",
    dir: "inter",
    label: "Inter",
  });
  const playfair = await syncLocalFont({
    query: "Playfair+Display:ital,wght@0,400..700;1,400..700",
    dir: "playfair-display",
    label: "Playfair Display",
  });

  console.log("[fonts:sync] 中文切片字体(手写 @font-face)");
  const noto = await syncSlicedFont({
    query: "Noto+Serif+SC:wght@500;600",
    dir: "noto-serif-sc",
    cssFamily: "Noto Serif SC",
    variable: "font-atelier-serif-sc",
    label: "Noto Serif SC",
  });

  console.log("[fonts:sync] 许可正文");
  await syncLicense("inter", "ofl/inter");
  await syncLicense("playfair-display", "ofl/playfairdisplay");
  await syncLicense("noto-serif-sc", "ofl/notoserifsc");

  writeReadme([
    "# 自托管字体",
    "",
    "这三套字体的文件是 **`pnpm fonts:sync` 拉下来的产物**,提交进仓库。",
    "",
    "## 为什么自托管",
    "",
    "原来走 `next/font/google` —— 构建期去 Google 拉字体。2026-11-14 Vercel 上",
    "构建直接炸了:Google 偶尔返回**没有扩展名**的字体地址,Next 16.1.4 的",
    "Turbopack 解析不了(上游 vercel/next.js#99114)⇒ **构建结果取决于当天",
    "Google 返回什么**。自托管之后构建期不再碰 Google。",
    "",
    "顺带:境内访问 fonts.gstatic.com 不稳,自托管之后字体跟站点同源。",
    "",
    "## 目录",
    "",
    "| 目录 | 字体 | 怎么用 |",
    "|---|---|---|",
    "| `inter/` | Inter(latin, 可变字重 100–900) | `next/font/local`(`src/app/layout.tsx`) |",
    "| `playfair-display/` | Playfair Display(latin, normal + italic) | `next/font/local` |",
    "| `noto-serif-sc/` | Noto Serif SC(101 个切片) | 手写 `@font-face`(`noto-serif-sc/font.css`) |",
    "",
    "## 为什么中文那一套不用 `next/font/local`",
    "",
    "汉字字体是**按码位切片**的,靠 `unicode-range` 告诉浏览器每个文件管哪一段",
    "字形 ⇒ 页面只用到哪几个字就只下哪几个切片。",
    "`next/font/local` **没有 unicode-range 这个口子** ⇒ 用它的话 101 个切片",
    "会被浏览器**全下下来**(6MB/页)。所以中文这一套是手写 `@font-face`。",
    "",
    "## 拉丁字体只留了 latin 子集",
    "",
    "`next/font/local` 也不支持 unicode-range ⇒ 一个文件只能对应一个子集。",
    "latin-ext(ā ő ū 那些)在中文/英文站点上几乎不会出现,缺了也只是",
    "逐字形回退到系统字体。中文那一套是手写 CSS ⇒ **子集是全的**。",
    "",
    "## 许可",
    "",
    "三套字体都是 **SIL Open Font License 1.1**(可自由自托管 / 再分发),",
    "许可正文在各自目录的 `OFL.txt` 里。",
    "",
    "## 重新拉",
    "",
    "```bash",
    "pnpm fonts:sync",
    "```",
    "",
    "脚本用 **Next 自己那个 User-Agent** 发请求(抄",
    "`next/dist/compiled/@next/font/dist/google/fetch-resource.js`)——",
    "换个 UA,Google 会返回不同的子集切法,文件就对不上了。",
    "",
    `当前体积:Noto Serif SC ${(noto.bytes / 1024 / 1024).toFixed(2)} MB / ${noto.files} 个切片 / ${noto.blocks} 条 @font-face。`,
    "",
    `Inter:${inter.files.map((f) => ` ${f.style} ${f.weight}`).join(",")}`,
    "",
    `Playfair Display:${playfair.files.map((f) => ` ${f.style} ${f.weight}`).join(",")}`,
    "",
  ]);

  console.log("[fonts:sync] 完成");
}

main().catch((error) => {
  console.error(
    `[fonts:sync] 失败:${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
