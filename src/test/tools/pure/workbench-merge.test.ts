import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 打印前工作台 —— **一个页面,三个视角**(2026-11-07)
 *
 * ## 背景:两个工具页合成一个
 *
 * 工作室的原话:**「不想分成两个工具页」**。以前模型检查
 * (`/tools/model-check`)和克重(`/tools/weight`)是两个页面,同一个文件要
 * 拖两次、解压两次、量两遍,中间还要跳页。
 *
 * 现在合成一个工作台(`/tools/workbench`),模型**只载入一次**,里面用
 * **检查 / 克重 / 摆盘** 三个视角看同一个模型。
 *
 * ## 地址为什么叫 `/tools/workbench`
 *
 * 三个视角里没有一个能代表全名 —— 叫 `/tools/weight` 只说了克重,叫
 * `/tools/model-check` 只说了检查。`/tools/workbench` 是唯一说得通的:
 * 这是一个**工作台**,里面切视角。
 *
 * 三个老地址(`/pricing` / `/tools/weight` / `/tools/model-check`)都 **308
 * 跳**到它 —— 308 而不是 307:这是永久搬家,搜索引擎的权重要转过去。
 *
 * ## 这个测试守住什么
 *
 * 「合并」这件事很容易在后来的改动里**慢慢散掉** —— 有人又加回一个独立
 * 页面、有人让检查面板自己再解析一遍 OBJ、有人给它另算一套缩放。
 * 每一条退化都不会报错,只会让两个视角的数字**对不上**。
 *
 * 这里守的是**结构**,不是行为:
 *
 * | 守卫 | 为什么 |
 * |---|---|
 * | 老地址只重定向,不再有独立页面 | 两个工具页又回来了 |
 * | 三个老地址都 308 跳到 `/tools/workbench` | 权重不转移,或者跳去一个不存在的地方 |
 * | 检查面板吃父组件的 `parseResult`,不自己解析 OBJ | 模型被解析两遍,慢一倍,还可能解析出两个不一样的几何 |
 * | 检查面板按 `scalePositionsXYZ` 缩放 | 尺寸面板改的是**另一边**的几何,两个视角的支撑克重对不上 |
 * | 工具中心只剩一个入口 | 清单里又冒出第二张卡 |
 * | 计算器不再 import 跨页接力模块 | 接力只扛得住客户端路由跳转,扛不住登录往返 |
 *
 * 全部是文件扫描 —— 不需要 DB、不需要网络、不需要浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着「以前是两次解析」不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

const CHECK_PANEL =
  "src/features/tools/components/model-check/model-check-panel.tsx";
const CALCULATOR = "src/features/pricing/components/pricing-calculator.tsx";
const TOOLS_HUB = "src/features/tools/components/tools-hub.tsx";
const WORKBENCH_PAGE =
  "src/app/[locale]/(marketing-atelier)/tools/workbench/page.tsx";

/** 三个老地址 —— 都只该剩一个 308 跳转 */
const LEGACY_PAGES = {
  "/pricing": "src/app/[locale]/(marketing-atelier)/pricing/page.tsx",
  "/tools/weight": "src/app/[locale]/(marketing-atelier)/tools/weight/page.tsx",
  "/tools/model-check":
    "src/app/[locale]/(marketing-atelier)/tools/model-check/page.tsx",
} as const;

describe("工作台 —— 老地址只重定向", () => {
  for (const [path, file] of Object.entries(LEGACY_PAGES)) {
    it(`${path} 308 跳到 /tools/workbench`, () => {
      const code = read(file);

      // `permanentRedirect` = 308。`redirect` 是 307(临时)—— 权重不转移
      expect(code).toContain("permanentRedirect");
      expect(code).not.toMatch(/\bredirect\(\s*`\/\$\{locale\}/);

      // 跳的目标是那个唯一的工作台
      // (用正则匹配字面量 —— 免得 lint 把 `${` 当成漏写的模板串)
      expect(code).toMatch(/`\/\$\{locale\}\/tools\/workbench`/);
    });
  }

  it("老地址那一格里没有第二个工具的实现(不再是一页独立的工具)", () => {
    for (const file of Object.values(LEGACY_PAGES)) {
      const code = stripComments(read(file));

      // 一旦有人把工具的界面搬回这个文件,这个测试会炸
      expect(code).not.toContain("ModelCheckPanel");
      expect(code).not.toContain("useAnalyzer");
      expect(code).not.toContain("<Viewport");
      expect(code).not.toContain("PricingCalculator");
    }
  });

  it("工作台页带上了检查那一套关键词", () => {
    const code = read(WORKBENCH_PAGE);

    // 检查工具以前是独立页面,各自被收录过 —— 合并后两套关键词都得留着
    expect(code).toContain("3D模型检查");
    expect(code).toContain("反转法向");
    expect(code).toContain("3D打印克重");
    expect(code).toContain("支撑克重");
  });
});

describe("工作台 —— 模型只解析一遍", () => {
  it("检查面板吃父组件给的顶点,自己不解析 OBJ", () => {
    const code = stripComments(read(CHECK_PANEL));

    // 顶点来自 `model.parseResult.positions`
    expect(code).toContain("parseResult.positions");

    // **不许**自己再解析一遍(那是最容易悄悄退化回去的地方)
    expect(code).not.toMatch(/from\s+"@\/features\/pricing\/lib\/obj-parser"/);
    expect(code).not.toContain("extractModelZip");
    expect(code).not.toContain("extractDirectObj");
    expect(code).not.toContain("parseObj");

    // `zip-extractor` 只准**类型**导入(`ModelFile`),
    // 值导入 = 它自己去解 ZIP 了
    const valueImport = code.match(
      /import\s+(?!type\b)[^;]*from\s+"@\/features\/pricing\/lib\/zip-extractor"/
    );
    expect(valueImport).toBeNull();
  });

  it("检查面板按克重工具那份缩放缩放顶点", () => {
    const code = read(CHECK_PANEL);

    // 同一个 `scalePositionsXYZ` —— 克重工具算克重用的也是缩放后的几何
    expect(code).toContain("scalePositionsXYZ");
    expect(code).toContain("scales");
  });

  it("计算器不再 import 跨页接力模块", () => {
    const code = stripComments(read(CALCULATOR));

    // 接力模块已删:它扛不住登录往返(登录完是整页跳转)
    expect(code).not.toContain("model-handoff");
    expect(code).not.toContain("takeModelFile");
    expect(code).not.toContain("stashModelFile");
  });

  it("「检查」视角只在这一页渲染(不在后台偷偷跑分析器)", () => {
    const code = read(CALCULATOR);

    // 不渲染就没有这个视角 —— 分析器只在切到「检查」时才启动
    expect(code).toContain('workspaceTab === "check"');
  });
});

describe("工作台 —— 工具中心只剩一个入口", () => {
  it("工具清单里只有 /tools/workbench", () => {
    // 去掉注释 —— 注释里写着「老地址都 308 跳过来」不算违规,
    // 违规的是**代码里**还挂着一个指向老地址的链接
    const code = stripComments(read(TOOLS_HUB));

    expect(code).toContain("/tools/workbench");
    expect(code).not.toContain("/tools/model-check");
    expect(code).not.toContain("/tools/weight");
  });
});
