import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 弹层定位的回归测试(2026-11-05)
 *
 * ## 背景:一个全局 CSS 规则把购物袋抽屉打坏了
 *
 * `src/app/globals.css` 里曾经有:
 *
 * ```css
 * [role="dialog"][data-state="open"] {
 *   top: 50% !important;
 *   --tw-translate-y: -50% !important;
 * }
 * ```
 *
 * 意图是「把 Fumadocs 搜索对话框垂直居中」。但 `[role="dialog"]` 命中的是
 * **每一个** Radix 弹层 —— 包括 shadcn 的 Sheet(抽屉)。
 *
 * Sheet 的定位是 `inset-y-0`(上下贴边、整屏高),被强行拉到 `top: 50%` 之后:
 *
 * ```
 * top: 50% + height: 100%  →  抽屉的上半截在视口里、下半截掉到屏幕外
 * ```
 *
 * 商城购物袋的「去结算」按钮正好在 footer(下半截)里 → **加购之后看不到
 * 结算按钮**。移动端菜单 Sheet 同样受害(导航项还能看见,但底部被切掉)。
 *
 * 这个 bug 没有任何单测能抓到 —— 它是 CSS 层的事。所以这里用一条**读文件**
 * 的测试把它钉住:谁再往 globals.css 里塞一条针对 `[role="dialog"]` 的
 * 通用规则,测试就红。
 *
 * ## 规则本身
 *
 * 各弹层**自己**带定位,不需要全局兜底:
 *
 * | 组件 | 定位 |
 * |---|---|
 * | 本仓库 `Dialog` / `AlertDialog` | `left-[50%] top-[50%] translate-[-50%,-50%]` |
 * | shadcn `Sheet`(抽屉) | `inset-y-0`(上下贴边、整屏高) |
 * | Fumadocs 搜索框(fumadocs-ui 16.x) | 自带 `top-4 md:top-[calc(50%-250px)]` |
 *
 * 真要给某一个弹层改定位,加**它自己的**类名做作用域,别用 `[role="dialog"]`。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 去掉注释,免得注释里的示例文字被当成真规则 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * 抽出 CSS 里所有规则的**选择器**
 *
 * 用正则匹配「不含嵌套花括号」的规则块 —— `@media` 里的规则也会被匹配到
 * (内层那一对花括号才是匹配对象),所以不管规则写在哪儿都跑不掉。
 */
function collectSelectors(css: string): string[] {
  const selectors: string[] = [];
  const rulePattern = /([^{}]+)\{[^{}]*\}/g;
  let match = rulePattern.exec(css);
  while (match !== null) {
    const selector = (match[1] ?? "").trim();
    // @media / @supports 的条件本身不是选择器,跳过
    if (selector && !selector.startsWith("@")) {
      selectors.push(selector);
    }
    match = rulePattern.exec(css);
  }
  return selectors;
}

/**
 * 判断一条选择器是不是「命中所有弹层」的兜底写法
 *
 * 关键不是有没有写 `[role="dialog"]`,而是**有没有别的约束**:
 *
 * | 选择器 | 命中范围 | 判定 |
 * |---|---|---|
 * | `[role="dialog"]` | 所有弹层 | ❌ 兜底 |
 * | `[role="dialog"][data-state="open"]` | 所有打开中的弹层 | ❌ 兜底 |
 * | `.my-dialog[role="dialog"]` | 只有 `.my-dialog` 那一个 | ✅ 有作用域 |
 *
 * 做法:把选择器按逗号拆成单条,再按组合符(空格 / `>` / `+` / `~`)拆成
 * compound,取**最右边**那个(它才是真正落在弹层元素上的那一个)——
 * 如果它去掉属性选择器之后**啥都不剩**,说明这条规则没有类名 / id 兜着,
 * 命中所有弹层。
 */
function isBlanketDialogSelector(selector: string): boolean {
  const roleAttr = /\[role\s*=\s*["']?dialog["']?\]/;
  for (const part of selector.split(",")) {
    const compounds = part
      .trim()
      .split(/[\s>+~]+/)
      .filter(Boolean);
    const last = compounds[compounds.length - 1];
    if (!last) continue;
    // 去掉所有属性选择器之后还剩东西 → 有类名 / id / 标签兜着 → 有作用域
    if (last.replace(/\[[^\]]*\]/g, "").trim() !== "") continue;
    if (roleAttr.test(last)) return true;
  }
  return false;
}

describe("弹层定位 —— 不许用全局 [role=dialog] 兜底", () => {
  /* ---- 检测器本身:分得清「兜底」和「有作用域」 ---- */
  describe("isBlanketDialogSelector", () => {
    it("认得出兜底写法", () => {
      expect(isBlanketDialogSelector('[role="dialog"]')).toBe(true);
      expect(
        isBlanketDialogSelector('[role="dialog"][data-state="open"]')
      ).toBe(true);
      expect(isBlanketDialogSelector("[role=dialog]")).toBe(true);
      // 写在 @media 里也一样(收集器会把它当成一条独立规则)
      expect(
        collectSelectors(
          '@media (min-width: 768px) { [role="dialog"] { top: 50%; } }'
        )
      ).toContain('[role="dialog"]');
    });

    it("放行有作用域的写法", () => {
      // 类名 / id / 标签兜着 → 只命中那一个弹层
      expect(isBlanketDialogSelector('.my-dialog[role="dialog"]')).toBe(false);
      expect(isBlanketDialogSelector("dialog[role=dialog]")).toBe(false);
      expect(isBlanketDialogSelector("#search > .my-dialog[role=dialog]")).toBe(
        false
      );
    });

    it("后代选择器仍然是兜底", () => {
      // `#search [role=dialog]` 落在弹层上的那一位还是「光秃秃的」
      // [role=dialog] —— 它命中 #search 里的**每一个**弹层,一样会打坏抽屉
      expect(isBlanketDialogSelector("#search [role=dialog]")).toBe(true);
    });

    it("注释里的示例文字不算规则", () => {
      const css = '/* [role="dialog"] { top: 50% } */\n.a { color: red }';
      expect(collectSelectors(stripComments(css))).toEqual([".a"]);
    });
  });

  it('globals.css 里没有针对 [role="dialog"] 的通用规则', () => {
    const css = stripComments(
      readFileSync(resolve(ROOT, "src/app/globals.css"), "utf8")
    );
    const offenders = collectSelectors(css).filter(isBlanketDialogSelector);

    expect(
      offenders,
      `globals.css 里有兜底所有弹层的规则:${offenders.join(" | ")} —— ` +
        "它会把所有抽屉(Sheet)拉到视口中间,下半截(含「去结算」按钮)掉到屏幕外。" +
        "要给某个弹层改定位,加它自己的类名做作用域(比如 .my-dialog[role=dialog])。"
    ).toEqual([]);
  });

  it("globals.css 确实被解析到了(别让收集器空转)", () => {
    const css = stripComments(
      readFileSync(resolve(ROOT, "src/app/globals.css"), "utf8")
    );
    // 兜底规则被删了,但文件里还有大量别的规则 —— 收集器要是返回 0,
    // 上面的断言就是「因为什么都没扫到」而通过的假绿灯
    expect(collectSelectors(css).length).toBeGreaterThan(20);
  });

  it("shadcn Sheet 的左右抽屉仍然贴边(inset-y-0)", () => {
    const sheet = readFileSync(
      resolve(ROOT, "src/components/ui/sheet.tsx"),
      "utf8"
    );

    // left / right 两个变体都必须带 inset-y-0 —— 抽屉是「上下贴边、整屏高」
    for (const side of ["left", "right"]) {
      const variant = new RegExp(`${side}:\\s*"([^"]*)"`).exec(sheet);
      expect(variant, `sheet.tsx 里找不到 side="${side}" 的变体`).toBeTruthy();
      expect(
        variant?.[1] ?? "",
        `Sheet 的 "${side}" 变体丢了 inset-y-0 —— 抽屉会变成「半屏高、上下留白」`
      ).toContain("inset-y-0");
    }
  });
});
