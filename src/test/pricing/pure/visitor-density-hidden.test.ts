import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 访客侧**不摆密度数值**(2026-11-16)
 *
 * 工作室的原话:**「添加文件 4 / 开启 1.20 g/cm³ 1.28 g/cm³
 * 不要显示具体数值」**
 *
 * ## 为什么密度跟单价是同一类东西
 *
 * 工作室更早说过:**「注意模型检测克重报价不要展示 4.5 元/g 这种单价,
 * 避免暴露我们的成本」**。
 *
 * 密度是**同一类**泄漏:
 *
 * ```
 * 密度 × 体积 = 克重
 * 克重 × 单价 = 克重费
 * ⇒ 摆出体积 + 克重 + 克重费,单价就能被反推出来
 * ```
 *
 * 之前单价从响应里删掉了(`PublicPrintQuote` 白名单),密度却还**明文**摆在
 * 材料参数弹窗、批量面板、克重栏的「cm³ × 密度」小字上 ⇒ 那条防漏的口子
 * 一直开着。
 *
 * ## 为什么「只藏数值,标签留着」
 *
 * 工作室说的是**「不要显示具体数值」**,不是「不要显示这一项」——
 *
 * | 留着 | 删掉 |
 * |---|---|
 * | 标签(「模型材料」「支撑材料」) | 访客会以为**工具坏了** |
 * | 「按后台配置」 | 标签孤零零地摆着,更怪 |
 *
 * 访客**改不了**这两个值(后台 `/admin/print-pricing` 配的)⇒ 不摆数值
 * 对访客没有任何信息损失。
 *
 * ## 这个测试守什么
 *
 * 访客侧**四处**都不许摆密度数值:
 *
 * 1. 材料参数弹窗(`pricing-info-dialogs.tsx`)
 * 2. 批量面板(`batch-mode-section.tsx`)
 * 3. 克重算法弹窗里的公式(`info.algorithm.formula`)
 * 4. 主克重栏那个「cm³ × 密度」的小字(`pricing-calculator.tsx`)
 *
 * ⚠️ **断言跑在去掉注释之后的源码上** —— 注释里写着「以前要显示密度」不算违规。
 * ⚠️ **源码扫描用正则,不用跨行的精确字符串** —— Biome 会把长表达式拆行。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着「以前要显示密度」不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

const INFO_DIALOGS = "src/features/pricing/components/pricing-info-dialogs.tsx";
const BATCH_PANEL = "src/features/pricing/components/batch-mode-section.tsx";
const CALCULATOR = "src/features/pricing/components/pricing-calculator.tsx";

/** 密度数值长什么样 —— 1.20 / 1.28 这种 */
const DENSITY_NUMBER = /\d+(?:\.\d+)?\s*g\/cm/i;

/**
 * 密度**作为标识符**出现过 —— 不是 i18n 键名
 *
 * ⚠️ 不能简单地 `not.toContain("materialDensity")` —— 标签那个 i18n 键
 * **就叫** `t("materialDensity")`,还有 `t("info.materials.supportDensityLabel")`
 * 这种带后缀的。**键名不是数值**,留着它是对的。
 *
 * ⇒ 只认「当变量用」的那种出现:
 *  - 前面不是 `"` 也不是别的单词字符(排除 `"materialDensity"` 这种键名)
 *  - 后面不是单词字符(排除 `supportDensityLabel` / `supportDensityHint`)
 */
const DENSITY_IDENTIFIER = /(?<!["\w])(materialDensity|supportDensity)(?!\w)/;

describe("访客侧不摆密度数值", () => {
  it("材料参数弹窗 —— 两个密度值**一个都不摆**", () => {
    const code = stripComments(read(INFO_DIALOGS));

    // 两个密度 prop 已经删掉了 ⇒ 文件里连**变量名**都不该再有
    expect(code).not.toMatch(DENSITY_IDENTIFIER);

    // 标签留着,数值那一格写「按后台配置」
    expect(code).toContain('t("info.materials.densityLabel")');
    expect(code).toContain('t("info.materials.supportDensityLabel")');
    expect(code).toContain('t("info.materials.fromStudio")');
  });

  it("批量面板 —— 两个密度值**一个都不摆**", () => {
    const code = stripComments(read(BATCH_PANEL));

    expect(code).not.toMatch(DENSITY_IDENTIFIER);

    // 标签还在(键名就叫这个 —— 不是数值)
    expect(code).toContain('t("materialDensity")');
    expect(code).toContain('t("supportDensity")');
    // 数值那一格写「按后台配置」
    expect(code).toContain('t("fromStudio")');
  });

  it("克重栏那个小字 —— **只摆体积,不摆密度**", () => {
    const code = stripComments(read(CALCULATOR));

    // JSX 里不许插值密度变量(计算里用是另一回事)
    expect(code).not.toMatch(/\{\s*(materialDensity|supportDensity)\s*\}/);

    // 体积还摆着(访客知道自己下单的东西有多大)
    expect(code).toContain("fmt(calc.volumeCM3, 2)}cm³");
  });

  it("克重算法弹窗的公式 —— 不带密度数值", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    expect(zh.MaterialPricing.info.algorithm.formula).not.toMatch(
      DENSITY_NUMBER
    );
    expect(en.MaterialPricing.info.algorithm.formula).not.toMatch(
      DENSITY_NUMBER
    );
    expect(zh.MaterialPricing.info.algorithm.p2).not.toMatch(DENSITY_NUMBER);
    expect(en.MaterialPricing.info.algorithm.p2).not.toMatch(DENSITY_NUMBER);
  });

  it("批量面板的参数提示 —— 不带密度数值", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    expect(zh.MaterialPricing.batch.settingsReminder).not.toMatch(
      DENSITY_NUMBER
    );
    expect(en.MaterialPricing.batch.settingsReminder).not.toMatch(
      DENSITY_NUMBER
    );

    // 也不许留着占位符(调用点已经不传了 —— 留着就是 next-intl 报错)
    expect(zh.MaterialPricing.batch.settingsReminder).not.toContain(
      "{density}"
    );
    expect(zh.MaterialPricing.batch.settingsReminder).not.toContain(
      "{supportDensity}"
    );
    expect(en.MaterialPricing.batch.settingsReminder).not.toContain(
      "{density}"
    );
    expect(en.MaterialPricing.batch.settingsReminder).not.toContain(
      "{supportDensity}"
    );
  });

  it("材料参数弹窗的说明 —— 不带密度数值", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    expect(zh.MaterialPricing.info.materials.supportDensityHint).not.toMatch(
      DENSITY_NUMBER
    );
    expect(en.MaterialPricing.info.materials.supportDensityHint).not.toMatch(
      DENSITY_NUMBER
    );
  });

  it("「按后台配置」这四个字**中英文都有**", () => {
    const zh = JSON.parse(read("messages/zh.json"));
    const en = JSON.parse(read("messages/en.json"));

    expect(zh.MaterialPricing.info.materials.fromStudio).toBeTruthy();
    expect(en.MaterialPricing.info.materials.fromStudio).toBeTruthy();
    expect(zh.MaterialPricing.batch.fromStudio).toBeTruthy();
    expect(en.MaterialPricing.batch.fromStudio).toBeTruthy();
  });
});
