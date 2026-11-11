/**
 * 网格清理 —— 让「不是封闭实体」的模型也能切(工作室 2026-11-11)
 *
 * 工作室的原话:**「不用装任何东西 —— 但模型不是封闭实体(有开放边 /
 * 非流形边)时会切不了 / 不要因为这个问题切不了」**。
 *
 * 后来又追加了一条:**「不需要修复用户的模型,只需要完成磁铁孔」**。
 *
 * ⇒ 这一层只做**清理**(剔废面、翻绕序、拆蝴蝶结顶点),**不补洞** ——
 * 补洞交给「临时盖面」那一层(`magnet-lid.ts`),盖面只喂给布尔运算,
 * 切完就摘掉 ⇒ **用户的模型上不会多出任何几何**。
 *
 * 清的每一样都在这儿钉死:
 *
 * | 毛病 | 做法 | 断言 |
 * |---|---|---|
 * | 缺一个面(洞) | **不动**(临时盖面那一层的事) | 洞还在 / 体积是缺的那一半 |
 * | 有一个面绕序翻了 | 翻少数派 | 体积还是 8 |
 * | 重复面 | 只留一张 | 剔掉一张,封闭 |
 * | 退化面(零面积) | 删掉 | 剔掉,封闭 |
 * | 非流形边(鳍) | 删掉多出来的面 | 剔掉,封闭(切完会放回去) |
 * | 蝴蝶结顶点 | 拆成两份顶点 | 两个壳各自封闭 |
 * | 本来就是好的 | 什么都不动 | `changed === false` |
 *
 * 另外守住 **UV / 材质跟面走** —— 清网会删面、翻面,UV 必须跟着
 * 对齐,不然贴图会花(切出来的东西贴错图)。
 */
import { describe, expect, it } from "vitest";

import {
  repairMagnetGeometry,
  splitMagnetVertices,
} from "@/features/magnet/lib/magnet-repair";
import { weldAndAnalyzeTopology } from "@/features/tools/lib/mesh/weld";

type V3 = [number, number, number];

/** 立方体(法线朝外)的顶点 + 面 */
const CUBE_V: V3[] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

const CUBE_F: [number, number, number][] = [
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

/** 顶点 + 面 → 三角汤 */
function soup(verts: V3[], faces: [number, number, number][]): Float32Array {
  const out = new Float32Array(faces.length * 9);
  faces.forEach((f, i) => {
    for (let k = 0; k < 3; k++) {
      const p = verts[f[k]!]!;
      out[i * 9 + k * 3] = p[0];
      out[i * 9 + k * 3 + 1] = p[1];
      out[i * 9 + k * 3 + 2] = p[2];
    }
  });
  return out;
}

/** 立方体的三角汤 */
function cubeSoup(): Float32Array {
  return soup(CUBE_V, CUBE_F);
}

/** 有符号体积(正 = 法线朝外) */
function signedVolume(positions: Float32Array): number {
  let vol = 0;
  for (let f = 0; f < positions.length / 9; f++) {
    const ax = positions[f * 9]!,
      ay = positions[f * 9 + 1]!,
      az = positions[f * 9 + 2]!;
    const bx = positions[f * 9 + 3]!,
      by = positions[f * 9 + 4]!,
      bz = positions[f * 9 + 5]!;
    const cx = positions[f * 9 + 6]!,
      cy = positions[f * 9 + 7]!,
      cz = positions[f * 9 + 8]!;
    vol +=
      (ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx)) /
      6;
  }
  return vol;
}

/** 开放边 / 非流形边条数 */
function edgeStats(positions: Float32Array): {
  open: number;
  nonManifold: number;
  flipped: number;
} {
  const topo = weldAndAnalyzeTopology(positions);
  return {
    open: topo.components.reduce((s, c) => s + c.openEdges, 0),
    nonManifold: topo.components.reduce((s, c) => s + c.nonManifoldEdges, 0),
    flipped: topo.flippedFaceCount,
  };
}

/** indexed 网格 → 三角汤 */
function toSoup(vertices: Float32Array, faceVertex: Uint32Array): Float32Array {
  const faceCount = faceVertex.length / 3;
  const out = new Float32Array(faceCount * 9);
  for (let f = 0; f < faceCount; f++) {
    for (let k = 0; k < 3; k++) {
      const v = faceVertex[f * 3 + k]!;
      out[f * 9 + k * 3] = vertices[v * 3]!;
      out[f * 9 + k * 3 + 1] = vertices[v * 3 + 1]!;
      out[f * 9 + k * 3 + 2] = vertices[v * 3 + 2]!;
    }
  }
  return out;
}

/**
 * 修一遍(**跟切割那层同一个流程**)
 *
 * 焊接 → 阶段 A(几何修复)→ **再焊一次** → 阶段 B(拆蝴蝶结顶点)
 *
 * 拆顶点必须排在再焊**之后** —— 再焊会把坐标相同的那几份顶点合回去。
 */
function repair(positions: Float32Array) {
  const topo = weldAndAnalyzeTopology(positions);
  const phaseA = repairMagnetGeometry({
    vertices: topo.mesh.vertices,
    faceVertex: topo.mesh.faceVertex,
  });
  const topo1 = weldAndAnalyzeTopology(phaseA.positions);
  const phaseB = splitMagnetVertices({
    vertices: topo1.mesh.vertices,
    faceVertex: topo1.mesh.faceVertex,
  });
  const result = {
    ...phaseA,
    report: {
      ...phaseA.report,
      splitVertices: phaseB.splitVertices,
    },
  };
  const after = edgeStats(toSoup(phaseB.vertices, phaseB.faceVertex));
  return { result, after };
}

describe("网格清理 —— 破面 / 破边 / 非流形(工作室 2026-11-11)", () => {
  it("缺一个面的立方体 ⇒ **洞还在**(这一层不补洞)", () => {
    // 去掉 -X 面里的一个三角形 ⇒ 留一个三角洞
    const broken = soup(
      CUBE_V,
      CUBE_F.filter((_, i) => i !== CUBE_F.length - 1)
    );
    expect(edgeStats(broken).open).toBeGreaterThan(0);

    const { result, after } = repair(broken);
    // **这一层不补洞** —— 补洞是「临时盖面」那一层的事(切完就摘掉,
    // 用户的模型上不会多出任何面)。见 `magnet-lid.test.ts`。
    expect(result.report.cappedLoops).toBe(0);
    expect(result.report.lidFaces).toBe(0);
    // 模型自己还是破的 —— 界面上的告知要按这个口径写
    expect(result.report.closed).toBe(false);
    // 破口还在
    expect(after.open).toBeGreaterThan(0);
    expect(after.nonManifold).toBe(0);
  });

  it("缺的那个面**没有被偷偷补上** —— 体积就是缺的那一半", () => {
    const broken = soup(
      CUBE_V,
      CUBE_F.filter((_, i) => i !== CUBE_F.length - 1)
    );
    const { result } = repair(broken);
    // 边长 2 的立方体 ⇒ 体积 8;缺掉 −X 面的一半(一个三角形)⇒ 8 − 2/3
    // (那个 2/3 是那个三角形跟原点构成的四面体)
    //
    // (盖面的方向对不对,在 `magnet-lid.test.ts` 里查 —— 那是临时盖面
    //  那一层的事,跟这一层无关。)
    expect(signedVolume(result.positions)).toBeCloseTo(8 - 2 / 3, 4);
    // **没有被补成完好的立方体** —— 破口还在
    expect(signedVolume(result.positions)).toBeLessThan(8);
  });

  it("有一个面的绕序是翻着的 ⇒ 修好,体积还是 8", () => {
    const src = cubeSoup();
    // 把第 5 张面的后两个顶点对调 ⇒ 那张面的法线翻了
    const flipped = new Float32Array(src);
    const base = 5 * 9;
    for (let k = 0; k < 3; k++) {
      flipped[base + 3 + k] = src[base + 6 + k]!;
      flipped[base + 6 + k] = src[base + 3 + k]!;
    }
    const { result, after } = repair(flipped);
    expect(result.report.flippedFaces).toBe(1);
    expect(after.open).toBe(0);
    expect(after.nonManifold).toBe(0);
    expect(signedVolume(result.positions)).toBeCloseTo(8, 4);
  });

  it("重复面 ⇒ 剔掉一张", () => {
    const dup = soup(CUBE_V, [...CUBE_F, CUBE_F[0]!]);
    const { result, after } = repair(dup);
    expect(result.report.droppedDuplicate).toBe(1);
    expect(after.open).toBe(0);
    expect(after.nonManifold).toBe(0);
  });

  it("退化面(零面积)⇒ 剔掉", () => {
    // 拿一个跟别的面共两个顶点的三角形 ⇒ 面积是 0
    const degen = soup(CUBE_V, [...CUBE_F, [0, 1, 1]]);
    const { result, after } = repair(degen);
    expect(result.report.droppedDegenerate).toBe(1);
    expect(after.open).toBe(0);
    expect(after.nonManifold).toBe(0);
  });

  it("非流形边(一个「鳍」贴在边上)⇒ 删掉多出来的面,还是封闭的", () => {
    // 鳍 = 一张共用立方体那条边 (1,2) 的三角形
    const verts = [...CUBE_V, [2, 0, 0] as V3];
    const fin: [number, number, number] = [1, 2, 8];
    const broken = soup(verts, [...CUBE_F, fin]);
    expect(edgeStats(broken).nonManifold).toBeGreaterThan(0);

    const { result, after } = repair(broken);
    expect(result.report.droppedNonManifold).toBe(1);
    expect(after.open).toBe(0);
    expect(after.nonManifold).toBe(0);
  });

  it("蝴蝶结顶点(两个四面体只共一个顶点)⇒ 拆开,两个壳各自封闭", () => {
    const verts: V3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [-1, 0, 0],
      [0, -1, 0],
      [0, 0, -1],
    ];
    const faces: [number, number, number][] = [
      // 四面体 A
      [0, 2, 1],
      [0, 1, 3],
      [0, 3, 2],
      [1, 2, 3],
      // 四面体 B(跟 A 只共顶点 0)
      [0, 4, 5],
      [0, 5, 6],
      [0, 6, 4],
      [4, 5, 6],
    ];
    const broken = soup(verts, faces);
    const { result, after } = repair(broken);
    expect(result.report.splitVertices).toBeGreaterThan(0);
    expect(after.open).toBe(0);
    expect(after.nonManifold).toBe(0);
  });

  it("本来就是好的模型 ⇒ 一个字都不用改", () => {
    const { result, after } = repair(cubeSoup());
    expect(result.report.changed).toBe(false);
    expect(after.open).toBe(0);
    expect(after.nonManifold).toBe(0);
  });
});

describe("UV / 材质跟着面走", () => {
  it("修完之后 UV 还是每面 6 个 float,跟面一一对齐", () => {
    const broken = soup(
      CUBE_V,
      CUBE_F.filter((_, i) => i !== CUBE_F.length - 1)
    );
    const topo = weldAndAnalyzeTopology(broken);
    const faceCount = topo.mesh.faceVertex.length / 3;
    // 每面一个自己的 UV(0.1 递增)—— 修完之后能对回去
    const uvs = new Float32Array(faceCount * 6);
    const materialIndex = new Uint16Array(faceCount);
    for (let f = 0; f < faceCount; f++) {
      for (let k = 0; k < 3; k++) {
        uvs[f * 6 + k * 2] = f / 100 + k / 1000;
        uvs[f * 6 + k * 2 + 1] = k / 10;
      }
      materialIndex[f] = f % 3;
    }
    const result = repairMagnetGeometry({
      vertices: topo.mesh.vertices,
      faceVertex: topo.mesh.faceVertex,
      uvs,
      materialIndex,
    });
    const outFaces = result.positions.length / 9;
    expect(result.uvs?.length).toBe(outFaces * 6);
    expect(result.materialIndex?.length).toBe(outFaces);
    // 材质不能全丢光(分组还在)
    const unique = new Set(result.materialIndex ?? []);
    expect(unique.size).toBeGreaterThan(1);
  });
});
