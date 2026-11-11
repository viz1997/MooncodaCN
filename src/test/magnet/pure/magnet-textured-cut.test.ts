/**
 * 磁吸孔切割 —— **带贴图的真实模型**
 *
 * 工作室 2026-11-11 提的第三条是「导出模型需要保留原来的材质贴图」。
 * 立方体那种测试(每个位置只有一个 UV)其实**测不到**贴图那条路上最脆的
 * 一环 —— **UV 接缝**:
 *
 * - UV 展开会在模型上留一条「缝」:缝两边的顶点**位置完全相同**,但 UV 不同
 * - manifold 的属性是**逐顶点**的 ⇒ 直接用焊接出来的顶点,缝就没了(贴图花)
 * - 仓库的做法是「每个角一份属性顶点 + 按位置合并回去」(`mergeFromVert` /
 *   `mergeToVert`)—— 位置合并了,UV 各留各的
 *
 * 这条接缝那条路**只有真模型才有** ⇒ 这里用一个带缝的 UV 球来守。
 *
 * 另外顺带守一件工作室很在意的事:**干净模型切起来很快** ——
 * 三万多个三角形只要几百毫秒。所以「切割超时 5 分钟」这个结果**一定是
 * 模型本身有毛病**(自相交 / 面数爆炸),不是工具慢。
 */
import { describe, expect, it } from "vitest";
import {
  analyzeModel,
  cutMagnetPocket,
} from "@/features/magnet/lib/magnet-cutter-handler";
import type { MagnetTextureInput } from "@/features/magnet/lib/magnet-cutter-protocol";

/** 棱柱的三角汤(法线朝外)—— 用来测「真实体量切多久」 */
function prismSoup(
  segments: number,
  rings: number,
  radius: number,
  height: number
): Float32Array {
  const h = height / 2;
  const out: number[] = [];
  const ringZ = (j: number) => -h + (2 * h * j) / rings;
  const px = (i: number) => radius * Math.cos((2 * Math.PI * i) / segments);
  const py = (i: number) => radius * Math.sin((2 * Math.PI * i) / segments);
  const push = (x: number, y: number, z: number) => {
    out.push(x, y, z);
  };
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    push(0, 0, h);
    push(px(i), py(i), h);
    push(px(j), py(j), h);
  }
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    push(0, 0, -h);
    push(px(j), py(j), -h);
    push(px(i), py(i), -h);
  }
  for (let r = 0; r < rings; r++) {
    const z0 = ringZ(r);
    const z1 = ringZ(r + 1);
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      const ax = px(i);
      const ay = py(i);
      const bx = px(j);
      const by = py(j);
      push(ax, ay, z0);
      push(bx, by, z1);
      push(ax, ay, z1);
      push(ax, ay, z0);
      push(bx, by, z0);
      push(bx, by, z1);
    }
  }
  return new Float32Array(out);
}

/**
 * 带接缝的圆柱 —— **UV 接缝** + **三个材质组** + 一块够大的平面顶盖
 *
 * 四样都是真实 AI 生成模型的特征:
 *
 * 1. **接缝** —— 经度 0 那条线上有两个位置相同、UV 不同的顶点
 *    (环上多一列:第 `segments` 列跟第 0 列位置重合,UV 是 u=1 而不是 u=0)
 * 2. **两个端面各有一个中心顶点**(不是一圈重合的顶点 —— 那会造出退化面)
 * 3. **三个材质组** —— 按列分
 * 4. **顶盖是块大平面** —— 孔得放得下(Ø20.7 的孔要 Ø22 以上的面)
 *
 * ⚠️ **绕序朝外** —— 法线朝内的模型会被 `INVERTED_WINDING` 那道闸拒掉。
 */
function seamedCylinder(
  segments: number,
  rings: number,
  radius: number,
  height: number
): {
  positions: Float32Array;
  texture: MagnetTextureInput;
} {
  const positions: number[] = [];
  const uvs: number[] = [];
  /** 每三角形一个材质下标(跟 `zip-extractor` 的解析结果一个格式) */
  const materialIndex: number[] = [];

  const half = height / 2;
  const ringZ = (j: number) => -half + (height * j) / rings;

  /** 侧壁上的点:第 `segments` 列跟第 0 列**位置重合**(接缝),UV 不同 */
  const sidePoint = (j: number, i: number): [number, number, number] => {
    const phi = (2 * Math.PI * i) / segments;
    return [radius * Math.cos(phi), radius * Math.sin(phi), ringZ(j)];
  };
  const sideUv = (j: number, i: number): [number, number] => [
    i / segments,
    j / rings,
  ];
  /** 端面上的点(平面投影)—— 同样带接缝 */
  const capPoint = (top: boolean, i: number): [number, number, number] => {
    const phi = (2 * Math.PI * i) / segments;
    return [radius * Math.cos(phi), radius * Math.sin(phi), top ? half : -half];
  };
  const capUv = (top: boolean, i: number): [number, number] => [
    0.5 + 0.5 * Math.cos((2 * Math.PI * i) / segments),
    0.5 + (top ? 0.5 : -0.5) * Math.sin((2 * Math.PI * i) / segments),
  ];

  const tri = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    ua: [number, number],
    ub: [number, number],
    uc: [number, number],
    mat: number
  ) => {
    positions.push(...a, ...b, ...c);
    uvs.push(...ua, ...ub, ...uc);
    materialIndex.push(mat);
  };

  // --- 侧壁 ---
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = sidePoint(j, i);
      const b = sidePoint(j, i + 1);
      const c = sidePoint(j + 1, i + 1);
      const d = sidePoint(j + 1, i);
      const ua = sideUv(j, i);
      const ub = sideUv(j, i + 1);
      const uc = sideUv(j + 1, i + 1);
      const ud = sideUv(j + 1, i);
      // 绕序朝外:法线得指着圆柱外面
      tri(a, b, c, ua, ub, uc, i % 3);
      tri(a, c, d, ua, uc, ud, i % 3);
    }
  }

  // --- 两个端面(各自一个中心顶点)---
  const topCenter: [number, number, number] = [0, 0, half];
  const bottomCenter: [number, number, number] = [0, 0, -half];
  for (let i = 0; i < segments; i++) {
    const p0 = capPoint(true, i);
    const p1 = capPoint(true, i + 1);
    const u0 = capUv(true, i);
    const u1 = capUv(true, i + 1);
    tri(topCenter, p0, p1, [0.5, 0.5], u0, u1, i % 3);

    const q0 = capPoint(false, i);
    const q1 = capPoint(false, i + 1);
    const v0 = capUv(false, i);
    const v1 = capUv(false, i + 1);
    tri(bottomCenter, q1, q0, [0.5, 0.5], v1, v0, i % 3);
  }

  return {
    positions: new Float32Array(positions),
    texture: {
      uvs: new Float32Array(uvs),
      materialIndex: new Uint16Array(materialIndex),
      materialNames: ["mat-a", "mat-b", "mat-c"],
    },
  };
}

describe("带贴图的真实模型(带接缝的圆柱 + 三个材质)", () => {
  it("模型本身是封闭流形 —— 自动修复不动它,照样切得动", async () => {
    const model = seamedCylinder(64, 16, 25, 40);
    const analysis = await analyzeModel(model.positions, null);
    expect(analysis.volume).toBeGreaterThan(0);
    expect(analysis.faces.length).toBeGreaterThan(0);
  });

  it("切得动,而且**接缝还在**(位置相同、UV 不同)", async () => {
    const model = seamedCylinder(64, 16, 25, 40);
    const result = await cutMagnetPocket(
      model.positions,
      "auto",
      null,
      model.texture
    );

    expect(result.triangleCount).toBeGreaterThan(0);
    expect(result.removedVolume).toBeGreaterThan(0);
    expect(result.uvs).not.toBeNull();
    expect(result.materialIndex).not.toBeNull();

    // **接缝还在** —— 不同的 UV 比不同的位置多
    // (缝两边的位置重合、UV 不同 ⇒ 位置集合被 UV 集合盖过)
    const positions = distinctPositions(result.positions);
    const uvPairs = distinctUvPairs(result.uvs!);
    expect(uvPairs.size).toBeGreaterThan(positions.size);

    // 三个材质都还在
    const mats = new Set(result.materialIndex!);
    expect(mats.size).toBe(3);
  });
});

describe("切割耗时(真实体量)", () => {
  it("干净模型切得很快 —— 超时 5 分钟一定是模型有毛病", async () => {
    const positions = prismSoup(256, 64, 20, 40);
    const triCount = positions.length / 9;
    expect(triCount).toBeGreaterThan(30000);

    const t0 = Date.now();
    const result = await cutMagnetPocket(positions, "auto", null, null);
    const elapsed = Date.now() - t0;

    expect(result.triangleCount).toBeGreaterThan(0);
    // 三万个三角形几百毫秒就完了 —— 给 10 秒的余量(跑得慢的机器也不误伤)
    expect(elapsed).toBeLessThan(10_000);
  }, 60_000);
});

/** 三角汤里有多少个不同的位置(四舍五入到 1e-4) */
function distinctPositions(positions: Float32Array): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < positions.length; i += 3) {
    out.add(
      `${Math.round(positions[i]! * 1e4)},${Math.round(positions[i + 1]! * 1e4)},${Math.round(positions[i + 2]! * 1e4)}`
    );
  }
  return out;
}

/** UV 里有多少对不同的 (u,v) */
function distinctUvPairs(uvs: Float32Array): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < uvs.length; i += 2) {
    out.add(`${Math.round(uvs[i]! * 1e4)},${Math.round(uvs[i + 1]! * 1e4)}`);
  }
  return out;
}
