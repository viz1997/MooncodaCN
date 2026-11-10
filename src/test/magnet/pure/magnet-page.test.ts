import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `/tools/magnet` 页面这一层的守卫(2026-11-10)
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
 * 7. **孔径是绝对毫米** —— Blender 脚本里那个「孔径跟着模型最大边缩放」的
 *    临时假设**不许**被搬进来
 * 8. **wasm 提交进仓库** —— 新克隆的机器不用先跑脚本
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

const ROUTE = "src/app/[locale]/(marketing-atelier)/tools/magnet/page.tsx";
const TOOL = "src/features/magnet/components/magnet-cutter-tool.tsx";
const HANDLER = "src/features/magnet/lib/magnet-cutter-handler.ts";
const PARAMS = "src/features/magnet/lib/magnet-params.ts";
const HUB = "src/features/tools/components/tools-hub.tsx";

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
    // 切完是**本地下载**(OBJ blob),不上传
    expect(src).toContain("objBlobFromSoup");
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

  it("Manifold.cylinder 是静态方法 —— 不加 new", () => {
    const src = read(HANDLER);
    expect(src).toContain("Manifold.cylinder");
    expect(src).not.toMatch(/new\s+(runtime\.)?Manifold\.cylinder/);
  });

  it("孔径是绝对毫米 —— 固定 Ø20.7mm / 深 1.3mm", () => {
    const src = read(PARAMS);
    expect(src).toContain("MAGNET_HOLE_DIA_MM = 20.7");
    expect(src).toContain("MAGNET_HOLE_DEPTH_MM = 1.3");
    // Blender 脚本里那个「孔径跟着模型最大边缩放」的临时假设不许进来
    // (注释里可以**提**它 —— 那是解释为什么没搬;代码里不许有它)
    expect(stripComments(src)).not.toContain("EXPECTED_WIDTH_MM");
    // 半径是绝对值,不是「半径 × 比例」
    expect(src).toContain("MAGNET_HOLE_RADIUS_MM = MAGNET_HOLE_DIA_MM / 2");
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

    const zhMagnet = zh.Magnet as Record<string, unknown>;
    const enMagnet = en.Magnet as Record<string, unknown>;
    expect(Object.keys(enMagnet).sort()).toEqual(Object.keys(zhMagnet).sort());

    const zhTool = (zh.ToolsCenter as Record<string, unknown>).tools as Record<
      string,
      unknown
    >;
    const enTool = (en.ToolsCenter as Record<string, unknown>).tools as Record<
      string,
      unknown
    >;
    expect(Object.keys(zhTool.magnet as object).sort()).toEqual(
      Object.keys(enTool.magnet as object).sort()
    );
  });

  it("文案里没有 markdown 粗体(仓库的消息文件不用 **)", () => {
    const raw = read("messages/zh.json");
    const magnetBlock = raw.slice(raw.indexOf('"Magnet": {'));
    expect(magnetBlock).not.toContain("**");
  });
});
