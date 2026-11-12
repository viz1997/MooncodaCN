import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 打印前工作台 —— **排版错位**(2026-11-12)
 *
 * ## 背景:模型一显示,侧栏就被压扁
 *
 * 工作室报的是:**「tools/workbench 的 ui 排版不行,导致模型展示后一些 ui 错位」**。
 *
 * 根因不是「模型挡住了什么」,是 **flex 收缩**:
 *
 * ```
 * 整行(md:h-[…],确定高度)
 *   └─ aside(flex flex-col)
 *        └─ 内容区(flex-1 min-h-0 overflow-y-auto flex flex-col)   ← 有确定高度
 *             ├─ 「尺寸调整」卡(overflow-hidden)
 *             └─ ……
 * ```
 *
 * 内容区是一个**有确定高度的 flex 列** ⇒ 它的子元素默认 `flex-shrink: 1`
 * ⇒ **子元素被压扁,而不是容器滚动**。压扁的那张「尺寸调整」卡自己还带
 * `overflow-hidden` ⇒ 里面的 X/Y/Z 尺寸格**被裁掉一半**(实测 209px 的内容
 * 被压到 96px,裁掉 115px)—— 「改为自选尺寸」那行跟缩放摘要**整个看不见**。
 *
 * **容器自己滚(`overflow-y-auto`)救不了这个** —— 滚动是「内容超出时」的
 * 兜底,子元素先被压到容器高度以内就**根本不超**,压根不会滚。
 *
 * 「检查」那一栏的内容区本来就是**块级**(没这个问题),所以只有「克重」那
 * 一栏错位 —— 两个视角看起来像两个软件。
 *
 * ## 为什么这些都要写成测试
 *
 * 这类退化**不报错** —— 页面照常渲染,只是内容被裁掉一半。工作室不会每次
 * 都盯着每一个宽度看,等他们发现的时候已经是「排版不行」这种没法定位的
 * 反馈。所以这里把**结构**钉死:
 *
 * | 守卫 | 为什么会退化 |
 * |---|---|
 * | 内容区不许是「会被压扁的 flex 列」 | 加个 `flex flex-col` 就为了排间距 —— 排版里最顺手、也最致命的一步 |
 * | 两个视角的内容区结构一致 | 一边改了另一边没改,又是一张脸两张样 |
 * | 整块工作台自己占高度 | 改成给「视口那一行」写死高度 ⇒ 头部一变就错位 |
 * | 视口列的 `min-h-0` 不许只在全屏时才有 | 全屏对了、普通模式还是被压扁 |
 * | 头部 / 视角条 `shrink-0` | 头部一多(徽标换行)就被压扁 |
 * | 角度输入框定宽 | 不写宽度 ⇒ shadcn 的 `w-full` 生效 ⇒ 窄屏压成 14px |
 * | 角度条会换行 | 窄屏把三个输入框压成一条缝 |
 * | 三个克重数同一个字号 | 字号不同 ⇒ 基线不同 ⇒ 看着没对齐 |
 * | 缩略图是深色的 | 深色页面里摆一个白方块 |
 * | 轴标签不重复字母 | 「X 长 X」 |
 *
 * 全部是文件扫描 —— 不需要 DB、不需要网络、不需要浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着「以前是 flex 列」不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

const PANEL = "src/features/pricing/components/model-settings-panel.tsx";
const SHARED = "src/features/pricing/components/shared.tsx";
const CALCULATOR = "src/features/pricing/components/pricing-calculator.tsx";
const THUMBNAIL = "src/features/pricing/components/obj-thumbnail.tsx";

/**
 * 把文件里所有**双引号字符串字面量**抠出来
 *
 * className 在这个仓库里全写成字符串字面量(`"flex-1 min-h-0 …"`),
 * 有时包在 `cn(...)` 里。**一个字符串字面量 = 一个元素的 class** ⇒
 * 「同一个字面量里既有 `overflow-y-auto` 又有 `flex flex-col`」就是
 * 「这个元素既自己滚又是 flex 列」—— 正是要防的那个。
 */
function classLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /"([^"\n]*)"/g;
  let m: RegExpExecArray | null = re.exec(src);
  while (m !== null) {
    out.push(m[1] as string);
    m = re.exec(src);
  }
  return out;
}

/** 取某个组件函数的源码片段(从函数名到下一个顶层 `export`) */
function sliceComponent(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`找不到 ${marker}`);
  const rest = src.slice(start + marker.length);
  const next = rest.search(/^export\s/m);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("工作台排版 —— 模型显示后不能错位", () => {
  const panel = stripComments(read(PANEL));
  const literals = classLiterals(panel);

  // ---------------------------------------------------------------- 根因

  it("① 内容区不许是「会被压扁的 flex 列」", () => {
    // 有确定高度的 flex 列里,子元素默认 flex-shrink:1 ⇒ 被压扁而不是滚动。
    // `overflow-y-auto` 救不了 —— 压到容器高度以内就不超,压根不会滚。
    const offenders = literals.filter(
      (l) => l.includes("overflow-y-auto") && l.includes("flex flex-col")
    );
    expect(offenders).toEqual([]);
  });

  it("② 两个视角的内容区结构一致(都是块级 + 自己滚)", () => {
    // 「检查」:flex-1 min-h-0 overflow-y-auto p-3
    // 「克重」:flex-1 min-h-0 overflow-y-auto p-3 space-y-3
    const contentAreas = literals.filter(
      (l) =>
        l.includes("flex-1") &&
        l.includes("min-h-0") &&
        l.includes("overflow-y-auto") &&
        l.includes("p-3")
    );
    expect(contentAreas.length).toBeGreaterThanOrEqual(2);
    for (const area of contentAreas) {
      // 块级布局 —— 不是 flex 列
      expect(area).not.toContain("flex flex-col");
      expect(area).not.toContain("flex-col");
    }
    // 两边都在
    expect(
      contentAreas.some((a) => a === "flex-1 min-h-0 overflow-y-auto p-3")
    ).toBe(true);
    expect(
      contentAreas.some(
        (a) => a === "flex-1 min-h-0 overflow-y-auto p-3 space-y-3"
      )
    ).toBe(true);
  });

  // ------------------------------------------------------- 高度 / 收缩

  it("③ 整块工作台自己占高度(不给「视口那一行」写死高度)", () => {
    // 头部(文件身份 + 徽标 + 问题条)高度是**变的** ⇒ 高度得给整块,
    // 下面那行用 `flex-1 min-h-0` 吃掉剩下的 ⇒ 三行永远一样高。
    const appHeight = literals.find((l) => l.includes("md:h-[clamp("));
    expect(appHeight).toBeTruthy();
    expect(appHeight).toContain("100dvh_-_180px");
    expect(appHeight).toContain("md:flex");
    expect(appHeight).toContain("md:flex-col");

    // 「视口那一行」不许再写死高度
    const row = literals.find((l) => l.includes("md:flex-row"));
    expect(row).toBeTruthy();
    expect(row).not.toMatch(/h-\[/);
  });

  it("④ 视口列的 `min-h-0` 不是只在全屏时才有", () => {
    const viewportColumn = literals.find((l) => l.includes("md:order-2"));
    expect(viewportColumn).toBeTruthy();
    expect(viewportColumn).toContain("min-h-0");
    expect(viewportColumn).toContain("min-w-0");
    expect(viewportColumn).toContain("md:flex-1");
  });

  it("⑤ 头部跟视角条不许被压扁(`shrink-0`)", () => {
    // 头部高度会变(徽标换行 / 问题条出现)⇒ 压扁它 = 下面的行整体错位。
    expect(panel).toContain(
      '"shrink-0 px-4 py-3 border-b border-zinc-800 bg-zinc-900/60"'
    );
    expect(panel).toContain(
      '"shrink-0 flex items-center gap-1 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2"'
    );
    // 另一支头部(父组件没传 header 时的那一支)也得是 shrink-0
    expect(panel).toContain(
      '"shrink-0 flex items-start justify-between gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-900/60"'
    );
  });

  // ------------------------------------------------------------ 角度条

  it("⑥ 角度输入框是定宽的,不许被 `w-full` 吃掉", () => {
    const angleInput = sliceComponent(
      read(SHARED),
      "export function AngleInput"
    );
    // 外层 `shrink-0` —— 不再 `flex-1` 抢空间
    expect(angleInput).toContain("flex items-center gap-1.5 shrink-0");
    expect(angleInput).not.toContain("flex-1");
    // 输入框定宽 —— 亮 / 暗两支都要
    const widths = angleInput.match(/w-14/g) ?? [];
    expect(widths.length).toBeGreaterThanOrEqual(2);
  });

  it("⑦ 角度条窄的时候换行,不是把输入框压成一条缝", () => {
    const panelRaw = read(PANEL);
    expect(panelRaw).toContain("flex flex-wrap items-center gap-x-3 gap-y-2");
  });

  // ------------------------------------------------------------ 克重数

  it("⑧ 三个克重数是同一个字号(基线才对得齐)", () => {
    const calc = stripComments(read(CALCULATOR));
    const sizes = [
      ...calc.matchAll(/font-mono text-(xl|2xl|3xl|4xl|5xl)\b/g),
    ].map((m) => m[1] as string);
    // 三个数(耗材 / 支撑 / 总)—— 一个都不能少
    expect(sizes.length).toBe(3);
    // 而且字号完全一样
    expect(new Set(sizes)).toEqual(new Set(["2xl"]));
  });

  it("⑨ 耗材那一行的小字不截断(不写空格)", () => {
    // 以前 `8.00 cm³ × 1.20` 在 88px 宽的格子里被 `truncate` 截成
    // 「8.00 cm³ × 1…」⇒ 密度那一项看不见。
    const calc = stripComments(read(CALCULATOR));
    expect(calc).not.toContain("cm³ ×");
  });

  // ------------------------------------------------------------ 缩略图

  it("⑩ 缩略图是深色的(不是深色页面里的白方块)", () => {
    // 去注释 —— 注释里写着「原来是 0xfafaf9」不算违规
    const thumb = stripComments(read(THUMBNAIL));
    expect(thumb).toContain("bg-zinc-900");
    expect(thumb).toContain("border-zinc-800");
    // 不许出现浅色系的 `stone` / `neutral`
    expect(thumb).not.toMatch(/\bstone-\d/);
    expect(thumb).not.toMatch(/\bneutral-\d/);
    // WebGL 的背景色也是深色(zinc-900 = 0x18181b)
    expect(thumb).toContain("0x18181b");
    expect(thumb).not.toContain("0xfafaf9");
  });

  // ------------------------------------------------------------ 轴标签

  it("⑪ 轴标签不重复那个字母(不许出现「X 长 X」)", () => {
    for (const locale of ["zh", "en"]) {
      const msgs = JSON.parse(read(`messages/${locale}.json`));
      const axis = msgs.MaterialPricing?.axis;
      expect(axis).toBeTruthy();
      // 短标签(摆在那三个格子里)只说「长 / 宽 / 高」
      expect(String(axis.length)).not.toMatch(/X/i);
      expect(String(axis.width)).not.toMatch(/Y/i);
      expect(String(axis.height)).not.toMatch(/Z/i);
      // 长标签(带单位那个)也一样
      expect(String(axis.lengthFull)).not.toMatch(/X/i);
      expect(String(axis.widthFull)).not.toMatch(/Y/i);
      expect(String(axis.heightFull)).not.toMatch(/Z/i);
    }
  });

  // ------------------------------------------------- 三个尺寸格装得下

  /**
   * ⑫ 三个尺寸格要装得下完整数值(2026-11-12)
   *
   * 工作室报的是:**「tools/workbench 中三个尺寸的组件没有完全显示数值」**。
   *
   * **根因是算出来的,不是猜出来的** —— 1440px 视口下侧栏 360px,
   * 三个格子各 94.33px,减去 `p-3` 的左右内边距只剩 **70.33px** 可用;
   * 「1,234.5」在 18px 等宽字体下要 **75.61px**,加 4px 间距加 "mm" 的
   * 14.41px ⇒ 需要 **94.02px** ⇒ "mm" 探出卡片右缘 **12.69px**,
   * 被卡片自己的 `overflow-hidden` 切掉 —— 画面上看着像 "mn"。
   *
   * 三处一起改才装得下:
   *
   * | 什么 | 从 | 到 |
   * |---|---|---|
   * | 侧栏宽度 | `md:w-[360px]` | `md:w-[400px] xl:w-[440px]` |
   * | 格子内边距 | `p-3` | `p-2` |
   * | 数值字号 | `text-lg` | `text-base` |
   *
   * 改完实测:1440px(xl ⇒ 440px 侧栏)每格 121px / 可用 105px,
   * X 值 67.2px + "mm" 12px ⇒ 余量 28.8px;1024px(md ⇒ 400px 侧栏)
   * 余量 15.45px。**两个断点都装得下。**
   *
   * ⚠️ **输入框必须写 `min-w-0`** —— `<input>` 的 `min-width` 默认是 `auto`
   * (不小于内容宽度),flex 容器再怎么挤它也不缩 ⇒ 数值一长就把 "mm" 顶出去。
   */
  describe("⑫ 三个尺寸格装得下完整数值", () => {
    it("两个侧栏同宽 —— 加宽到 `md:w-[400px] xl:w-[440px]`", () => {
      const asides = literals.filter((l) => l.includes("md:order-1"));
      expect(asides.length).toBeGreaterThanOrEqual(2);
      for (const aside of asides) {
        expect(aside).toContain("md:w-[400px]");
        expect(aside).toContain("xl:w-[440px]");
        // 旧宽度不许还在(360px 装不下「1,234.5 mm」)
        expect(aside).not.toContain("md:w-[360px]");
      }
      // 两个侧栏**必须一样宽** —— 不然切一次视角视口宽度就变,相机取景会跑偏
      const widths = new Set(
        asides.map((a) => a.match(/md:w-\[[^\]]+\]/)?.[0] ?? "")
      );
      expect(widths.size).toBe(1);
    });

    it("格子的内边距是 `p-2`(不是 `p-3`)", () => {
      const shared = stripComments(read(SHARED));
      for (const fn of [
        "export function DimDisplay",
        "export function DimEditor",
      ]) {
        const body = sliceComponent(shared, fn);
        const card = body.match(/"[^"\n]*bg-zinc-900[^"\n]*"/g) ?? [];
        expect(card.length).toBeGreaterThanOrEqual(1);
        for (const c of card) {
          expect(c).toContain("p-2");
          expect(c).not.toContain("p-3");
        }
      }
    });

    it("数值是 `text-base`(不是 `text-lg`),「mm」是 `text-[10px]`", () => {
      const shared = stripComments(read(SHARED));
      for (const fn of [
        "export function DimDisplay",
        "export function DimEditor",
      ]) {
        const body = sliceComponent(shared, fn);
        expect(body).toContain("text-base");
        expect(body).not.toMatch(/\btext-lg\b/);
        // 「mm」不许跟数值抢宽度 —— `shrink-0` + 小字号
        expect(body).toContain("text-[10px]");
        expect(body).toContain("shrink-0");
      }
    });

    it("数值那格 `min-w-0 truncate` + `title`(离谱的大数宁可截断也不顶掉「mm」)", () => {
      const display = sliceComponent(
        stripComments(read(SHARED)),
        "export function DimDisplay"
      );
      expect(display).toContain("min-w-0 truncate");
      expect(display).toContain("title=");
    });

    it("输入框写 `min-w-0` —— `<input>` 的 min-width 默认是 auto", () => {
      const editor = sliceComponent(
        stripComments(read(SHARED)),
        "export function DimEditor"
      );
      expect(editor).toContain("min-w-0");
      expect(editor).toContain("title=");
    });

    it("数字输入框的上下箭头去掉(Chrome 的 spinner 在 121px 的格子里占 13px)", () => {
      const editor = sliceComponent(
        stripComments(read(SHARED)),
        "export function DimEditor"
      );
      expect(editor).toContain("[appearance:textfield]");
      expect(editor).toContain(
        "[&::-webkit-inner-spin-button]:appearance-none"
      );
      expect(editor).toContain(
        "[&::-webkit-outer-spin-button]:appearance-none"
      );
    });
  });
});
