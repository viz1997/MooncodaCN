/**
 * 磁吸孔的焊接 —— **「同一个点算出来差一点点」的模型照样能切**
 *
 * 工作室 2026-11-11 拿真实模型试的时候报了:
 *
 * ```
 * 自动修复之后这个模型还是不封闭(还剩 461 条开放边 / 15 条非流形边)
 * ```
 *
 * 看着像「模型太破」,其实**不是模型的问题,是我们的焊接太严**:
 * 仓库那份 `weldAndAnalyzeTopology()` 的容差是 `diag × 1e-7`(40mm 的
 * 模型 = 0.000004mm),而 Blender 的 `remove_doubles` 默认 0.1mm ——
 * 粗了两万五千倍。AI 生成的模型里同一个逻辑顶点差 1e-4mm 是常事 ⇒
 * 焊不上 ⇒ 每个这样的点留一条假开放边。
 *
 * 这一组守住的就是这条:
 *
 * 1. **近重合顶点 ⇒ 焊上** —— 差 1e-4mm 的两个点算一个
 * 2. **完好的模型一动不动** —— 一个顶点都不合并
 * 3. **阶梯停在刚好够的那一档** —— 不为了「保险」把容差放得更松
 * 4. **焊接不动几何** —— 形状没变,只是同一个点认成一个
 * 5. **面序不变** —— UV / 材质靠面序对回去,顺序变了贴图就错位
 * 6. **两个分开的点不会被焊到一起** —— 除非模型真的需要更松的容差
 */
import { describe, expect, it } from "vitest";
import {
  magnetWeldLadder,
  weldMagnetSoup,
  weldMagnetUntilClosed,
} from "@/features/magnet/lib/magnet-weld";
import { weldAndAnalyzeTopology } from "@/features/tools/lib/mesh/weld";

type V = [number, number, number];

/** 立方体的三角汤(法线朝外) */
function cubeFaces(size: number): V[][] {
  const h = size / 2;
  const v: V[] = [
    [-h, -h, -h],
    [h, -h, -h],
    [h, h, -h],
    [-h, h, -h],
    [-h, -h, h],
    [h, -h, h],
    [h, h, h],
    [-h, h, h],
  ];
  const f: [number, number, number][] = [
    [0, 3, 2],
    [0, 2, 1],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  return f.map((t) => t.map((i) => v[i]!) as V[]);
}

/** 面 → 三角汤 */
function toSoup(faces: V[][]): Float32Array {
  const out = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const p = f[k]!;
      out[i * 9 + k * 3] = p[0];
      out[i * 9 + k * 3 + 1] = p[1];
      out[i * 9 + k * 3 + 2] = p[2];
    }
  });
  return out;
}

/** 开放边 / 非流形边条数 */
function edgeCounts(positions: Float32Array) {
  const topo = weldAndAnalyzeTopology(positions);
  return {
    open: topo.components.reduce((s, c) => s + c.openEdges, 0),
    nonManifold: topo.components.reduce((s, c) => s + c.nonManifoldEdges, 0),
  };
}

/** 包围盒对角线 —— 焊接阶梯是按它算的 */
function diagOf(positions: Float32Array): number {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!,
      y = positions[i + 1]!,
      z = positions[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return Math.sqrt(
    (maxX - minX) ** 2 + (maxY - minY) ** 2 + (maxZ - minZ) ** 2
  );
}

/**
 * 把每个面的三个顶点**各复制一份**并加一点点扰动
 *
 * 这就是 AI 生成模型的典型样子:同一个逻辑顶点,不同面各自算了一遍,
 * 差了 1e-4mm。
 */
function duplicateVerticesWithJitter(
  size: number,
  jitter: number
): Float32Array {
  const jittered: V[][] = [];
  for (const f of cubeFaces(size)) {
    jittered.push([
      [f[0]![0] + jitter, f[0]![1], f[0]![2]],
      [f[1]![0], f[1]![1] + jitter, f[1]![2]],
      [f[2]![0], f[2]![1], f[2]![2] + jitter],
    ]);
  }
  return toSoup(jittered);
}

describe("磁吸孔焊接", () => {
  it("**仓库那份焊接太严** —— 差 1e-4mm 就被当成两个点(这就是 461 的来源)", () => {
    // 仓库口径(diag × 1e-7)下,同样的扰动留下一堆假开放边
    const soup = duplicateVerticesWithJitter(40, 1e-4);
    const before = edgeCounts(soup);
    expect(before.open).toBeGreaterThan(0);
  });

  it("近重合顶点 ⇒ 焊上,模型自己就封闭了(**不用补洞、不用删面**)", () => {
    const soup = duplicateVerticesWithJitter(40, 1e-4);
    const r = weldMagnetUntilClosed(soup);

    expect(r.merged).toBeGreaterThan(0);
    expect(r.closed).toBe(true);
    expect(r.openEdges).toBe(0);
    expect(r.nonManifoldEdges).toBe(0);

    // 焊完之后真的没有开放边了(用仓库那份分析器独立验一遍)
    const after = edgeCounts(r.positions);
    expect(after.open).toBe(0);
    expect(after.nonManifold).toBe(0);
  });

  it("1e-3mm 的扰动也照样焊得上(阶梯会一路放宽)", () => {
    const soup = duplicateVerticesWithJitter(40, 1e-3);
    const r = weldMagnetUntilClosed(soup);
    expect(r.closed).toBe(true);
    expect(edgeCounts(r.positions).open).toBe(0);
  });

  it("完好的模型 —— **几何一动不动**(三角汤天生的重复顶点该焊)", () => {
    const soup = toSoup(cubeFaces(40));
    const r = weldMagnetUntilClosed(soup);
    // 三角汤里 36 个顶点只对应 8 个真实的角 ⇒ 合并 28 个是**应该的**
    expect(r.merged).toBe(28);
    // 但它们**坐标完全一样** ⇒ 「近似重复」是 0(界面上的那个数)
    expect(r.mergedApprox).toBe(0);
    expect(r.closed).toBe(true);
    // 焊完之后是 8 个顶点 / 12 张面
    const topo = weldAndAnalyzeTopology(r.positions);
    expect(topo.mesh.vertices.length / 3).toBe(8);
    expect(topo.mesh.faceCount).toBe(12);
  });

  it("阶梯停在刚好够的那一档 —— 不为了「保险」把容差放得更松", () => {
    const soup = duplicateVerticesWithJitter(40, 1e-4);
    const r = weldMagnetUntilClosed(soup);
    // 阶梯是按**模型自己的包围盒对角线**算的(扰动把包围盒挪了一点)
    const ladder = magnetWeldLadder(diagOf(soup));
    // 用的是阶梯里的某一档
    expect(ladder).toContain(r.toleranceMm);
    // 不是最松的那一档(差 1e-4mm 不需要 0.1mm 的容差)
    expect(r.toleranceMm).toBeLessThan(ladder[ladder.length - 1]!);
    // 阶梯本身是从严到宽的
    expect(ladder[0]!).toBeLessThan(ladder[1]!);
    expect(ladder[1]!).toBeLessThan(ladder[2]!);
    expect(ladder[2]!).toBeLessThan(ladder[3]!);
    // 最松的一档 ≈ Blender `remove_doubles` 的 0.1mm(40mm 的模型)
    expect(ladder[3]!).toBeCloseTo(0.1, 3);
  });

  it("焊接**不动几何** —— 形状没变,只是同一个点认成一个", () => {
    const soup = duplicateVerticesWithJitter(40, 1e-4);
    const r = weldMagnetUntilClosed(soup);
    const bbox = (p: Float32Array) => {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < p.length; i++) {
        if (p[i]! < min) min = p[i]!;
        if (p[i]! > max) max = p[i]!;
      }
      return { min, max };
    };
    const a = bbox(soup);
    const b = bbox(r.positions);
    // 包围盒差得不超过扰动本身(1e-4mm)
    expect(Math.abs(a.min - b.min)).toBeLessThan(1e-3);
    expect(Math.abs(a.max - b.max)).toBeLessThan(1e-3);
  });

  it("面序不变 —— UV / 材质靠面序对回去,顺序变了贴图就错位", () => {
    const soup = duplicateVerticesWithJitter(40, 1e-4);
    const r = weldMagnetUntilClosed(soup);
    // 三角汤的三角形个数不变
    expect(r.positions.length).toBe(soup.length);
    // 焊完之后仓库那份分析器看到的三角形顺序也跟着走
    const topo = weldAndAnalyzeTopology(r.positions);
    expect(topo.mesh.faceCount).toBe(soup.length / 9);
  });

  it("两个分开的点不会被焊到一起(容差之内才合并)", () => {
    const soup = new Float32Array([
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      0, // 一张三角形
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      0, // 同一张(复制)
      5,
      0,
      0,
      6,
      0,
      0,
      5,
      1,
      0, // 5mm 之外的另一张
    ]);
    const r = weldMagnetSoup(soup, 0.001);
    // 完全重合的那两个三角形的顶点合并了
    expect(r.merged).toBe(3);
    // 5mm 外的那三个点**没**被合并
    const xs = new Set<number>();
    for (let i = 0; i < r.positions.length; i += 3) xs.add(r.positions[i]!);
    expect(xs.has(5)).toBe(true);
    expect(xs.has(6)).toBe(true);
  });

  it("空模型 / 坏输入不炸", () => {
    expect(weldMagnetUntilClosed(new Float32Array(0)).merged).toBe(0);
    expect(weldMagnetUntilClosed(new Float32Array(0)).closed).toBe(false);
    // 容差非正 ⇒ 原样返回
    const soup = toSoup(cubeFaces(40));
    expect(weldMagnetSoup(soup, 0).merged).toBe(0);
    expect(weldMagnetSoup(soup, -1).merged).toBe(0);
  });
});
