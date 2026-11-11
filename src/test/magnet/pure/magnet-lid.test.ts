/**
 * 临时盖面 —— 让「不是封闭实体」的模型能参与布尔运算,但**不改用户的模型**
 *
 * 工作室的两句话**同时**成立:
 *
 * > 「不用装任何东西 —— 但模型不是封闭实体(有开放边 / 非流形边)时会切不了
 * > / 不要因为这个问题切不了」
 * >
 * > 「不需要修复用户的模型,只需要完成磁铁孔」
 *
 * ⇒ 破口要能切,用户的模型却不能被改。这一层就是那个折中:
 * **盖面是临时的** —— 只喂给布尔运算,切完摘掉。
 *
 * 这一层守的是:
 *
 * | 什么 | 断言 |
 * |---|---|
 * | 边界环找得对 | 缺一个面的立方体 ⇒ 1 个环 / 3 条开放边 |
 * | 完好的模型 | 没有环 / 没有盖面 |
 * | **盖面方向朝外** | 盖上之后体积是 **+8**(不是 -8) |
 * | 盖面用模型自己的顶点 | 不新建顶点 ⇒ 跟模型的边严丝合缝 |
 * | 盖完之后是封闭的 | 开放边 0 条 |
 */
import { describe, expect, it } from "vitest";

import {
  buildMagnetLid,
  countEdges,
  edgeKey,
  scanMagnetBoundary,
} from "@/features/magnet/lib/magnet-lid";

type V3 = [number, number, number];

/** 立方体(法线朝外)的顶点 + 面 —— 边长 2 */
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

/** 顶点 + 面 → 顶点表 + 索引面表 */
function indexed(verts: V3[], faces: [number, number, number][]) {
  const vertices = new Float32Array(verts.length * 3);
  verts.forEach((v, i) => {
    vertices[i * 3] = v[0];
    vertices[i * 3 + 1] = v[1];
    vertices[i * 3 + 2] = v[2];
  });
  const faceVertex: number[] = [];
  for (const f of faces) faceVertex.push(f[0], f[1], f[2]);
  return { vertices, faceVertex };
}

/** 有符号体积(正 = 法线朝外) */
function signedVolume(vertices: Float32Array, triangles: number[][]): number {
  let vol = 0;
  for (const t of triangles) {
    const a = t[0]!;
    const b = t[1]!;
    const c = t[2]!;
    const ax = vertices[a * 3]!,
      ay = vertices[a * 3 + 1]!,
      az = vertices[a * 3 + 2]!;
    const bx = vertices[b * 3]!,
      by = vertices[b * 3 + 1]!,
      bz = vertices[b * 3 + 2]!;
    const cx = vertices[c * 3]!,
      cy = vertices[c * 3 + 1]!,
      cz = vertices[c * 3 + 2]!;
    vol +=
      (ax * (by * cz - bz * cy) +
        ay * (bz * cx - bx * cz) +
        az * (bx * cy - by * cx)) /
      6;
  }
  return vol;
}

/** 立方体(缺最后一张面)⇒ 留一个三角洞 */
const OPEN_FACES = CUBE_F.filter((_, i) => i !== CUBE_F.length - 1);

describe("临时盖面 —— 切得动,但不改用户的模型", () => {
  it("边键不分方向 —— (a,b) 和 (b,a) 是同一条边", () => {
    expect(edgeKey(3, 7)).toBe(edgeKey(7, 3));
    expect(edgeKey(3, 7)).not.toBe(edgeKey(3, 8));
  });

  it("完好的立方体 ⇒ 没有环、没有盖面", () => {
    const { faceVertex } = indexed(CUBE_V, CUBE_F);
    const scan = scanMagnetBoundary(faceVertex);
    expect(scan.openEdges).toBe(0);
    expect(scan.nonManifoldEdges).toBe(0);
    expect(scan.loops.length).toBe(0);

    const { vertices } = indexed(CUBE_V, CUBE_F);
    const lid = buildMagnetLid(vertices, scan.loops);
    expect(lid.triangles.length).toBe(0);
    expect(lid.cappedLoops).toBe(0);
    expect(lid.lidFaces).toBe(0);
    expect(lid.bbox).toBeNull();
  });

  it("缺一个面的立方体 ⇒ 找得到那个三角洞(1 个环 / 3 条开放边)", () => {
    const { faceVertex } = indexed(CUBE_V, OPEN_FACES);
    const scan = scanMagnetBoundary(faceVertex);
    expect(scan.openEdges).toBe(3);
    expect(scan.nonManifoldEdges).toBe(0);
    expect(scan.loops.length).toBe(1);
    // 环上三个顶点
    expect(scan.loops[0]!.length).toBe(3);
    // 环上的边都在开放边里
    expect(scan.cappedEdges).toBe(3);
  });

  it("**盖面方向朝外** —— 盖上之后体积是 +8(不是 -8)", () => {
    const { vertices, faceVertex } = indexed(CUBE_V, OPEN_FACES);
    const scan = scanMagnetBoundary(faceVertex);
    const lid = buildMagnetLid(vertices, scan.loops);

    expect(lid.cappedLoops).toBe(1);
    expect(lid.lidFaces).toBe(1);
    expect(lid.triangles.length).toBe(1);

    // 边长 2 的立方体 ⇒ 完整体积 8。盖上面之后正好回到 8。
    //
    // ⚠️ 用**正着的**环盖就是 -8(法线朝内)—— 那会让 manifold 拒收。
    const triangles = [...OPEN_FACES, ...lid.triangles];
    expect(signedVolume(vertices, triangles)).toBeCloseTo(8, 4);
  });

  it("盖面用模型自己的顶点 —— 不新建顶点(跟模型的边严丝合缝)", () => {
    const { vertices, faceVertex } = indexed(CUBE_V, OPEN_FACES);
    const scan = scanMagnetBoundary(faceVertex);
    const lid = buildMagnetLid(vertices, scan.loops);

    for (const tri of lid.triangles) {
      for (const v of tri) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(CUBE_V.length);
      }
    }
    // 盖面的三个顶点就是环上的那三个
    const loop = new Set(scan.loops[0]!);
    for (const v of lid.triangles[0]!) expect(loop.has(v)).toBe(true);
  });

  it("盖上之后是封闭的 —— 开放边 0 条", () => {
    const { vertices, faceVertex } = indexed(CUBE_V, OPEN_FACES);
    const scan = scanMagnetBoundary(faceVertex);
    const lid = buildMagnetLid(vertices, scan.loops);

    // 盖上盖面之后重新扫一遍 ⇒ 应该没有开放边了
    const capped = [...faceVertex, ...lid.triangles.flat()];
    const after = scanMagnetBoundary(capped);
    expect(after.openEdges).toBe(0);
    expect(after.nonManifoldEdges).toBe(0);
  });

  it("边统计 —— 一条边被 3 个面共用就是非流形", () => {
    const index = new Map<number, number[]>();
    index.set(edgeKey(0, 1), [0, 1, 2]);
    const stats = countEdges(index);
    expect(stats.open).toBe(0);
    expect(stats.nonManifold).toBe(1);
  });

  it("空输入不炸", () => {
    const scan = scanMagnetBoundary([]);
    expect(scan.loops.length).toBe(0);
    expect(scan.openEdges).toBe(0);

    const lid = buildMagnetLid(new Float32Array(0), []);
    expect(lid.triangles.length).toBe(0);
    expect(lid.bbox).toBeNull();
  });
});
