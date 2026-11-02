/**
 * 网格夹具 —— WJP 模型检查算法的测试输入
 *
 * 覆盖各类打印缺陷,单位 mm,Z-up。检测范围:反转法向 / 坏边(缝隙、平面孔洞)/
 * 壳体;不检测悬空,不做壁厚检测。
 *
 * ## 为什么住在 src/test/ 下
 *
 * 这几个网格原先是产品里的「演示模型」(顶栏下拉框 + 空状态卡片网格,给访客
 * 点着看效果)。产品侧不需要演示入口,但几何本身是 `wjp-mesh.test.ts` 的
 * 断言基准 —— 删掉就没法验证 weld / analyze / wjp 三层算法了。
 *
 * 所以:**产品里删掉演示 UI,夹具挪到测试目录**,只服务测试。
 * 几何与断言都没动过,搬家不改行为。
 */
import type { RawMesh } from "@/features/tools/lib/mesh/types";

type Push = (
  a: readonly number[],
  b: readonly number[],
  c: readonly number[]
) => void;

/** 生成轴对齐盒子(可选择性去掉某些面),Z-up,返回三角汤 */
function boxTriangles(
  min: [number, number, number],
  max: [number, number, number],
  skipFaces: Set<"px" | "nx" | "py" | "ny" | "pz" | "nz"> = new Set()
): Float32Array {
  const tris: number[][] = [];
  const push: Push = (a, b, c) => tris.push([...a, ...b, ...c]);
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const v = {
    "000": [x0, y0, z0],
    "100": [x1, y0, z0],
    "110": [x1, y1, z0],
    "010": [x0, y1, z0],
    "001": [x0, y0, z1],
    "101": [x1, y0, z1],
    "111": [x1, y1, z1],
    "011": [x0, y1, z1],
  } as const;
  const push2 = (a: string, b: string, c: string, d: string) => {
    push(
      v[a as keyof typeof v],
      v[b as keyof typeof v],
      v[c as keyof typeof v]
    );
    push(
      v[a as keyof typeof v],
      v[c as keyof typeof v],
      v[d as keyof typeof v]
    );
  };
  if (!skipFaces.has("px")) push2("100", "110", "111", "101");
  if (!skipFaces.has("nx")) push2("000", "001", "011", "010");
  if (!skipFaces.has("py")) push2("010", "011", "111", "110");
  if (!skipFaces.has("ny")) push2("000", "100", "101", "001");
  if (!skipFaces.has("pz")) push2("001", "101", "111", "011");
  if (!skipFaces.has("nz")) push2("000", "010", "110", "100");
  return new Float32Array(tris.flat());
}

function toMesh(name: string, parts: Float32Array[]): RawMesh {
  let total = 0;
  for (const p of parts) total += p.length;
  const positions = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    positions.set(p, off);
    off += p.length;
  }
  return { name, positions };
}

/** UV 球(经纬分段),法线朝外,Z-up */
function uvSphere(
  tris: number[][],
  cx: number,
  cy: number,
  cz: number,
  r: number,
  seg = 20,
  stacks = 12
) {
  const pt = (i: number, j: number): number[] => {
    const phi = (i / stacks) * Math.PI;
    const theta = (j / seg) * Math.PI * 2;
    return [
      cx + r * Math.sin(phi) * Math.cos(theta),
      cy + r * Math.sin(phi) * Math.sin(theta),
      cz + r * Math.cos(phi),
    ];
  };
  const push = (a: number[], b: number[], c: number[]) =>
    tris.push([...a, ...b, ...c]);
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < seg; j++) {
      const p00 = pt(i, j),
        p10 = pt(i + 1, j),
        p11 = pt(i + 1, j + 1),
        p01 = pt(i, j + 1);
      if (i < stacks - 1) push(p00, p10, p11); // 极点处自动退化跳过
      if (i > 0) push(p00, p11, p01);
    }
  }
}

/** 1. 完整立方体:一切正常 */
export function perfectCube(): RawMesh {
  return toMesh("perfect", [boxTriangles([0, 0, 0], [20, 20, 20])]);
}

/** 2. 破损模型:平面孔洞(顶面缺失)+ 裂缝 + 退化面 + 重复面 + 非流形边 */
export function brokenMesh(): RawMesh {
  // 顶面缺失 → 顶面正方形边界 = 平面孔洞
  const base = boxTriangles([0, 0, 0], [20, 20, 20], new Set(["pz"]));
  const tris: number[] = Array.from(base);
  const add = (a: number[], b: number[], c: number[]) =>
    tris.push(...a, ...b, ...c);
  // 退化面:顶点重合的零面积片
  add([2, 2, 20], [2, 2, 20], [18, 2, 20]);
  // 重复面:与 y- 侧面第一片完全重合(绕向相反),不触碰顶面孔洞边界
  add([20, 0, 20], [0, 0, 0], [20, 0, 0]);
  // 非流形边 + 裂缝:在底边 [0,0,0]-[20,0,0] 上再挂一片(该边出现 3 个面,悬空两边成裂缝)
  add([0, 0, 0], [20, 0, 0], [10, -8, 0]);
  return { name: "broken", positions: new Float32Array(tris) };
}

/** 3. 薄壁空心立方体:外壳 + 密封内腔。验证密封内腔(多余内壳)检出:
 * 内壳面法线朝腔体内部,不误报翻转;内腔被外壳包裹,判为阻塞问题。 */
export function hollowShell(): RawMesh {
  const t = 0.5,
    s = 20;
  const outer = boxTriangles([0, 0, 0], [s, s, s]);
  const inner = boxTriangles([t, t, t], [s - t, s - t, s - t]);
  // 内腔面法线应指向腔体内部(与材料相反)→ 翻转内壳绕向
  const flipped = new Float32Array(inner.length);
  for (let f = 0; f < inner.length / 9; f++) {
    for (let k = 0; k < 3; k++) flipped[f * 9 + k] = inner[f * 9 + k]!;
    for (let k = 0; k < 3; k++) flipped[f * 9 + 3 + k] = inner[f * 9 + 6 + k]!;
    for (let k = 0; k < 3; k++) flipped[f * 9 + 6 + k] = inner[f * 9 + 3 + k]!;
  }
  return toMesh("thin", [outer, flipped]);
}

/** 4. 法线翻转(整体):几何完好但全部绕向相反(体积为负) */
export function invertedNormals(): RawMesh {
  const cube = boxTriangles([0, 0, 0], [20, 20, 20]);
  const flipped = new Float32Array(cube.length);
  for (let f = 0; f < cube.length / 9; f++) {
    // 交换 v1、v2 反转绕向
    for (let k = 0; k < 3; k++) flipped[f * 9 + k] = cube[f * 9 + k]!;
    for (let k = 0; k < 3; k++) flipped[f * 9 + 3 + k] = cube[f * 9 + 6 + k]!;
    for (let k = 0; k < 3; k++) flipped[f * 9 + 6 + k] = cube[f * 9 + 3 + k]!;
  }
  return { name: "inverted", positions: flipped };
}

/** 5. 局部法线翻转:仅 x+ 侧面第一片绕向相反(其余正常) */
export function localFlip(): RawMesh {
  const cube = boxTriangles([0, 0, 0], [20, 20, 20]);
  const flipped = new Float32Array(cube);
  // px 面最先写入:三角形 0 = (100,110,111),交换后两个顶点反转绕向
  for (let k = 0; k < 3; k++) {
    const tmp = flipped[3 + k]!;
    flipped[3 + k] = flipped[6 + k]!;
    flipped[6 + k] = tmp;
  }
  return { name: "local-flip", positions: flipped };
}

/** 6. 壳体与噪声壳体:30mm 立方体 + Ø5mm 正常小球(第二个部件)+ Ø1.4mm 噪声碎片 */
export function multiShell(): RawMesh {
  const cube = boxTriangles([0, 0, 0], [30, 30, 30]);
  const ballTris: number[][] = [];
  uvSphere(ballTris, 38, 15, 15, 2.5);
  const noiseTris: number[][] = [];
  uvSphere(noiseTris, 15, 38, 15, 0.7, 12, 8);
  return toMesh("shells", [
    cube,
    new Float32Array(ballTris.flat()),
    new Float32Array(noiseTris.flat()),
  ]);
}

/**
 * 夹具清单
 *
 * `key` 是夹具的稳定标识(断言用),`build` 每次调用都重新生成一份几何 ——
 * 别复用同一份 Float32Array,weld 过程会原地改顶点。
 */
export const MESH_FIXTURES: {
  key: string;
  build: () => RawMesh;
}[] = [
  { key: "perfect", build: perfectCube },
  { key: "broken", build: brokenMesh },
  { key: "thin", build: hollowShell },
  { key: "inverted", build: invertedNormals },
  { key: "local-flip", build: localFlip },
  { key: "shells", build: multiShell },
];
