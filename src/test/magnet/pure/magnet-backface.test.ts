/**
 * 智能识别背面 —— 找模型上**最大的一块平面区域**
 *
 * 守的是工作室 2026-11-11 提的那条:
 *
 * > 「为什么没有按照原来脚本那样智能识别背面」
 *
 * 原脚本只在**六个轴向**里找 —— 那个模型在 Blender 里是轴对齐的,所以
 * 背面正好平行于某个轴,看起来像「智能」。模型一歪,六面里就**没有背面了**。
 *
 * 这里的口径:**按面积找最大的平面区域,跟模型朝向无关**。
 *
 * 这些都是纯函数(不碰 manifold、不碰浏览器)—— 直接跑 indexed 网格。
 */
import { describe, expect, it } from "vitest";
import type { MagnetIndexedMesh } from "@/features/magnet/lib/magnet-backface";
import {
  angleBetweenDeg,
  detectFlatPatches,
  pickBackFace,
} from "@/features/magnet/lib/magnet-backface";

/**
 * 一个长方体的 indexed 网格(法线朝外)
 *
 * 顶点序跟 `magnet-cut.test.ts` 里那个立方体一致 —— 底面(-Z)两个三角形
 * 在最前面,顶面(+Z)紧跟着。
 */
function boxMesh(sx: number, sy: number, sz: number): MagnetIndexedMesh {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const vertices = new Float32Array([
    -hx,
    -hy,
    -hz,
    hx,
    -hy,
    -hz,
    hx,
    hy,
    -hz,
    -hx,
    hy,
    -hz,
    -hx,
    -hy,
    hz,
    hx,
    -hy,
    hz,
    hx,
    hy,
    hz,
    -hx,
    hy,
    hz,
  ]);
  const faceVertex = new Uint32Array([
    // -Z
    0, 3, 2, 0, 2, 1,
    // +Z
    4, 5, 6, 4, 6, 7,
    // -Y
    0, 1, 5, 0, 5, 4,
    // +X
    1, 2, 6, 1, 6, 5,
    // +Y
    2, 3, 7, 2, 7, 6,
    // -X
    3, 0, 4, 3, 4, 7,
  ]);
  return { vertices, faceVertex };
}

/** 绕 X 轴转 `deg` 度(刚体旋转,拓扑不动) */
function rotateX(mesh: MagnetIndexedMesh, deg: number): MagnetIndexedMesh {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const out = new Float32Array(mesh.vertices.length);
  for (let i = 0; i < mesh.vertices.length; i += 3) {
    const y = mesh.vertices[i + 1]!;
    const z = mesh.vertices[i + 2]!;
    out[i] = mesh.vertices[i]!;
    out[i + 1] = y * c - z * s;
    out[i + 2] = y * s + z * c;
  }
  return { vertices: out, faceVertex: mesh.faceVertex };
}

/** indexed 网格 → 三角汤 */
function toSoup(mesh: MagnetIndexedMesh): Float32Array {
  const triCount = mesh.faceVertex.length / 3;
  const out = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = mesh.faceVertex[t * 3 + k]! * 3;
      out[t * 9 + k * 3] = mesh.vertices[vi]!;
      out[t * 9 + k * 3 + 1] = mesh.vertices[vi + 1]!;
      out[t * 9 + k * 3 + 2] = mesh.vertices[vi + 2]!;
    }
  }
  return out;
}

describe("夹角", () => {
  it("同一个方向是 0°", () => {
    expect(angleBetweenDeg([1, 0, 0], [1, 0, 0])).toBeCloseTo(0, 6);
  });

  it("垂直是 90°", () => {
    expect(angleBetweenDeg([1, 0, 0], [0, 1, 0])).toBeCloseTo(90, 6);
  });

  it("反向是 180°", () => {
    expect(angleBetweenDeg([1, 0, 0], [-1, 0, 0])).toBeCloseTo(180, 6);
  });
});

describe("detectFlatPatches —— 区域生长", () => {
  it("立方体 ⇒ 六块平面区域,每块 40×40 = 1600mm²", () => {
    const patches = detectFlatPatches(boxMesh(40, 40, 40));

    expect(patches).toHaveLength(6);
    for (const p of patches) {
      expect(p.areaMm2).toBeCloseTo(1600, 4);
      // 一个立方体的六个面彼此垂直 ⇒ 每块区域内部完全平
      expect(p.meanDeviationDeg).toBeCloseTo(0, 6);
      // 每块区域两个三角形
      expect(p.faceCount).toBe(2);
    }
  });

  it("长方体 ⇒ 面积最大的那两块是上下两面", () => {
    const patches = detectFlatPatches(boxMesh(40, 40, 10));

    // 上下两面 40×40 = 1600,四个侧面 40×10 = 400
    expect(patches[0]!.areaMm2).toBeCloseTo(1600, 4);
    expect(patches[1]!.areaMm2).toBeCloseTo(1600, 4);
    expect(patches[2]!.areaMm2).toBeCloseTo(400, 4);
    // 面积从大到小排
    for (let i = 1; i < patches.length; i++) {
      expect(patches[i]!.areaMm2).toBeLessThanOrEqual(patches[i - 1]!.areaMm2);
    }
  });

  it("**模型歪了也找得到** —— 这是「智能识别背面」的关键", () => {
    // 绕 X 轴转 37° —— 上下两面不再平行于任何坐标轴
    const tilted = rotateX(boxMesh(40, 40, 10), 37);
    const patches = detectFlatPatches(tilted);

    // 照样找到 6 块,面积一模一样
    expect(patches).toHaveLength(6);
    expect(patches[0]!.areaMm2).toBeCloseTo(1600, 4);

    // 法线也跟着转了 —— 不是 [0,0,1] 了
    const n = patches[0]!.normal;
    expect(n[2]).not.toBeCloseTo(1, 3);
    // 但它仍然是个单位向量
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 6);
  });

  it("面积下限能过滤掉小区域", () => {
    const patches = detectFlatPatches(boxMesh(40, 40, 10), {
      minAreaMm2: 1000,
    });
    expect(patches).toHaveLength(2);
    expect(patches[0]!.areaMm2).toBeCloseTo(1600, 4);
  });

  it("退化面(零面积)被剔掉 —— 不进任何区域", () => {
    const base = boxMesh(40, 40, 40);
    // 加一个三个顶点重合的退化面
    const faceVertex = new Uint32Array(base.faceVertex.length + 3);
    faceVertex.set(base.faceVertex);
    faceVertex.set([0, 0, 0], base.faceVertex.length);

    const patches = detectFlatPatches({ vertices: base.vertices, faceVertex });
    // 还是六块 —— 退化面既没进区域,也没把区域撑大
    expect(patches).toHaveLength(6);
    for (const p of patches) {
      expect(p.areaMm2).toBeCloseTo(1600, 4);
    }
  });

  it("空网格 ⇒ 空数组(不炸)", () => {
    expect(
      detectFlatPatches({
        vertices: new Float32Array(0),
        faceVertex: new Uint32Array(0),
      })
    ).toEqual([]);
  });
});

describe("pickBackFace", () => {
  it("挑面积最大的那块", () => {
    const back = pickBackFace([
      {
        areaMm2: 100,
        normal: [0, 0, 1],
        centroid: [0, 0, 0],
        faceCount: 1,
        meanDeviationDeg: 0,
        maxDeviationDeg: 0,
      },
      {
        areaMm2: 900,
        normal: [0, 1, 0],
        centroid: [0, 0, 0],
        faceCount: 9,
        meanDeviationDeg: 3,
        maxDeviationDeg: 5,
      },
      {
        areaMm2: 400,
        normal: [1, 0, 0],
        centroid: [0, 0, 0],
        faceCount: 4,
        meanDeviationDeg: 1,
        maxDeviationDeg: 2,
      },
    ]);
    expect(back?.areaMm2).toBe(900);
  });

  it("面积一样 ⇒ 挑更平的那块", () => {
    const back = pickBackFace([
      {
        areaMm2: 500,
        normal: [0, 0, 1],
        centroid: [0, 0, 0],
        faceCount: 5,
        meanDeviationDeg: 8,
        maxDeviationDeg: 12,
      },
      {
        areaMm2: 500,
        normal: [0, 1, 0],
        centroid: [0, 0, 0],
        faceCount: 5,
        meanDeviationDeg: 2,
        maxDeviationDeg: 4,
      },
    ]);
    expect(back?.meanDeviationDeg).toBe(2);
  });

  it("一个区域都没有 ⇒ null", () => {
    expect(pickBackFace([])).toBeNull();
  });
});

describe("indexed 网格 → 三角汤", () => {
  it("顶点数跟面数对得上", () => {
    const mesh = boxMesh(40, 40, 10);
    const soup = toSoup(mesh);
    expect(soup.length).toBe((mesh.faceVertex.length / 3) * 9);
  });
});
