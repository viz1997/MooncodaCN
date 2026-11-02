import { describe, expect, it } from "vitest";
import { analyzeNewMesh } from "@/features/tools/lib/mesh/analyze";
import {
  DEMO_MODELS,
  demoBroken,
  demoInverted,
  demoLocalFlip,
  demoPerfect,
  demoShells,
  demoThinWall,
} from "@/features/tools/lib/mesh/demo";
import type { AnalysisResult, RawMesh } from "@/features/tools/lib/mesh/types";
import { evaluateWjp } from "@/features/tools/lib/mesh/wjp";

/**
 * WJP 模型检查的算法测试。
 *
 * 全部是**纯计算**:不需要 DB、不需要网络、不需要浏览器。跑在 unit project 里
 * (`pnpm test:run --project=unit`)。
 *
 * 夹具用移植过来的 6 个内置演示模型 —— 几何是确定性的,免去造模型的功夫;
 * 每个模型对应一类典型缺陷,断言写死期望检出项。
 */

function analyze(mesh: RawMesh): {
  result: AnalysisResult;
  stages: string[];
} {
  const stages: string[] = [];
  const { result } = analyzeNewMesh(mesh.positions, mesh.name, (stage) => {
    stages.push(stage);
  });
  return { result, stages };
}

describe("analyzeNewMesh —— 演示模型", () => {
  it("完整立方体:水密、无坏面、无问题", () => {
    const { result, stages } = analyze(demoPerfect());
    const s = result.stats;

    expect(stages).toEqual(["weld", "shells", "cluster", "support", "done"]);
    expect(s.openEdgeCount).toBe(0);
    expect(s.nonManifoldEdgeCount).toBe(0);
    expect(s.degenerateCount).toBe(0);
    expect(s.duplicatePairCount).toBe(0);
    expect(s.flippedFaceCount).toBe(0);
    expect(s.globalInvertedShellCount).toBe(0);
    expect(s.componentCount).toBe(1);
    expect(s.watertight).toBe(true);
    expect(s.volumeMm3).toBeGreaterThan(0);
    // 20mm 立方体 = 8000 mm³
    expect(s.volumeMm3).toBeCloseTo(8000, 0);
    expect(result.warnings).toEqual([]);
  });

  it("破损模型:平面孔洞 + 裂缝 + 退化面 + 重复面 + 非流形边", () => {
    const { result } = analyze(demoBroken());
    const s = result.stats;

    expect(s.planarHoleCount).toBeGreaterThan(0);
    expect(s.crackChainCount).toBeGreaterThan(0);
    expect(s.degenerateCount).toBeGreaterThan(0);
    expect(s.duplicatePairCount).toBeGreaterThan(0);
    expect(s.nonManifoldEdgeCount).toBeGreaterThan(0);
    expect(s.openEdgeCount).toBeGreaterThan(0);
    expect(s.watertight).toBe(false);
  });

  it("薄壁空心:检出密封内腔", () => {
    const { result } = analyze(demoThinWall());
    const s = result.stats;

    expect(s.sealedHollow).toBe(true);
    expect(s.cavityShellCount).toBeGreaterThanOrEqual(1);
    expect(s.componentCount).toBe(2);
  });

  it("整体反转:法线朝内,体积为负", () => {
    const { result } = analyze(demoInverted());
    const s = result.stats;

    expect(s.globalInvertedShellCount).toBeGreaterThanOrEqual(1);
    expect(s.volumeMm3).toBeLessThan(0);
  });

  it("局部翻转:只有局部翻转面,没有整体朝内的壳", () => {
    const { result } = analyze(demoLocalFlip());
    const s = result.stats;

    expect(s.flippedFaceCount).toBeGreaterThanOrEqual(1);
    expect(s.globalInvertedShellCount).toBe(0);
  });

  it("多壳体:独立部件 + 噪声碎片", () => {
    const { result } = analyze(demoShells());
    const s = result.stats;

    expect(s.componentCount).toBeGreaterThanOrEqual(3);
    expect(s.noiseShellCount).toBeGreaterThanOrEqual(1);
    expect(s.extraShellCount).toBeGreaterThanOrEqual(1);
  });

  it("演示模型清单:6 个,key 唯一", () => {
    const keys = DEMO_MODELS.map((d) => d.key);
    expect(keys).toEqual([
      "perfect",
      "broken",
      "thin",
      "inverted",
      "local-flip",
      "shells",
    ]);
    expect(new Set(keys).size).toBe(keys.length);
    for (const demo of DEMO_MODELS) {
      expect(demo.build().positions.length % 9).toBe(0);
    }
  });
});

describe("evaluateWjp —— 工艺评估", () => {
  it("完整立方体:pass", () => {
    const { result } = analyze(demoPerfect());
    const report = evaluateWjp(result);

    expect(report.tone).toBe("pass");
    expect(report.criticalCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.verdictKey).toBe("wjp.tone.pass.verdict");
    expect(report.summaryKey).toBe("wjp.tone.pass.summary");
    expect(report.findings.map((f) => f.key)).toContain("normals.pass.ok");
    expect(report.findings.map((f) => f.key)).toContain("gaps.pass.ok");
    expect(report.findings.map((f) => f.key)).toContain("badfaces.pass.ok");
    expect(report.findings.map((f) => f.key)).toContain("shells.pass.ok");
  });

  it("破损模型:fail,坏边与破面各报一条", () => {
    const { result } = analyze(demoBroken());
    const report = evaluateWjp(result);

    expect(report.tone).toBe("fail");
    expect(report.criticalCount).toBeGreaterThanOrEqual(1);
    expect(report.verdictKey).toBe("wjp.tone.fail.verdict");

    const gaps = report.findings.find(
      (f) => f.key === "gaps.critical.notClosed"
    );
    expect(gaps).toBeDefined();
    expect(gaps?.severity).toBe("critical");
    expect(gaps?.params).toMatchObject({
      openEdges: expect.any(Number),
      planarHoles: expect.any(Number),
      cracks: expect.any(Number),
    });

    const bad = report.findings.find(
      (f) => f.key === "badfaces.warning.issues"
    );
    expect(bad).toBeDefined();
    expect(bad?.severity).toBe("warning");
  });

  it("密封内腔:critical", () => {
    const { result } = analyze(demoThinWall());
    const report = evaluateWjp(result);

    expect(report.tone).toBe("fail");
    const cavity = report.findings.find(
      (f) => f.key === "shells.critical.sealedHollow"
    );
    expect(cavity?.severity).toBe("critical");
    expect(cavity?.params?.count).toBeGreaterThanOrEqual(1);
  });

  it("整体反转:法向结论为 critical", () => {
    const { result } = analyze(demoInverted());
    const report = evaluateWjp(result);

    expect(report.tone).toBe("fail");
    const inverted = report.findings.find(
      (f) => f.key === "normals.critical.globalInverted"
    );
    expect(inverted?.severity).toBe("critical");
  });

  it("局部翻转:法向结论为 critical", () => {
    const { result } = analyze(demoLocalFlip());
    const report = evaluateWjp(result);

    const flipped = report.findings.find(
      (f) => f.key === "normals.critical.localFlipped"
    );
    expect(flipped?.severity).toBe("critical");
    expect(flipped?.params?.count).toBeGreaterThanOrEqual(1);
  });

  it("多壳体:给出装配间隙提示", () => {
    const { result } = analyze(demoShells());
    const report = evaluateWjp(result);

    const assembly = report.findings.find(
      (f) => f.key === "assembly.info.multiple"
    );
    expect(assembly?.severity).toBe("info");
    expect(assembly?.params).toMatchObject({
      count: expect.any(Number),
      assemblyGap: 0.2,
      movingGap: 1.5,
    });

    // 尺寸精度永远给一条 info
    const precision = report.findings.find(
      (f) => f.key === "precision.info.size"
    );
    expect(precision?.severity).toBe("info");
    expect(precision?.params).toMatchObject({
      dx: expect.any(Number),
      dy: expect.any(Number),
      dz: expect.any(Number),
      tol: expect.any(Number),
      heatMin: 50,
      heatMax: 55,
    });
  });
});
