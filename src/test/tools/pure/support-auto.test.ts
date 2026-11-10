import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 支撑**自动**计算 —— 跟着尺寸和姿态走(2026-11-10)
 *
 * ## 为什么改口径
 *
 * 2026-11-07 工作室说的是:**「支撑不要跟随变化实时变化,用户确定角度后点击
 * 显示支撑才计算支撑、总克重」**。那一版把「算不算」的开关交给了那颗
 * 「包裹支撑」按钮 —— 于是模型刚进来,三个克重数里有两个是「—」。
 *
 * 2026-11-10 工作室重新提了一遍设计,点名的是**「克重默认两个『—』」**:
 * 用户拖完模型,看到两个空的格子,以为工具坏了。
 *
 * 现在的口径:
 *
 * | 事件 | 支撑克重 |
 * |---|---|
 * | 模型焊好(首次) | **立刻自动算一次** —— 三个数立刻齐全 |
 * | 改尺寸 | 400ms 防抖后自动重算 |
 * | 转姿态(拖控制器) | 拖动过程中不算;停下来 400ms 后算一次 |
 * | 点「置于平面」 | 落座 + **立刻重算一次** |
 * | 点「画出支撑」 | 只控制**画不画**那圈外壳,**不再决定算不算** |
 *
 * 「改尺寸要重算」**不是**「实时重算」—— 防抖 400ms 挡住的是「拖滑块时
 * 反复算」,不是「算完不更新」。数字该更新就更新,只是别在拖的时候跳。
 *
 * ## 这个测试守住什么
 *
 * | 守卫 | 为什么 |
 * |---|---|
 * | 支撑计算的依赖里**没有角度** | 退回实时重算 —— 拖一下就重算,数字一直跳 |
 * | 第一次**立刻**算 | 又变回「模型进来两个「—」」 |
 * | 写回前对照缓存键 | 用户算的过程中又动了,旧结果盖掉新的 |
 * | 作废 effect 没了 | 「改尺寸不重算」⇒ 旧尺寸的支撑费按新尺寸收(**少收钱**) |
 * | 外壳跟着那颗开关走 | 关着还画一圈绿 —— 用户以为那是当前姿态的支撑 |
 * | 四态读数 | 「—」是常态 = 用户以为工具坏了 |
 * | 提交之前会现算一次支撑 | 服务端按 `supportWeightG ?? 0` 重算报价,少了它**收少了钱** |
 * | 缓存键对得上才算过 | 改完尺寸直接提交 ⇒ 发上去的是**旧尺寸**的支撑克重 |
 * | 算不出来就不提交 | 拿几何原样去下单 → 支撑费算成 0,收少了钱 |
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
const QUOTE_SERVER = "src/features/print-quote/lib/quote-server.ts";

describe("支撑自动计算 —— 跟着尺寸和姿态走", () => {
  it("支撑计算的依赖里**没有角度** —— 转模型不触发重算", () => {
    const code = stripComments(read(CALCULATOR));

    // 那个「算支撑」的 effect:开头就是「没有请求键 → 不算」
    const effect = code.match(
      /if \(!supportRequestKey\) return;[\s\S]*?\}, \[([^\]]*)\]\);/
    );
    expect(effect).not.toBeNull();

    const deps = effect?.[1] ?? "";
    // 触发条件是**防抖后的键** —— 角度只经由它进来
    expect(deps).toContain("supportRequestKey");
    // 「置于平面」那个令牌也要在依赖里(见下面那一组)
    expect(deps).toContain("supportRecalcToken");
    // **但没有角度** —— 依赖里有角度的话,拖一下控制器就重算一遍,
    // 数字一直跳、Worker 队列一直满(工作室不要这个)
    expect(deps).not.toContain("manualRot");
    expect(deps).not.toContain("rotX");
    expect(deps).not.toContain("rotY");
    expect(deps).not.toContain("rotZ");
  });

  it("拖动的时候有 400ms 防抖 —— 数字别一直跳", () => {
    const code = stripComments(read(CALCULATOR));

    expect(code).toContain("SUPPORT_RECALC_DEBOUNCE_MS");
    expect(flat(code)).toContain("const SUPPORT_RECALC_DEBOUNCE_MS = 400");
    // 防抖靠 `setTimeout`
    expect(flat(code)).toMatch(
      /setTimeout\(\(\) => \{ setSupportRequestKey\(currentSupportKey\); \}, SUPPORT_RECALC_DEBOUNCE_MS\)/
    );
  });

  it("**第一次立刻算** —— 模型刚进来三个数就齐全,不是两个「—」", () => {
    const code = stripComments(read(CALCULATOR));

    // 还没算过(`supportKey === null`)→ 不等那 400ms,直接写请求键
    const debounce = flat(code).match(
      /if \(supportKey === null\) \{ setSupportRequestKey\(currentSupportKey\); return; \}/
    );
    expect(debounce).not.toBeNull();
  });

  it("写回之前对照缓存键 —— 用户算的过程中又动了就丢掉这份", () => {
    const code = stripComments(read(CALCULATOR));

    expect(flat(code)).toContain(
      "if (usedKey !== currentSupportKeyRef.current) return;"
    );
  });

  it("那颗开关默认**关着** —— 但它只管**画不画**,不再管算不算", () => {
    const code = stripComments(read(CALCULATOR));

    expect(code).toMatch(
      /const \[showSupport, setShowSupport\] = useState\(false\)/
    );
    // 算支撑的 effect **不看**那颗开关 —— 开关是显示的事
    const effect = code.match(
      /if \(!supportRequestKey\) return;[\s\S]*?\}, \[([^\]]*)\]\);/
    );
    expect(effect?.[1] ?? "").not.toContain("showSupport");
  });

  it("「角度一变就作废」那个 effect **没了** —— 现在是自动重算", () => {
    const code = stripComments(read(CALCULATOR));

    // 以前是「数字清空 + 外壳撤掉 + 按钮回关」三连 —— 那条会让改完尺寸
    // 直接提交的人**发上去旧尺寸的支撑克重**(少收钱)
    expect(code).not.toMatch(
      /setPoseSupport\(null\);\s*setShowSupport\(false\)/
    );
  });

  it("支撑几何只在那颗开关开着的时候喂给视口", () => {
    const code = stripComments(read(SETTINGS_PANEL));

    // 关着就传 null —— 别让「算过的那块几何」在开关关着的时候还画着
    expect(flat(code)).toMatch(
      /supportShell=\{ ?showSupport \? \(poseSupport\?\.shell \?\? null\) : null ?\}/
    );
  });

  it("读数是**四态** —— 「—」不再是常态", () => {
    const code = stripComments(read(CALCULATOR));

    // 四态:计算中 / 更新中 / 就绪 / 出错
    expect(code).toContain(
      'const supportState: "computing" | "updating" | "ready" | "error"'
    );
    expect(code).toContain('t("stats.supportComputing")');
    expect(code).toContain('t("stats.supportUpdating")');
    expect(code).toContain('t("stats.supportWeightError"');
    // 「—」只出现在**算不出来**的那一档
    expect(code).toContain('supportState === "error"');
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
 * 转模型(拖旋转控制器)→ 400ms 后自动重算一次
 *   → 用户点「置于平面」→ 支撑按当前姿态**立刻**算一次 → 平台平面按这个姿态重摆
 *                      → 模型坐在托底上 → 支撑克重 / 总克重同时刷新
 * ```
 *
 * 跟「画出支撑」那颗的区别:那颗是**开关**(按一下画、再按一下不画),
 * 这颗是**动作**(永远算一次、永远把模型放在平台上)。
 *
 * 2026-11-10:两颗按钮从浮层药丸搬进了克重侧栏的「姿态与支撑卡」。
 */
describe("「置于平面」—— 一颗按钮把落座 + 重算支撑串成一步", () => {
  it("克重侧栏的姿态与支撑卡上有这颗按钮", () => {
    const code = stripComments(read(CALCULATOR));

    expect(code).toContain('t("preview.placeOnPlane")');
    expect(flat(code)).toContain("onClick={placeOnPlane}");
    // 姿态与支撑卡 —— 所有跟姿态有关的归一处
    expect(code).toContain('t("preview.poseAndSupport")');
    expect(code).toContain('t("angle.optimize")');
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
    // 键得是最新的那把(用户可能刚改完尺寸,防抖还没到)
    expect(body?.[1] ?? "").toContain(
      "setSupportRequestKey(currentSupportKeyRef.current)"
    );
  });

  it("令牌在算支撑那个 effect 的依赖里", () => {
    const code = stripComments(read(CALCULATOR));

    const effect = code.match(
      /if \(!supportRequestKey\) return;[\s\S]*?\}, \[([^\]]*)\]\);/
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
});

describe("支撑自动计算 —— 提交订单那条路不会收少了钱", () => {
  it("服务端按 `supportWeightG` 重算报价,没这个数就是 0", () => {
    const code = stripComments(read(QUOTE_SERVER));

    // 这就是为什么提交之前必须把支撑算出来 —— 少了它,支撑费收成 0
    expect(code).toContain(
      "supportWeight: useSupport ? (input.supportWeightG ?? 0) : 0"
    );
  });

  it("计算器给外面留一个「按当前姿态算一次支撑」的入口", () => {
    const code = stripComments(read(CALCULATOR));

    expect(flat(code)).toContain("const ensureSupport = useCallback");
    // 只要数,不要那块最贵的外壳
    expect(code).toContain("withShell: false");
    // 把入口交给父组件
    expect(code).toContain("onEnsureSupport?.(ensureSupport)");
  });

  it("缓存**对得上缓存键**才算算过 —— 旧尺寸的支撑克重不许发去下单", () => {
    const code = stripComments(read(CALCULATOR));

    // 三个条件都要成立:有结果 / 那份输入真的带上了支撑克重 / 键对得上
    expect(flat(code)).toContain("supportKeyRef.current ==");
    expect(flat(code)).toContain("currentSupportKeyRef.current");
    expect(flat(code)).toContain(
      "quoteInputRef.current.supportWeightG !== null"
    );
  });

  it("报价输入**只在支撑新鲜时**才抛给父组件 —— 预估价不许偏低", () => {
    const code = stripComments(read(CALCULATOR));

    expect(flat(code)).toContain(
      "supportFresh && poseSupport ? Math.ceil(poseSupport.supportWeightG) : null"
    );
    expect(flat(code)).toContain(
      "supportFresh && poseSupport ? supportStats.ratio : null"
    );
  });

  it("提交订单之前会 await 那次计算", () => {
    const code = stripComments(read(WEIGHT_TOOL));

    // 用户刚拖进来就提交 → 这里现算一次
    expect(code).toContain("await ensureSupport()");
    // 算出来的支撑克重直接进报价输入 —— 服务端按它重算报价
    expect(code).toContain(
      "quote: { ...fresh, deliveryTier: values.deliveryTier }"
    );
  });

  it("**算不出来就不提交** —— 宁可让用户重试,也不能收少了钱", () => {
    const code = stripComments(read(WEIGHT_TOOL));

    // 算不出来 → 报错 + 退出,**不许**拿几何原样(没支撑克重)去下单
    expect(code).toContain('t("printOrder.errors.supportUnavailable")');
    // 不许有「算不出来就退回 input」的兜底 —— 那条路会让支撑费算成 0
    expect(code).not.toContain("?? input");
  });

  it("模型还没焊完的时候,提交订单会**等**焊接", () => {
    const code = stripComments(read(CALCULATOR));

    // 用户刚拖进来就点提交是常事 —— 焊接大模型要好几秒
    expect(code).toContain("await loading;");
    // 等的是焊接那个 promise
    expect(code).toContain("supportLoadRef.current");
  });

  it("工具页把那个入口接住了 —— 计算器 → 工具 → 提交订单", () => {
    const tool = stripComments(read(WEIGHT_TOOL));

    expect(tool).toContain("onEnsureSupport={handleEnsureSupport}");
    // 提交的时候走的是同一个 ensureSupport
    expect(tool).toContain("const fresh = await ensureSupport();");
  });
});
