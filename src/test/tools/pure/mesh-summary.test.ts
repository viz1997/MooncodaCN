import { describe, expect, it } from "vitest";
import { analyzeNewMesh } from "@/features/tools/lib/mesh/analyze";
import { summarizeTopology } from "@/features/tools/lib/mesh/summary";
import type { RawMesh } from "@/features/tools/lib/mesh/types";
import { weldAndAnalyzeTopology } from "@/features/tools/lib/mesh/weld";
import { evaluateWjp } from "@/features/tools/lib/mesh/wjp";
import {
  brokenMesh,
  hollowShell,
  invertedNormals,
  localFlip,
  multiShell,
  perfectCube,
} from "@/test/tools/fixtures/mesh-fixtures";

/**
 * 网格自检摘要 —— **两个视角的结论必须一致**
 *
 * 打印前工作台(`/tools/weight`)头部那枚「打印前检查」徽标吃的是
 * `summarizeTopology()`;「检查」视角吃的是
 * `analyzeNewMesh()`。两边对**同一个模型**给出的结论必须逐字相同 ——
 * 否则用户会看到「检查视角说没问题、头部徽标说有 3 处破面」,那是
 * 工具自己的 bug,不是模型的问题。
 *
 * 这份一致性是**结构性**的(两边调的是同一个函数),这个测试守住的是
 * 「以后有人改了一边忘了改另一边」这种事。
 *
 * 全部纯计算:不需要 DB、不需要网络、不需要浏览器。
 */

const ALL_MESHES: { name: string; make: () => RawMesh }[] = [
  { name: "完整立方体", make: perfectCube },
  { name: "破损模型", make: brokenMesh },
  { name: "薄壁空心", make: hollowShell },
  { name: "整体反转", make: invertedNormals },
  { name: "局部翻转", make: localFlip },
  { name: "多壳体", make: multiShell },
];

describe("自检摘要 —— 与检查工具的结论一致", () => {
  for (const { name, make } of ALL_MESHES) {
    it(`${name}:统计、提示、WJP 报告逐字相同`, () => {
      const mesh = make();

      // 检查工具那条路
      const { result } = analyzeNewMesh(mesh.positions, mesh.name, () => {});

      // 克重工具那条路(摆盘 Worker 焊接之后算摘要)
      const topo = weldAndAnalyzeTopology(mesh.positions);
      const summary = summarizeTopology(topo, { fileName: mesh.name });

      // ---- 统计:逐个字段比 ----
      // analysisMs 是耗时,两次跑的数不一样 —— 排除掉再比
      expect({ ...summary.stats, analysisMs: 0 }).toEqual({
        ...result.stats,
        analysisMs: 0,
      });

      // ---- 提示清单:key 和参数都要一样 ----
      expect(summary.warnings).toEqual(result.warnings);

      // ---- WJP 评估:结论和条目都要一样 ----
      // 检查工具侧栏那张卡读的是 `evaluateWjp(result.stats)`
      expect(summary.wjp).toEqual(evaluateWjp(result.stats));
    });
  }
});

describe("自检摘要 —— 结论映射", () => {
  it("完整立方体:通过,没有一条提示", () => {
    const topo = weldAndAnalyzeTopology(perfectCube().positions);
    const summary = summarizeTopology(topo);

    expect(summary.status).toBe("pass");
    expect(summary.warnings).toEqual([]);
    expect(summary.stats.watertight).toBe(true);
    expect(summary.wjp.tone).toBe("pass");
  });

  it("破损模型:发现问题,提示里点名开放边", () => {
    const topo = weldAndAnalyzeTopology(brokenMesh().positions);
    const summary = summarizeTopology(topo);

    expect(summary.status).toBe("fail");
    expect(summary.stats.openEdgeCount).toBeGreaterThan(0);
    expect(summary.warnings.map((w) => w.key)).toContain("warnings.openEdges");
  });

  it("密封内腔:单独点名(工作室要单独看到这一条)", () => {
    const topo = weldAndAnalyzeTopology(hollowShell().positions);
    const summary = summarizeTopology(topo);

    expect(summary.status).toBe("fail");
    expect(summary.warnings.map((w) => w.key)).toContain(
      "warnings.sealedHollow"
    );
  });

  it("整体法线朝内:单独点名", () => {
    const topo = weldAndAnalyzeTopology(invertedNormals().positions);
    const summary = summarizeTopology(topo);

    expect(summary.status).toBe("fail");
    expect(summary.warnings.map((w) => w.key)).toContain(
      "warnings.globalInverted"
    );
  });

  it("多个独立壳体:单独点名", () => {
    const topo = weldAndAnalyzeTopology(multiShell().positions);
    const summary = summarizeTopology(topo);

    expect(summary.warnings.map((w) => w.key)).toContain(
      "warnings.multipleShells"
    );
  });
});
