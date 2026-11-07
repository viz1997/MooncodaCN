import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 支撑**按需**计算 —— 支撑不跟随角度实时变化(2026-11-07)
 *
 * ## 工作室的原话
 *
 * **「支撑不要跟随变化实时变化,用户确定角度后点击显示支撑才计算支撑、总克重」**
 *
 * 以前支撑是**一直算**的:模型一进来就有支撑克重,转一下角度就重算一遍。
 * 工作室不要这个 —— 转模型的时候数字一直跳、页面一直卡,看着像坏了。
 *
 * 现在是这样:
 *
 * ```
 * 转模型(拖旋转控制器)→ 什么都不算(上一次的结果也作废)
 *   → 用户点「包裹支撑」→ 算一次 → 支撑克重 + 总克重 + 画出来那圈支撑
 * ```
 *
 * 三样东西来自**同一次**计算,所以画面跟数字必然对得上。
 *
 * ## 这个测试守住什么
 *
 * | 守卫 | 为什么 |
 * |---|---|
 * | 支撑计算的依赖里**没有角度** | 转一下就重算 —— 退回实时重算 |
 * | 角度一变,上一次的结果作废 | 画面上摆着旧角度的支撑,数字却说是新角度的 |
 * | 外壳跟着那颗开关走 | 关着还画一圈绿 —— 用户以为那是当前姿态的支撑 |
 * | 没算过的时候三个数是「—」 | 摆出一个数,但用户不知道是哪个角度算的 |
 * | 加购之前会现算一次支撑 | 服务端按 `supportWeightG ?? 0` 重算报价,少了它**收少了钱** |
 * | 算不出来就不加 | 拿几何原样去加购 → 支撑费算成 0,收少了钱 |
 * | 模型没焊完会等它 | 刚拖进来就点加购 → 算不出支撑,还是收少了钱 |
 *
 * 全部是文件扫描 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 把注释去掉 —— 注释里写着「以前是实时重算」不算违规 */
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

const CALCULATOR = "src/features/pricing/components/pricing-calculator.tsx";
const SETTINGS_PANEL =
  "src/features/pricing/components/model-settings-panel.tsx";
const WEIGHT_TOOL =
  "src/features/print-quote/components/print-service-weight-tool.tsx";
const ADD_TO_ORDER =
  "src/features/print-quote/components/print-service-add-to-order.tsx";
const QUOTE_SERVER = "src/features/print-quote/lib/quote-server.ts";

describe("支撑按需计算 —— 支撑不跟随角度实时变化", () => {
  it("支撑计算的依赖里**没有角度** —— 转模型不触发重算", () => {
    const code = stripComments(read(CALCULATOR));

    // 那个「算支撑」的 effect:开头就是「没点按钮 → 不算」
    const effect = code.match(
      /if \(!showSupport\) return;[\s\S]*?\}, \[([^\]]*)\]\);/
    );
    expect(effect).not.toBeNull();

    const deps = effect?.[1] ?? "";
    // 依赖里有那颗开关 —— 点一下算一次
    expect(deps).toContain("showSupport");
    // **但没有角度** —— 依赖里有角度的话,拖一下控制器就重算一遍,
    // 数字一直跳、Worker 队列一直满(工作室不要这个)
    expect(deps).not.toContain("manualRot");
    expect(deps).not.toContain("rotX");
    expect(deps).not.toContain("rotY");
    expect(deps).not.toContain("rotZ");
  });

  it("那颗开关默认**关着** —— 模型刚进来时一个支撑都不算", () => {
    const code = stripComments(read(CALCULATOR));

    expect(code).toMatch(
      /const \[showSupport, setShowSupport\] = useState\(false\)/
    );
  });

  it("角度一变,上一次算出来的支撑**作废**(数字清空 + 外壳撤掉 + 按钮回关)", () => {
    const code = stripComments(read(CALCULATOR));

    // 「作废」那三行必须挨着 —— 数字清空、外壳撤掉、按钮回到关的状态
    const invalidation = code.match(
      /setPoseSupport\(null\);\s*setShowSupport\(false\);[\s\S]*?\}, \[([^\]]*)\]\);/
    );
    expect(invalidation).not.toBeNull();

    // 触发条件就是那三个角度
    const deps = invalidation?.[1] ?? "";
    expect(deps).toContain("manualRotX");
    expect(deps).toContain("manualRotY");
    expect(deps).toContain("manualRotZ");
  });

  it("支撑几何只在那颗开关开着的时候喂给视口", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 关着就传 null —— 别让「算过的那块几何」在开关关着的时候还画着
    expect(flat(code)).toMatch(
      /supportShell=\{ ?showSupport \? \(poseSupport\?\.shell \?\? null\) : null ?\}/
    );
  });

  it("没算过支撑的时候,支撑克重和总克重都是「—」", () => {
    const code = stripComments(read(CALCULATOR));

    // 两个数都挂在 `poseSupport` 上 —— 没有就是「—」
    expect(code).toMatch(/poseSupport \? `\$\{supportWeightG\} g` : "—"/);
    expect(code).toMatch(/poseSupport \? `\$\{weights\.total\} g` : "—"/);
    // 没算过的时候有一句提示 —— 别让用户对着「—」猜
    expect(code).toContain('t("stats.supportPendingHint")');
  });

  it("转模型的回调**只改角度** —— 不发指令给 Worker", () => {
    const code = stripComments(read(CALCULATOR));

    // 以前要节流是因为每个事件都往 Worker 发一条 `pose()` 指令
    // (那个客户端没有请求合并,发满了页面反而更卡)。现在不发指令了。
    expect(code).toContain("const handlePoseChange");
    expect(code).toContain("setManualRotX(next.rotX)");
    expect(code).toContain("setManualRotY(next.rotY)");
    expect(code).toContain("setManualRotZ(next.rotZ)");
    expect(code).not.toContain("poseCommitTimerRef");
    expect(code).not.toContain("handlePoseDragEnd");
  });
});

/**
 * 「置于平面」—— 一颗按钮把「落座 + 重算支撑」串成一步(2026-11-07)
 *
 * 工作室要的是「转完模型,点一下就齐活」:
 *
 * ```
 * 转模型(拖旋转控制器)→ 上一次的结果作废(数字清空、支撑撤掉)
 *   → 用户点「置于平面」→ 支撑按当前姿态算一次 → 平台平面按这个姿态重摆
 *                      → 模型坐在托底上 → 支撑克重 / 总克重同时刷新
 * ```
 *
 * 跟「包裹支撑」那颗的区别:那颗是**开关**(按一下算、再按一下不画),
 * 这颗是**动作**(永远算一次、永远落在平台上)。
 */
describe("「置于平面」—— 一颗按钮把落座 + 重算支撑串成一步", () => {
  it("浮层控制条上有这颗按钮", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    expect(code).toContain("onPlaceOnPlane");
    expect(flat(code)).toContain("onClick={onPlaceOnPlane}");
    expect(code).toContain('t("preview.placeOnPlane")');
  });

  it("按下去 = 打开支撑 + 逼着**重算**一次", () => {
    const code = stripComments(read(CALCULATOR));

    const body = flat(code).match(
      /const placeOnPlane = useCallback\(\(\) => \{([\s\S]*?)\}, \[\]\);/
    );
    expect(body).not.toBeNull();
    // 支撑打开 —— 画面上要画出来那圈支撑
    expect(body?.[1] ?? "").toContain("setShowSupport(true)");
    // 令牌 +1 —— 依赖没变的时候(开关本来就开着 / 上次算失败)也一定重算
    expect(body?.[1] ?? "").toContain("setSupportRecalcToken");
  });

  it("令牌在算支撑那个 effect 的依赖里", () => {
    const code = stripComments(read(CALCULATOR));

    const effect = code.match(
      /if \(!showSupport\) return;[\s\S]*?\}, \[([^\]]*)\]\);/
    );
    expect(effect).not.toBeNull();

    const deps = effect?.[1] ?? "";
    expect(deps).toContain("supportRecalcToken");
    // 依赖里**仍然没有角度** —— 落座不许变成「实时重算」
    expect(deps).not.toContain("rotX");
    expect(deps).not.toContain("rotY");
    expect(deps).not.toContain("rotZ");
  });

  it("落座**不碰角度** —— 它是落座 + 重算,不是改姿态", () => {
    const code = stripComments(read(CALCULATOR));

    const body = flat(code).match(
      /const placeOnPlane = useCallback\(\(\) => \{([\s\S]*?)\}, \[\]\);/
    );
    expect(body?.[1] ?? "").not.toContain("setManualRot");
    expect(body?.[1] ?? "").not.toContain("setViewerRot");
  });

  it("计算器把这颗按钮接到面板上", () => {
    const code = stripComments(read(CALCULATOR));

    expect(flat(code)).toContain("onPlaceOnPlane={placeOnPlane}");
  });
});

describe("支撑按需计算 —— 加购那条路不会收少了钱", () => {
  it("服务端按 `supportWeightG` 重算报价,没这个数就是 0", () => {
    const code = stripComments(read(QUOTE_SERVER));

    // 这就是为什么加购之前必须把支撑算出来 —— 少了它,支撑费收成 0
    expect(code).toContain(
      "supportWeight: useSupport ? (input.supportWeightG ?? 0) : 0"
    );
  });

  it("计算器给外面留一个「按当前姿态算一次支撑」的入口", () => {
    const code = stripComments(read(CALCULATOR));

    expect(flat(code)).toContain("const ensureSupport = useCallback");
    // 已经算过就返回现成的,不重算
    expect(flat(code)).toContain(
      "if (poseSupportRef.current && quoteInputRef.current)"
    );
    // 只要数,不要那块最贵的外壳
    expect(code).toContain("withShell: false");
    // 把入口交给父组件
    expect(code).toContain("onEnsureSupport?.(ensureSupport)");
  });

  it("加入打印单之前会 await 那次计算", () => {
    const code = stripComments(read(ADD_TO_ORDER));

    // 用户没点过那颗按钮就直接加购 → 这里现算一次
    expect(code).toContain("await ensureSupport()");
    // 算出来的支撑克重得进规格里 —— 服务端按它重算报价
    expect(code).toContain("buildPrintServiceSpecFromGeometry(fresh, {");
  });

  it("**算不出来就不加** —— 宁可让用户重试,也不能收少了钱", () => {
    const code = stripComments(read(ADD_TO_ORDER));

    // 算不出来 → 报错 + 退出,**不许**拿几何原样(没支撑克重)去加购
    expect(code).toContain('t("printOrder.errors.supportUnavailable")');
    // 不许有「算不出来就退回 input」的兜底 —— 那条路会让支撑费收成 0
    expect(code).not.toContain("?? input");
  });

  it("模型还没焊完的时候,加购会**等**焊接", () => {
    const code = stripComments(read(CALCULATOR));

    // 用户刚拖进来就点「加入打印单」是常事 —— 焊接大模型要好几秒
    expect(code).toContain("await loading;");
    // 等的是焊接那个 promise
    expect(code).toContain("supportLoadRef.current");
  });

  it("工具页把那个入口一路传到「加入打印单」那张卡", () => {
    const tool = stripComments(read(WEIGHT_TOOL));

    expect(tool).toContain("onEnsureSupport={handleEnsureSupport}");
    expect(tool).toContain("ensureSupport={ensureSupport}");
  });
});
