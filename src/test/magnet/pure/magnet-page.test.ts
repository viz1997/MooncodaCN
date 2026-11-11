import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `/tools/magnet` 页面这一层的守卫(2026-11-10,**2026-11-11 补了三条**)
 *
 * 纯函数那一层(切刀数学 / 布尔 / OBJ 写出)由 `magnet-params.test.ts` 和
 * `magnet-cut.test.ts` 守住。这个文件守的是**页面与接线**那一层:
 *
 * 1. **路由在** —— `/tools/magnet` 真的存在,挂在 `(marketing-atelier)` 组
 *    (跟打印工作台同一组,共用商城那个头)
 * 2. **工具中心登记了** —— 工具卡片能进得去
 * 3. **视口是复用的那一份** —— 整个仓库只有 `shared/components/model-viewport/`
 *    一个视口,磁吸孔工具**不许**自己再写一个
 * 4. **不碰钱的那条链路** —— 这个工具**不进工单**:切完只本地下载。
 *    报价 / 工单 / R2 上传 / 支撑克重**一行都不许碰**
 * 5. **拖放用仓库那个 hook** —— 自己写 `onDragOver` 那个写法就是会闪的那份
 * 6. **焊接走仓库唯一公开入口** —— `weldAndAnalyzeTopology()`;
 *    `weldVertices` 是模块私有的,拿不到
 * 7. **焊接在修复之前** —— 磁吸孔自己那一份**容差阶梯**先把「同一个点」
 *    认出来(仓库那份太严:diag × 1e-7 vs Blender 的 0.1mm),再谈补洞
 * 8. **孔径是绝对毫米** —— Blender 脚本里那个「孔径跟着模型最大边缩放」的
 *    临时假设**不许**被搬进来(2026-11-11 起孔径**可调**,但**仍然是绝对
 *    毫米** —— 孔是实物磁铁的尺寸,不是模型的比例)
 * 9. **wasm 提交进仓库** —— 新克隆的机器不用先跑脚本
 *
 * 2026-11-11 工作室提的三条,也在这一层守着:
 *
 * - **① 磁吸沉孔可调** —— 页面上有孔径 / 深度两个输入,走 `normalizeHoleParams`
 * - **② 智能识别背面** —— `magnet-backface.ts` 那份「按面积找最大平面区域」
 *   接进了分析链路,页面能选具体哪一块(`patch:N`)
 * - **③ 导出保留材质贴图** —— 导出走 `writeObjFromSoup` + `downloadModelZip`,
 *   OBJ 里有 `vt` / `usemtl` / `mtllib`
 *
 * 2026-11-11 工作室追加的两条也在这一层:
 *
 * - **④ 模型不是封闭实体 ⇒ 照样切** —— `magnet-repair.ts` 那份纯函数做
 *   网格清理(剔重复面 / 拆蝴蝶结顶点 / 翻绕序),`magnet-lid.ts` 那份做
 *   **临时盖面**,接在布尔运算**之前**
 * - **⑤ 不需要修复用户的模型** —— 盖面是**临时的**:只喂给布尔运算,切完
 *   从输出里摘掉 ⇒ 用户的模型上不会多出任何几何(工作室原话:
 *   「不需要修复用户的模型,只需要完成磁铁孔」)
 * - **⑥ XYZ 分别调尺寸** —— 像打印工作台那样:统一缩放 / X·Y·Z 分别两档,
 *   走仓库同一个 `scalePositionsXYZ`
 *
 * 全部是文件扫描 + 常量 —— 不需要 DB / 网络 / 浏览器。
 */

/** 仓库根目录 */
const ROOT = resolve(process.cwd());

/** 读文件(不存在就抛 —— 路径写错了要立刻炸,不是静默跳过) */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

/** 读一份语言包(仓库惯例:读文件 + JSON.parse,不在测试里 import JSON) */
function messages(locale: "zh" | "en"): Record<string, unknown> {
  return JSON.parse(read(`messages/${locale}.json`)) as Record<string, unknown>;
}

/** 把注释去掉 —— 注释里**提到**那个名字不算违规 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/)/.test(line))
    .join("\n");
}

/**
 * 把一棵对象树摊平成「点号路径 → 值」
 *
 * 中英文 key 一致**要递归比** —— 只比第一层的话,`hole.diaLabel` 这种
 * 少写一个,上层看到的还是「两边都有 hole」,漏过去了。
 */
function flattenKeys(obj: unknown, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    out[prefix] = obj;
    return out;
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenKeys(value, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}

const ROUTE = "src/app/[locale]/(marketing-atelier)/tools/magnet/page.tsx";
const TOOL = "src/features/magnet/components/magnet-cutter-tool.tsx";
const HANDLER = "src/features/magnet/lib/magnet-cutter-handler.ts";
const PARAMS = "src/features/magnet/lib/magnet-params.ts";
const BACKFACE = "src/features/magnet/lib/magnet-backface.ts";
const WRITE_OBJ = "src/features/magnet/lib/write-obj.ts";
const PROTOCOL = "src/features/magnet/lib/magnet-cutter-protocol.ts";
const ERROR_MAP = "src/features/magnet/lib/magnet-error.ts";
const HUB = "src/features/tools/components/tools-hub.tsx";
const REPAIR = "src/features/magnet/lib/magnet-repair.ts";
const WELD = "src/features/magnet/lib/magnet-weld.ts";
const LID = "src/features/magnet/lib/magnet-lid.ts";
const MODEL_UNITS = "src/features/pricing/lib/model-units.ts";
const BENCH_SHARED = "src/features/pricing/components/shared.tsx";

describe("磁吸孔工具页面", () => {
  it("路由在(挂在 (marketing-atelier) 组 —— 跟打印工作台同组)", () => {
    expect(existsSync(join(ROOT, ROUTE))).toBe(true);
    const src = read(ROUTE);
    // 渲染的是那个客户端工具组件
    expect(src).toContain("MagnetCutterTool");
    // 页面里没有 session / DB —— 这是个公开工具页
    expect(src).not.toMatch(/getServerSession|@\/db/);
  });

  it("工具中心登记了这条工具", () => {
    const src = read(HUB);
    expect(src).toContain('href: "/tools/magnet"');
    expect(src).toContain('key: "magnet"');
  });

  it("视口是仓库里那**一份** —— 不是新写的视口", () => {
    const src = read(TOOL);
    expect(src).toContain('from "@/features/shared/components/model-viewport"');
    // 旧的两份视口文件不许复活
    expect(
      existsSync(join(ROOT, "src/features/pricing/components/obj-viewer.tsx"))
    ).toBe(false);
    expect(
      existsSync(
        join(ROOT, "src/features/tools/components/model-check/viewport.tsx")
      )
    ).toBe(false);
  });

  it("**不进工单** —— 不碰报价 / 工单 / R2 上传那条链路", () => {
    const src = read(TOOL);
    // 不调打印工单接口
    expect(src).not.toMatch(/api\/print-orders|api\/print-quote/);
    // 不引报价 / 工单那套模块
    expect(src).not.toMatch(/@\/features\/print-quote/);
    // 不引 DB
    expect(src).not.toMatch(/@\/db/);
    // 切完是**本地下载**(OBJ / ZIP blob),不上传
    expect(src).toContain("writeObjFromSoup");
    expect(src).toContain("downloadModelZip");
    expect(src).toContain("URL.createObjectURL");
  });

  it("拖放用仓库那个 hook,遮罩带 pointer-events-none", () => {
    const src = read(TOOL);
    expect(src).toContain('from "@/features/shared/hooks/use-drop-zone"');
    expect(src).toContain("useDropZone");
    // 遮罩必须不吃事件 —— 不然浏览器把它算成一次新的进入 / 离开,深度被算乱
    expect(src).toContain("pointer-events-none");
  });

  it("焊接走仓库唯一公开入口(weldVertices 是模块私有的)", () => {
    const src = read(HANDLER);
    expect(src).toContain("weldAndAnalyzeTopology");
    expect(src).not.toMatch(/weldVertices/);
  });

  it("**先焊接、再修复** —— 「同一个点」先认出来(工作室 2026-11-11)", () => {
    // 磁吸孔自己那一份焊接(容差阶梯)在
    expect(existsSync(join(ROOT, WELD))).toBe(true);
    const weld = read(WELD);
    expect(weld).toContain("magnetWeldLadder");
    expect(weld).toContain("weldMagnetUntilClosed");
    // 阶梯的最松一档 = Blender `remove_doubles` 的 0.1mm
    expect(weld).toContain("[0.001, 0.01, 0.05, 0.1]");
    // 「近似重复」是那个**有信息量**的计数(三角汤天生的重复没有)
    expect(weld).toContain("mergedApprox");

    // handler 接上了
    const handler = read(HANDLER);
    expect(handler).toMatch(/from "\.\/magnet-weld"/);
    expect(handler).toContain("weldMagnetUntilClosed");

    // **焊接在修复之前** —— 先把同一个点认出来,再谈补洞
    const weldAt = handler.indexOf("weldMagnetUntilClosed(");
    const repairAt = handler.indexOf("repairMagnetGeometry(");
    expect(weldAt).toBeGreaterThan(-1);
    expect(repairAt).toBeGreaterThan(weldAt);

    // 报告里带着焊接的三个数
    expect(handler).toContain("weldedVertices");
    expect(handler).toContain("weldedNearDuplicates");
    expect(handler).toContain("weldToleranceMm");

    // 页面把这件事告诉用户 —— 焊接**不改形状**,跟「改了模型」分开摆
    expect(read(TOOL)).toContain("repair.welded");
    const zh = flattenKeys(messages("zh").Magnet);
    const en = flattenKeys(messages("en").Magnet);
    expect(zh["repair.welded"]).toBeTruthy();
    expect(en["repair.welded"]).toBeTruthy();
  });

  it("Manifold.cylinder 是静态方法 —— 不加 new", () => {
    const src = read(HANDLER);
    expect(src).toContain("Manifold.cylinder");
    expect(src).not.toMatch(/new\s+(runtime\.)?Manifold\.cylinder/);
  });

  it("孔径是绝对毫米 —— **可调**,但默认仍是实物尺寸 Ø20.7 / 深 1.3", () => {
    const src = read(PARAMS);
    expect(src).toContain("MAGNET_HOLE_DIA_MM = 20.7");
    expect(src).toContain("MAGNET_HOLE_DEPTH_MM = 1.3");
    // Blender 脚本里那个「孔径跟着模型最大边缩放」的临时假设不许进来
    // (注释里可以**提**它 —— 那是解释为什么没搬;代码里不许有它)
    expect(stripComments(src)).not.toContain("EXPECTED_WIDTH_MM");
    // 半径是绝对值,不是「半径 × 比例」
    expect(src).toContain("MAGNET_HOLE_RADIUS_MM = MAGNET_HOLE_DIA_MM / 2");
    // 可调 ⇒ 有「归一化」这一层(收敛到合法范围)—— 不是直接拿输入值用
    expect(src).toContain("normalizeHoleParams");
  });

  it("① 孔径 / 深度在页面上可调(工作室 2026-11-11)", () => {
    const src = read(TOOL);
    // 两个输入 + 走归一化那一层
    expect(src).toContain("holeDiaText");
    expect(src).toContain("holeDepthText");
    expect(src).toContain("normalizeHoleParams");
    // 归一化函数本身要有 —— 参数收敛到合法范围(不是 NaN 直接进计算)
    const params = read(PARAMS);
    expect(params).toContain("MAGNET_HOLE_DIA_MIN_MM");
    expect(params).toContain("MAGNET_HOLE_DIA_MAX_MM");
    expect(params).toContain("MAGNET_HOLE_DEPTH_MIN_MM");
    expect(params).toContain("MAGNET_HOLE_DEPTH_MAX_MM");
    // 改孔参数要重算分析(页面上的厚度 / 净空是旧参数的话,用户照着切就切错了)
    expect(src).toMatch(
      /holeParams[\s\S]{0,400}runAnalyze|runAnalyze[\s\S]{0,400}holeParams/
    );
  });

  it("② 智能识别背面 —— 按面积找最大平面区域,跟模型朝向无关", () => {
    // 那个检测器得在
    expect(existsSync(join(ROOT, BACKFACE))).toBe(true);
    const backface = read(BACKFACE);
    expect(backface).toContain("detectFlatPatches");
    expect(backface).toContain("pickBackFace");
    // 分析链路真的接上了(不是写了个文件没人用)
    expect(read(HANDLER)).toContain("detectFlatPatches");
    // 页面默认目标 = 「智能识别」那一块
    const src = read(TOOL);
    expect(src).toContain("MAGNET_TARGET_AUTO");
    // 并且**用户能自己换**哪一块(六面里挑一个,不是只能吃自动的)
    expect(src).toContain("patchTargetId");
    expect(src).toContain("parsePatchTarget");
    expect(read(PARAMS)).toContain("patchTargetId");
  });

  it("③ 导出保留原来的材质贴图(工作室 2026-11-11)", () => {
    // 导出走 OBJ 写出器 + ZIP 打包器(带 MTL / 纹理)
    const src = read(TOOL);
    expect(src).toContain("writeObjFromSoup");
    expect(src).toContain("downloadModelZip");
    // 贴图三件套传进去了
    expect(src).toContain("uvs");
    expect(src).toContain("materialIndex");
    expect(src).toContain("materialNames");
    expect(src).toContain("mtlFileName");
    // 切的时候把原模型的贴图信息**传进布尔运算**(不然布尔出来的件没有 UV)
    expect(src).toContain("sourceTexture");
    expect(src).toMatch(/client\.cut\([\s\S]{0,200}sourceTexture/);

    // OBJ 写出器要真的写 `vt` / `usemtl` / `mtllib`
    const writer = read(WRITE_OBJ);
    expect(writer).toContain("vt ");
    expect(writer).toContain("usemtl ");
    expect(writer).toContain("mtllib ");
  });

  it("**不是封闭实体也照样切** —— 临时盖上再切(工作室 2026-11-11)", () => {
    // 网格清理的那份纯函数模块得在
    expect(existsSync(join(ROOT, REPAIR))).toBe(true);
    const repair = read(REPAIR);
    expect(repair).toContain("repairMagnetGeometry");
    expect(repair).toContain("splitMagnetVertices");

    // handler 真的接上了 —— 不是写了个文件没人用
    const handler = read(HANDLER);
    expect(handler).toContain("repairMagnetGeometry");
    expect(handler).toContain("splitMagnetVertices");
    expect(handler).toMatch(/from "\.\/magnet-repair"/);

    // **不许**因为「不是封闭实体」就提前拒收 —— 那道闸现在是
    // 「临时盖完还封不上才拒」(拒绝发生在盖面**之后**)
    const repairAt = handler.indexOf("repairMagnetGeometry(");
    const lidAt = handler.indexOf("buildTemporaryLid(");
    const rejectAt = handler.indexOf('"NOT_MANIFOLD"');
    expect(repairAt).toBeGreaterThan(-1);
    expect(lidAt).toBeGreaterThan(repairAt);
    expect(rejectAt).toBeGreaterThan(lidAt);

    // 页面上摆的那句「不用装任何东西」也得说清楚会临时封上再切
    const zh = flattenKeys(messages("zh").Magnet);
    const en = flattenKeys(messages("en").Magnet);
    expect(zh["engine.browserHint"]).toContain("临时");
    expect(en["engine.browserHint"]).toMatch(/temporar/i);
    // 旧文案那句「会切不了」不许再出现
    expect(zh["engine.browserHint"]).not.toContain("会切不了");
  });

  it("**不需要修复用户的模型** —— 盖面是临时的,切完就摘掉(工作室 2026-11-11)", () => {
    // 临时盖面那一层得在
    expect(existsSync(join(ROOT, LID))).toBe(true);
    const lid = read(LID);
    expect(lid).toContain("scanMagnetBoundary");
    expect(lid).toContain("buildMagnetLid");

    // handler 接上了
    const handler = read(HANDLER);
    expect(handler).toMatch(/from "\.\/magnet-lid"/);
    expect(handler).toContain("buildTemporaryLid");

    // **盖面从输出里摘掉** —— 这是「用户的模型一个字节都没改」的关键
    expect(handler).toContain("lidRunId");
    expect(handler).toContain("findRunTriangles");

    // 网格清理那一层**不补洞** —— 补洞是临时盖面那一层的事
    const repair = read(REPAIR);
    expect(repair).not.toContain("filledLoops");
    expect(repair).toContain("cappedLoops");

    // 报告里带着「临时盖了几处」
    expect(handler).toContain("repair.cappedLoops");
    expect(handler).toContain("repair.lidFaces");
    expect(handler).toContain("closedForBoolean");

    // 界面把这件事告诉用户(灰色那一块,跟「改了模型」的琥珀色分开)
    const tool = read(TOOL);
    expect(tool).toContain("analysis?.repair?.cappedLoops");
    expect(tool).toContain('t("repair.lidTitle")');
    expect(tool).toContain('t("repair.lidDetail"');

    // 中英文都有
    const zh = flattenKeys(messages("zh").Magnet);
    const en = flattenKeys(messages("en").Magnet);
    expect(zh["repair.lidTitle"]).toBeTruthy();
    expect(en["repair.lidTitle"]).toBeTruthy();
    expect(zh["repair.lidDetail"]).toBeTruthy();
    expect(en["repair.lidDetail"]).toBeTruthy();
  });

  it("**改了用户的模型就得告诉用户** —— 动过的部分摆在页面上", () => {
    // 分析结果里带着「动了什么」
    expect(read(HANDLER)).toMatch(/repair:\s*prepared\.topology\.repair/);
    expect(read(PROTOCOL)).toContain("repair");
    // 页面上真的渲染了那一段
    const tool = read(TOOL);
    expect(tool).toContain("analysis?.repair?.changed");
    expect(tool).toContain('t("repair.title")');
    expect(tool).toContain('t("repair.detail"');
    // 中英文都有
    const zh = flattenKeys(messages("zh").Magnet);
    const en = flattenKeys(messages("en").Magnet);
    expect(zh["repair.title"]).toBeTruthy();
    expect(en["repair.title"]).toBeTruthy();
    expect(zh["repair.detail"]).toBeTruthy();
    expect(en["repair.detail"]).toBeTruthy();
  });

  it("**XYZ 分别调尺寸** —— 像打印工作台那样(工作室 2026-11-11)", () => {
    const tool = read(TOOL);

    // 两种模式:统一缩放 / X·Y·Z 分别
    expect(tool).toContain('"uniform"');
    expect(tool).toContain('"perAxis"');
    expect(tool).toContain("axisMode");

    // 分别模式的三个输入
    expect(tool).toContain("targetSizeMm");
    expect(tool).toContain("targetSizeText");

    // 走仓库那个**逐轴**缩放(打印工作台同一个函数)
    expect(tool).toMatch(/from "@\/features\/pricing\/lib\/model-units"/);
    expect(tool).toContain("scalePositionsXYZ");
    expect(read(MODEL_UNITS)).toContain("scalePositionsXYZ");

    // 打印工作台的尺寸编辑器还在(磁吸孔是**照着它**做的,不是另发明一套)
    expect(existsSync(join(ROOT, BENCH_SHARED))).toBe(true);
    expect(read(BENCH_SHARED)).toContain("DimEditor");

    // **孔径仍然是绝对毫米** —— 逐轴缩放不许把孔一起缩放
    expect(tool).toContain("normalizeHoleParams");
    expect(tool).not.toMatch(/targetSizeMm[^)]*hole/);

    // 中英文 key 都有
    const zh = flattenKeys(messages("zh").Magnet);
    const en = flattenKeys(messages("en").Magnet);
    for (const key of [
      "size.modeUniform",
      "size.modePerAxis",
      "size.hintPerAxis",
      "size.reset",
    ]) {
      expect(zh[key], `zh 缺 ${key}`).toBeTruthy();
      expect(en[key], `en 缺 ${key}`).toBeTruthy();
    }
  });

  it("预料之外的错单独一个码 —— 不再一律报成 BOOLEAN_FAILED", () => {
    expect(read(PROTOCOL)).toContain("UNEXPECTED");
    expect(read(ERROR_MAP)).toContain("UNEXPECTED");
    expect(read(HANDLER)).toContain("UNEXPECTED");
  });

  it("wasm 提交进仓库(新克隆的机器不用先跑脚本)", () => {
    const wasm = join(ROOT, "public/manifold.wasm");
    expect(existsSync(wasm)).toBe(true);
    // 541KB 左右 —— 少了说明拷错了文件
    expect(statSync(wasm).size).toBeGreaterThan(400_000);
  });

  it("中英文 key 一致(Magnet 命名空间 + 工具中心那一条)", () => {
    const zh = messages("zh");
    const en = messages("en");

    // **递归比** —— 只比第一层的话,`hole.diaLabel` 少写一个上层看不出来
    const zhMagnet = flattenKeys(zh.Magnet);
    const enMagnet = flattenKeys(en.Magnet);
    expect(Object.keys(enMagnet).sort()).toEqual(Object.keys(zhMagnet).sort());

    const zhTool = (zh.ToolsCenter as Record<string, unknown>).tools as Record<
      string,
      unknown
    >;
    const enTool = (en.ToolsCenter as Record<string, unknown>).tools as Record<
      string,
      unknown
    >;
    expect(Object.keys(flattenKeys(zhTool.magnet)).sort()).toEqual(
      Object.keys(flattenKeys(enTool.magnet)).sort()
    );
  });

  it("2026-11-11 那三条要用到的文案,两种语言都有", () => {
    const zh = flattenKeys(messages("zh").Magnet);
    const en = flattenKeys(messages("en").Magnet);

    // ① 孔参数可调
    for (const key of ["hole.diaLabel", "hole.depthLabel", "hole.reset"]) {
      expect(zh[key], `zh 缺 ${key}`).toBeTruthy();
      expect(en[key], `en 缺 ${key}`).toBeTruthy();
    }
    // ② 智能识别背面
    for (const key of ["back.title", "back.auto", "back.none"]) {
      expect(zh[key], `zh 缺 ${key}`).toBeTruthy();
      expect(en[key], `en 缺 ${key}`).toBeTruthy();
    }
    // ③ 导出保留材质贴图
    for (const key of ["download.withTexture", "download.solidColor"]) {
      expect(zh[key], `zh 缺 ${key}`).toBeTruthy();
      expect(en[key], `en 缺 ${key}`).toBeTruthy();
    }
    // 预料之外的错
    expect(zh["errors.codes.unexpected"]).toBeTruthy();
    expect(en["errors.codes.unexpected"]).toBeTruthy();
  });

  it("文案里没有 markdown 粗体(仓库的消息文件不用 **)", () => {
    const raw = read("messages/zh.json");
    const magnetBlock = raw.slice(raw.indexOf('"Magnet": {'));
    expect(magnetBlock).not.toContain("**");
  });
});
