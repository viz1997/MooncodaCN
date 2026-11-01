import { describe, expect, it } from "vitest";

import { inspectMesh } from "@/features/tools/lib/inspect";
import { parseObjText } from "@/features/tools/lib/mesh-parse";
import { classifyThickness } from "@/features/tools/lib/wall-thickness";

/**
 * 模型检查工具的算法测试。
 *
 * 全部是**纯计算**:不需要 DB、不需要网络、不需要浏览器。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * 造的几何体都是能手算的立方体 / 板子 —— 断言写死期望值(体积 = 边长³、
 * 壁厚 = 板厚),算法一旦改坏就会当场露馅。
 */

/** 8 顶点立方体,边长 size,面朝外一致绕序 */
function cubeObj(size = 10, withTop = true): string {
  const v = [
    [0, 0, 0],
    [size, 0, 0],
    [size, size, 0],
    [0, size, 0],
    [0, 0, size],
    [size, 0, size],
    [size, size, size],
    [0, size, size],
  ];
  const quads: number[][] = [
    [1, 4, 3, 2], // 底 z=0 —— 绕序反着,法线朝外
    [5, 6, 7, 8], // 顶 z=size
    [1, 2, 6, 5], // 前 y=0
    [2, 3, 7, 6], // 右 x=size
    [3, 4, 8, 7], // 后 y=size
    [1, 5, 8, 4], // 左 x=0
  ];
  const faces = withTop ? quads : quads.filter((_, i) => i !== 1);
  const lines = v.map((p) => `v ${p[0]} ${p[1]} ${p[2]}`);
  for (const f of faces) lines.push(`f ${f.join(" ")}`);
  return lines.join("\n");
}

/** 平板:40×40×thick,封闭 */
function slabObj(thick: number): string {
  const w = 40;
  const v = [
    [0, 0, 0],
    [w, 0, 0],
    [w, w, 0],
    [0, w, 0],
    [0, 0, thick],
    [w, 0, thick],
    [w, w, thick],
    [0, w, thick],
  ];
  const quads: number[][] = [
    [1, 4, 3, 2],
    [5, 6, 7, 8],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 4, 8, 7],
    [1, 5, 8, 4],
  ];
  const lines = v.map((p) => `v ${p[0]} ${p[1]} ${p[2]}`);
  for (const f of quads) lines.push(`f ${f.join(" ")}`);
  return lines.join("\n");
}

/** 绕序乱的立方体 —— 用来验证「法线翻面」能被抓出来 */
function flippedCubeObj(size = 10): string {
  return cubeObj(size).replace("f 1 4 3 2", "f 1 2 3 4");
}

const inspect = (objText: string) =>
  inspectMesh(parseObjText(objText)!, {
    samples: 300,
    yieldToUI: async () => {},
  });

describe("parseObjText", () => {
  it("解析顶点 / 面,并算出包围盒", () => {
    const mesh = parseObjText(cubeObj(10));
    expect(mesh).not.toBeNull();
    expect(mesh!.vertexCount).toBe(8);
    expect(mesh!.triangleCount).toBe(12);
    expect(mesh!.size.map((n) => Number(n.toFixed(3)))).toEqual([10, 10, 10]);
  });

  it("负数索引按 OBJ 约定相对当前顶点数解析", () => {
    // 4 个顶点,面里用 -1 / -3 指回第 4 / 第 2 个顶点
    const mesh = parseObjText(
      ["v 0 0 0", "v 1 0 0", "v 1 1 0", "v 0 1 0", "f -4 -3 -2 -1"].join("\n")
    );
    expect(mesh).not.toBeNull();
    expect(mesh!.triangleCount).toBe(2);
    expect(mesh!.vertexCount).toBe(4);
  });

  it("没有面时返回 null", () => {
    expect(parseObjText("v 0 0 0\nv 1 0 0\nv 0 1 0")).toBeNull();
  });
});

describe("拓扑检查", () => {
  it("封闭的立方体:无开放边 / 非流形边,体积 = 边长³", async () => {
    const report = await inspect(cubeObj(10));
    expect(report.topology.watertight).toBe(true);
    expect(report.topology.openEdgeCount).toBe(0);
    expect(report.topology.nonManifoldEdgeCount).toBe(0);
    expect(report.topology.degenerateCount).toBe(0);
    expect(report.topology.duplicateFaceCount).toBe(0);
    expect(report.topology.signedVolumeMM3).toBeCloseTo(1000, 0);
    expect(report.verdict).toBe("ok");
  });

  it("缺一个面:报出 4 条开放边,且判定不封闭", async () => {
    const report = await inspect(cubeObj(10, false));
    expect(report.topology.watertight).toBe(false);
    expect(report.topology.openEdgeCount).toBe(4);
    expect(report.verdict).toBe("error");
    expect(report.issues.some((i) => i.id === "openEdge")).toBe(true);
  });

  it("绕序反了的立方体:报出法线翻面", async () => {
    const report = await inspect(flippedCubeObj(10));
    expect(report.topology.flippedEdgeCount).toBeGreaterThan(0);
    expect(report.issues.some((i) => i.id === "flippedNormal")).toBe(true);
  });

  it("退化面(三个点共线)被抓出来", async () => {
    const obj = ["v 0 0 0", "v 1 0 0", "v 2 0 0", "v 0 1 0", "f 1 2 3"].join(
      "\n"
    );
    const report = await inspect(obj);
    expect(report.topology.degenerateCount).toBe(1);
    expect(report.issues.some((i) => i.id === "degenerate")).toBe(true);
  });

  it("重复面被抓出来", async () => {
    const obj = ["v 0 0 0", "v 1 0 0", "v 0 1 0", "f 1 2 3", "f 1 2 3"].join(
      "\n"
    );
    const report = await inspect(obj);
    expect(report.topology.duplicateFaceCount).toBe(1);
  });
});

describe("壁厚测量", () => {
  it("立方体的壁厚 = 边长", async () => {
    const report = await inspect(cubeObj(10));
    expect(report.thickness).not.toBeNull();
    expect(report.thickness!.minThicknessMM).toBeCloseTo(10, 0);
    expect(report.thickness!.medianThicknessMM).toBeCloseTo(10, 0);
  });

  it("薄板测出来的壁厚 = 板厚", async () => {
    const report = await inspect(slabObj(0.8));
    expect(report.thickness).not.toBeNull();
    expect(report.thickness!.minThicknessMM).toBeCloseTo(0.8, 1);
  });

  it("按阈值分类:厚板不判过薄,薄板整片判过薄", async () => {
    const thick = await inspect(cubeObj(10));
    const thickClass = classifyThickness(thick.thickness!, 2);
    expect(thickClass.thinTriangles).toHaveLength(0);

    const thin = await inspect(slabObj(0.8));
    const thinClass = classifyThickness(thin.thickness!, 1.2);
    expect(thinClass.thinTriangles.length).toBeGreaterThan(0);
    expect(thinClass.thinAreaRatio).toBeGreaterThan(0.9);
  });

  it("改阈值只重新分类,不重新打射线(样本数不变)", async () => {
    const report = await inspect(slabObj(0.8));
    const before = report.thickness!.samples.length;
    classifyThickness(report.thickness!, 0.4);
    expect(report.thickness!.samples.length).toBe(before);
  });
});

describe("悬空分析", () => {
  it("立方体底面朝下,悬空面积不为 0", async () => {
    const report = await inspect(cubeObj(10));
    expect(report.overhang.areaRatio).toBeGreaterThan(0);
    expect(report.overhang.supportAngleDeg).toBe(45);
  });
});
