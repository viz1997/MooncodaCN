import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 打印前工作台 —— **一个页面,两个视角**(2026-11-07)
 *
 * ## 背景:两个工具页合成一个
 *
 * 工作室的原话:**「不想分成两个工具页」**。以前模型检查
 * (`/tools/model-check`)和克重(`/tools/weight`)是两个页面,同一个文件要
 * 拖两次、解压两次、量两遍,中间还要跳页。
 *
 * 现在合成一个工作台(`/tools/workbench`),模型**只载入一次**,里面用
 * **检查 / 克重** 两个视角看同一个模型。
 *
 * 以前还有第三个「摆盘」视角 —— 2026-11-07 **并进克重栏**了(摆盘结果跟
 * 克重本来就是一件事,拆两栏要用户自己把两个数对上)。
 *
 * ## 地址为什么叫 `/tools/workbench`
 *
 * 两个视角里没有一个能代表全名 —— 叫 `/tools/weight` 只说了克重,叫
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
 * | 视角只有两个(没有第三个「摆盘」) | 又把摆盘拆出去了 —— 用户得自己对两个数 |
 * | 全屏是**整块工作台** | 只放大视口的话,左栏那三个克重数还在屏幕外 |
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

/**
 * 把空白压成单个空格
 *
 * Biome 会把长表达式折行(JSX 属性、`useCallback(...)` 的参数列表)——
 * 逐字匹配就断了。压平之后匹配的是**代码**,不是排版。
 */
function flat(src: string): string {
  return src.replace(/\s+/g, " ");
}

const CHECK_PANEL =
  "src/features/tools/components/model-check/model-check-panel.tsx";
const CHECK_VIEW =
  "src/features/tools/components/model-check/use-check-view.ts";
const SETTINGS_PANEL =
  "src/features/pricing/components/model-settings-panel.tsx";
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
  it("工作台框架吃父组件给的顶点,自己不解析 OBJ", () => {
    const code = stripComments(read(SETTINGS_PANEL));

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

  it("检查侧栏不自己解析顶点、不自己缩放(吃的是同一份)", () => {
    const code = stripComments(read(CHECK_PANEL));

    // 缩放后的顶点由工作台框架算好传进来 —— 两边各缩放一次的话,
    // 尺寸面板改的是**另一边**的几何,两个视角的支撑克重对不上
    expect(code).not.toContain("parseResult.positions");
    expect(code).not.toContain("scalePositionsXYZ");
    expect(code).not.toMatch(/from\s+"@\/features\/pricing\/lib\/obj-parser"/);
  });

  it("按克重工具那份缩放缩放顶点", () => {
    const code = read(SETTINGS_PANEL);

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
});

describe("工作台 —— 共用一个展示区域", () => {
  it("整个工作台只挂**一个** `ModelViewport`", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 切视角只换喂进去的数据 —— 视口不卸载,相机不动,模型不重建
    expect(code.match(/<ModelViewport/g) ?? []).toHaveLength(1);
  });

  it("「检查」那一栏不自己挂视口(它只剩右栏那一块)", () => {
    const code = stripComments(read(CHECK_PANEL));

    expect(code).not.toContain("ModelViewport");
  });

  it("分析器只在切到「检查」那一栏时才启动", () => {
    const frame = stripComments(read(SETTINGS_PANEL));
    expect(frame).toContain('active: tab === "check"');

    const hook = stripComments(read(CHECK_VIEW));
    expect(hook).toContain("if (!active || !positions) return;");
  });

  it("支撑几何永远是摆盘 Worker 算的那块(不是分析器自带的那块)", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 算克重的那块支撑 —— 画出来的也得是它,否则转个角度画面就跟数字对不上。
    // 外壳跟着那颗开关走:关着就不画(支撑不跟随角度实时变化,见
    // `support-on-demand.test.ts`)。
    expect(flat(code)).toMatch(
      /supportShell=\{ ?showSupport \? \(poseSupport\?\.shell \?\? null\) : null ?\}/
    );
  });

  it("模型角度两个视角都吃得到(转的是**模型**,不是视角)", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 姿态无条件传给视口 —— 不分视角
    expect(code).toContain("pose={{");
    expect(code).toContain("rotX: viewerRotX");
    // 角度条常驻 —— 不是「跑过智能摆盘才出现」
    expect(code).toContain('t("angle.modelAngle")');
  });

  it("侧栏在**左**、3D 视口在**右**(跟以前那个检查工具一个方向)", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 工作室的原话:「克重区域应该像之前的检查区域那样,而不是反过来」
    // —— 以前那个模型检查工具是「侧栏左 + 视口右」,所以是**克重那一栏**
    // 改成那个排布,不是把检查那一栏塞进右栏。
    //
    // 断点也是跟旧检查工具一样(`md`,768px 就并排)—— 等到 `lg` 的话,
    // 768~1023px 这段窗口里还摆着老克重工具的方向(视口在上、面板在下)。

    // 整块:一行两列
    expect(code).toContain("md:flex-row");

    // 侧栏(`<aside>`):桌面端排在左边
    // (className 走 `cn(...)`,所以按整个开标签取,别按 `className="…"` 取)
    const asides = code.match(/<aside[\s\S]*?>/g) ?? [];
    expect(asides.length).toBeGreaterThan(0);
    for (const tag of asides) expect(tag).toContain("md:order-1");

    // 视口那一列:桌面端排在右边(手机上还是在上,所以 DOM 里在前面)
    expect(code).toContain('"order-1 md:order-2');
  });

  it("两个视角的侧栏同宽 —— 不然切一次视角视口宽度就变,相机取景会跑偏", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    const widths = code.match(/md:w-\[\d+px\]/g) ?? [];
    expect(widths.length).toBeGreaterThan(0);
    expect(new Set(widths).size).toBe(1);
  });

  it("整个工作台统一用检查工具的深色设计 —— 两个视角换的是左栏内容", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 整块是一个深色应用(以前那个检查工具就是深色的)
    expect(code).toContain("bg-zinc-950 text-zinc-100");

    // 左栏:检查 / 克重换的是**内容**,外壳统一
    const asides = code.match(/<aside[\s\S]*?>/g) ?? [];
    expect(asides.length).toBe(2);
    for (const tag of asides) {
      expect(tag).toContain("md:order-1");
      // 两个侧栏都不许再带浅色底 —— 以前克重那一栏是浅色的,
      // 跟检查工具的深色设计对不上
      expect(tag).not.toContain("border-stone-200");
    }
  });

  it("视角只有两个 —— 「摆盘」并进克重栏了", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 切换条上就两颗按钮
    expect(code).toContain('export type WorkspaceTab = "check" | "weight"');
    expect(code).toContain('{ id: "check", icon: ShieldCheck }');
    expect(code).toContain('{ id: "weight", icon: Scale }');
    // 不许再有第三个视角
    expect(code).not.toContain('id: "pose"');
    expect(code).not.toContain('tab === "pose"');

    // 摆盘结果并进克重栏(`weight` 插槽),不再是单独的插槽
    const calc = stripComments(read(CALCULATOR));
    expect(calc).toContain("const weightColumn = (");
    expect(calc).toContain("weight={weightColumn}");
    expect(calc).not.toContain("pose={");
  });

  it("全屏是**整块工作台**(不是只放大视口)", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 走浏览器的 Fullscreen API —— 不是 `position: fixed` 那种假全屏
    expect(code).toContain("requestFullscreen");
    expect(code).toContain("exitFullscreen");
    expect(code).toContain("fullscreenchange");

    // 整块(头部 / 视角切换 / 信息栏 / 视口)一起放大。
    // 样式**状态驱动**(`fullscreen && "…"`),不用 `[:fullscreen]:` 变体 ——
    // 变体那套跟工具类名叠在一起时优先级说不清,全屏下有一半没显示。
    expect(code).toContain("h-screen w-screen");
    expect(code).toContain("rounded-none");
    expect(code).toContain("flex flex-col overflow-hidden");
    // 左边那一栏也得能滚(不然全屏下内容被截断)
    expect(code).toContain("min-h-0 overflow-y-auto");
    expect(code).not.toContain("[:fullscreen]:");
  });

  it("进了全屏要重新取景 —— 比例变了,原来那个距离会把模型裁掉一半", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 视口的宽高比一变(进全屏 / 退全屏),相机得按新比例重新取景
    expect(code).toContain("setFitSignal");
    expect(code).toMatch(/\[fullscreen\]/);
  });

  it("转模型用**旋转控制器**,不是左键拖着模型瞎转", () => {
    const frame = stripComments(read(SETTINGS_PANEL));

    // 拖动回调一路传到视口
    expect(frame).toContain("onPoseChange={onPoseChange}");

    const calc = stripComments(read(CALCULATOR));
    // 控制器改的是 quaternion —— 分解回仓库口径的欧拉角
    expect(calc).toContain("const handlePoseChange");
    expect(calc).toContain("setManualRotX");
    expect(calc).toContain("setManualRotY");
    expect(calc).toContain("setManualRotZ");
  });

  it("空状态(还没拖文件)也是深色的 —— 拖完不换脸", () => {
    const code = stripComments(read(CALCULATOR));

    // 以前那个模型检查工具**从第一屏就是深色的** —— 拖放区在那块深色面板
    // 里面。工作台统一用那个设计,空状态也得是深色的:拖完文件之后整块
    // 不换脸(以前是浅色卡片 → 深色应用,中间整个跳一次)。
    const dashed = code.match(
      /className=\{`[^`]*border-2 border-dashed[^`]*`\}/
    );
    expect(dashed).not.toBeNull();
    expect(dashed?.[0]).toContain("bg-zinc-950");

    // 旧的浅色拖放区不许再回来
    expect(code).not.toContain("bg-stone-50/40");
    expect(code).not.toContain("border-stone-300");
  });
});

describe("工作台 —— 报价按钮在区域内,不在右栏(2026-11-09)", () => {
  it("右栏那一列(288px)整个撤掉了 —— 它把 3D 视口挤成了窄条", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 以前工作台右边有一列 288px 的「提交打印订单」卡片(报价 + 下单入口)。
    // 工作室把报价改成区域内一颗按钮 ⇒ 那一列没有存在理由了。
    expect(code).not.toContain("xl:w-[288px]");
    expect(code).not.toContain("xl:shrink-0");
  });

  it("报价按钮挂在**左栏底部的固定条**上(2026-11-10)", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // `primaryAction` 插槽 —— 打印服务把「报价」那颗按钮挂在这儿
    expect(code).toContain("primaryAction?: ReactNode");
    expect(code).toContain("{primaryAction ? (");
    // 以前那个插槽叫 `toolbarExtra` —— 挂在浮层药丸的尾巴上,主出口被埋
    expect(code).not.toContain("toolbarExtra");

    // **两个视角的侧栏都摆这一条** —— 切一下 tab,出口不该消失
    const asideBlocks = code.match(/<aside[\s\S]*?<\/aside>/g) ?? [];
    expect(asideBlocks).toHaveLength(2);
    for (const block of asideBlocks) {
      expect(block).toContain("{primaryAction ? (");
      // 固定条**不参与滚动**(`shrink-0`),内容区自己滚
      expect(block).toContain("shrink-0");
      expect(block).toContain("min-h-0 overflow-y-auto");
    }
  });

  it("计算器把 `quoteActionSlot` 接到工作台框架的 `primaryAction` 上", () => {
    const calc = stripComments(read(CALCULATOR));

    expect(calc).toContain("quoteActionSlot?: ReactNode");
    expect(calc).toContain("primaryAction={quoteActionSlot}");
    // 以前那个插槽叫 `quoteSlot` —— 挂的是整张卡,不是按钮
    expect(calc).not.toContain("quoteSlot");
    expect(calc).not.toContain("toolbarExtra");
  });
});

describe("工作台 —— 浮层药丸只管「看图」(2026-11-10)", () => {
  /** 药丸那一块 —— 「显示贴图」「重置视角」 */
  function pill(code: string): string {
    const m = code.match(
      /pointer-events-auto absolute bottom-3[\s\S]*?<\/div>/
    );
    expect(m).not.toBeNull();
    return m?.[0] ?? "";
  }

  it("药丸**永不换行**", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 以前是 `flex-wrap` —— 窄屏换行成两排,七样东西挤在一起
    const p = pill(code);
    expect(p).toContain("flex-nowrap");
    expect(p).not.toContain("flex-wrap");
    // 宽度收到 95% —— 加上 `flex-nowrap`,物理上不可能换行
    expect(p).toContain("max-w-[95%]");
  });

  it("药丸里只剩「看图」的工具", () => {
    const code = stripComments(read(SETTINGS_PANEL));
    const p = pill(code);

    // 留着的:显示贴图 / 重置视角
    expect(p).toContain("onToggleTexture");
    expect(p).toContain("setFitSignal");

    // 搬走的:包裹支撑 / 置于平面 / 主出口
    expect(p).not.toContain("onToggleSupport");
    expect(p).not.toContain("onPlaceOnPlane");
    expect(p).not.toContain("primaryAction");
  });

  it("检查图层开关搬进**检查侧栏**了 —— 那是面板状态,不是工具", () => {
    const frame = stripComments(read(SETTINGS_PANEL));

    // 框架把图层开关喂给侧栏
    expect(frame).toContain("legend={check.activeLegend}");
    expect(frame).toContain("visibility={check.visibility}");
    expect(frame).toContain("onToggleVisibility");

    // 侧栏自己摆那些 chips(条目文案走 `ISSUE_LABEL_KEYS`,不新增 i18n key)
    const panel = stripComments(read(CHECK_PANEL));
    expect(panel).toContain("ISSUE_LABEL_KEYS");
    expect(panel).toContain("onToggleVisibility");

    // 药丸里不许再有图层开关
    expect(pill(frame)).not.toContain("activeLegend");
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
