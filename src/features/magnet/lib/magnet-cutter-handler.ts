/**
 * 磁吸孔切割的核心 —— 焊接 → 校验 → 挑面 → 布尔 → 出料
 *
 * ## 为什么用 Manifold3D
 *
 * 工作室那段 Blender 脚本自己就暴露了「为什么要好引擎」:它用 **EXACT**
 * 求解器、还带 FAST 兜底,切完还要专门清理法线(`normals_make_consistent` +
 * `remove_doubles` + `quads_convert_to_tris`)—— 说明 BSP 那种布尔在这个
 * 模型上不够干净。
 *
 * **Manifold3D 正是 Blender EXACT 求解器背后的那个引擎**(elalish/manifold,
 * Apache-2.0),它保证输出是流形 manifold。
 *
 * ## 流程
 *
 * ```
 * 三角汤 → weldAndAnalyzeTopology() → 建流形 → 6 个轴向各打一条射线挑面
 *        → 布尔相减 → 收尾检查 → 出料
 * ```
 *
 * ## 踩过的坑(别再踩一遍)
 *
 * 1. **`setup()` 必须调** —— `ManifoldToplevel.setup()` 不调的话,整个 JS API
 *    层(`Mesh` / `triangulate` / `ofMesh`)**都不存在**,`Manifold` 类在但
 *    构造不出来。症状是 `TypeError: Mesh is not a constructor`。
 * 2. **射线要从 `+dir` 那一侧射进去** —— `origin = center + dir * 2 * maxDim`。
 *    写成 `center - dir * …` 的话,第一个命中的是**背面**,法线也就反了。
 *    manifold 的 `rayCast` 法线是**朝外**的,跟射线方向一致。
 * 3. **厚度那条射线从命中点出发** ⇒ `hits[0]` **就是**对面那个面(不是 `hits[1]`)。
 * 4. **净空那条射线要从实体**内部**出发** —— 起点沉进去一点点(1e-3mm),
 *    沿面内方向打,第一个命中就是「从这个点出发能走多远才出实体」。
 *    从面上出发的话,射线沿着面跑,命中的全是同一张面,量不出边缘。
 * 5. **整体法线朝内的模型 manifold 不抛错**,只是体积为**负** ⇒ 得自己按
 *    有符号体积判并**翻三角形绕序**,再喂给它。喂反了的话 `subtract` 会
 *    变成「求并集」—— 切了个寂寞还不报错。
 * 6. **manifold 只吃 indexed 网格** —— 展开的三角汤直接喂会抛 `NotManifold`
 *    (索引越界)。仓库 `weldAndAnalyzeTopology()` 的输出正好就是 indexed 的。
 * 7. **退化面(零面积)manifold 收不了** —— 仓库的焊接输出里**带着**退化面
 *    (只是打了标记),喂进去之前要剔掉。
 */

import type {
  Box,
  Manifold,
  ManifoldToplevel,
  Mat4,
  Mesh,
  Vec3,
} from "manifold-3d";
import { FACE_FLAG } from "@/features/tools/lib/mesh/types";
import { weldAndAnalyzeTopology } from "@/features/tools/lib/mesh/weld";
import type {
  MagnetAnalyzeOutcome,
  MagnetCutOutcome,
  MagnetErrorCode,
  MagnetFaceReport,
  MagnetWorkerIn,
  MagnetWorkerOut,
} from "./magnet-cutter-protocol";
import {
  alignZTo,
  computeCutterPlacement,
  expectedRemovedVolumeMm3,
  judgeFaceVerdict,
  MAGNET_FACE_DIRECTIONS,
  MAGNET_FACE_IDS,
  MAGNET_HOLE_DEPTH_MM,
  MAGNET_REMOVED_VOLUME_TOLERANCE,
  type MagnetFaceId,
  type MagnetVec3,
} from "./magnet-params";

/**
 * wasm 在 `public/` 下的地址
 *
 * `scripts/copy-manifold-wasm.ts` 拷过去的(产物提交进仓库,新克隆的机器
 * 不用先跑脚本)。
 */
export const MAGNET_WASM_URL = "/manifold.wasm";

/** 带稳定 code 的错 —— 界面按 code 查文案表 */
export class MagnetCutterError extends Error {
  readonly code: MagnetErrorCode;

  constructor(code: MagnetErrorCode, message: string) {
    super(message);
    this.name = "MagnetCutterError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 运行时加载
// ---------------------------------------------------------------------------

let runtimePromise: Promise<ManifoldToplevel> | null = null;

/**
 * 加载 Manifold 运行时(只加载一次)
 *
 * ## Node 与浏览器的差别
 *
 * - **浏览器 / Worker**:`locateFile` 指到 `/manifold.wasm`(放在 `public/` 下)
 * - **Node**(单测):不传 `locateFile` —— Emscripten 的胶水在 Node 下走
 *   `node:fs`,直接从 `node_modules/manifold-3d/manifold.wasm` 读盘
 *
 * 判据用 `process.versions.node` —— 浏览器 bundle 里 `process` 只是个
 * 带 `env` 的壳,没有 `versions.node`。
 */
export function loadManifoldRuntime(): Promise<ManifoldToplevel> {
  if (!runtimePromise) {
    runtimePromise = createRuntime().catch((err) => {
      // 失败不要缓存 —— 万一是网络抖动,下一次还能重试
      runtimePromise = null;
      throw err;
    });
  }
  return runtimePromise;
}

async function createRuntime(): Promise<ManifoldToplevel> {
  const mod = await import("manifold-3d");
  const isNode =
    typeof process !== "undefined" &&
    typeof process.versions?.node === "string";
  const runtime = await mod.default(
    isNode ? undefined : { locateFile: () => MAGNET_WASM_URL }
  );
  // ★ 必须调 —— 不调的话整个 JS API 层(`Mesh` / `triangulate`)都不存在
  runtime.setup();
  return runtime;
}

// ---------------------------------------------------------------------------
// 准备模型
// ---------------------------------------------------------------------------

type PreparedModel = {
  runtime: ManifoldToplevel;
  model: Manifold;
  /** 有符号体积(切之前) */
  volume: number;
  bbox: Box;
  center: Vec3;
  /** 包围盒最长边 —— 射线起点要用它 */
  maxDim: number;
};

/**
 * 指纹 —— 判断「还是同一个模型吗」(省掉第二次焊接)
 *
 * **必须把每个顶点的位模式都算进去。**
 *
 * 早先的版本是「隔 97 个采样一个」—— 结果 40mm 立方体和 40×40×1 的薄板
 * **撞了同一个键**(长度一样,被采样的那几个坐标也恰好一样:−20),于是
 * 薄板拿到了立方体的模型,厚度量出来是 40mm 而不是 1mm。
 *
 * 这种错**不报错**,只是算出来的数是别的模型的 —— 只能靠把整个数组哈希
 * 才能保证不撞。Float32Array 和 Uint32Array 可以共享同一块 buffer,
 * 直接读位模式就行,不用复制。
 */
function fingerprint(positions: Float32Array): string {
  const bits = new Uint32Array(
    positions.buffer,
    positions.byteOffset,
    positions.length
  );
  let h = 0x811c9dc5;
  for (let i = 0; i < bits.length; i++) {
    h ^= bits[i]!;
    h = Math.imul(h, 16777619);
  }
  return `${positions.length}:${(h >>> 0).toString(16)}`;
}

let cache: { key: string; prepared: PreparedModel } | null = null;

/**
 * 三角汤 → 一个可以参与布尔的流形实体
 *
 * 四道闸(工作室的模型是 AI 生成的(Meshy),非流形是常态 —— 这四道**不是**
 * 可选项):
 *
 * 1. 不是封闭流形(有开放边 / 非流形边)⇒ 拒绝
 * 2. 有局部翻转的面 ⇒ 拒绝(manifold 不看绕向,喂进去就是烂件)
 * 3. 法线朝内的壳 ⇒ **自己翻过来**(manifold 不抛错,只是算错)
 * 4. manifold 自己抛错 ⇒ 拒绝
 */
async function prepareModel(positions: Float32Array): Promise<PreparedModel> {
  const runtime = await loadManifoldRuntime();
  const key = fingerprint(positions);
  if (cache && cache.key === key) return cache.prepared;

  const topo = weldAndAnalyzeTopology(positions);

  if (topo.mesh.faceCount === 0) {
    throw new MagnetCutterError(
      "EMPTY_MODEL",
      "这个模型里没有有效的面 —— 文件是空的,或者只有点没有面。"
    );
  }

  const openEdges = topo.components.reduce((s, c) => s + c.openEdges, 0);
  const nonManifoldEdges = topo.components.reduce(
    (s, c) => s + c.nonManifoldEdges,
    0
  );
  if (openEdges > 0 || nonManifoldEdges > 0) {
    throw new MagnetCutterError(
      "NOT_MANIFOLD",
      `这个模型不是封闭流形(有 ${openEdges} 条开放边 / ${nonManifoldEdges} 条非流形边)—— 布尔运算切不了。` +
        "先去「打印前工作台 → 检查」看看问题在哪儿。"
    );
  }

  // 局部翻转的面:manifold 不检查绕向一致性,喂进去就是烂件 —— 直接拒。
  // (仓库统计「局部翻转面」时**已经排除了整体朝内的壳**,所以这两个数不重叠。)
  if (topo.flippedFaceCount > 0) {
    throw new MagnetCutterError(
      "INVERTED_WINDING",
      `这个模型里有 ${topo.flippedFaceCount} 个面的法线是翻着的 —— 布尔算出来会烂。` +
        "先去「打印前工作台 → 检查」把法线修好。"
    );
  }

  const { vertProperties, triVerts } = buildManifoldMesh(topo);

  let model: Manifold;
  try {
    const mesh = new runtime.Mesh({
      numProp: 3,
      vertProperties,
      triVerts,
    });
    model = new runtime.Manifold(mesh);
  } catch (err) {
    throw new MagnetCutterError(
      "NOT_MANIFOLD",
      `布尔引擎拒绝了这个模型(${describeManifoldError(err)})—— ` +
        "先去「打印前工作台 → 检查」把网格修好。"
    );
  }

  if (model.isEmpty()) {
    throw new MagnetCutterError(
      "EMPTY_MODEL",
      "焊接之后这个模型是空的 —— 文件里没有能构成实体的面。"
    );
  }

  // 翻完之后体积必须是正的(材料在里、空气在外)
  const volume = model.volume();
  if (volume <= 0) {
    throw new MagnetCutterError(
      "INVERTED_WINDING",
      "这个模型的法线整体朝内 —— 布尔引擎算不出正确结果。" +
        "先去「打印前工作台 → 检查」把法线修好。"
    );
  }

  const bbox = model.boundingBox();
  const center: Vec3 = [
    (bbox.min[0] + bbox.max[0]) / 2,
    (bbox.min[1] + bbox.max[1]) / 2,
    (bbox.min[2] + bbox.max[2]) / 2,
  ];
  const maxDim = Math.max(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2]
  );

  const prepared: PreparedModel = {
    runtime,
    model,
    volume,
    bbox,
    center,
    maxDim,
  };
  cache = { key, prepared };
  return prepared;
}

/**
 * 仓库的焊接输出 → manifold 要的 indexed 网格
 *
 * 两件事:
 *
 * 1. **剔掉退化面**(零面积 / 顶点重合)—— 仓库的焊接输出**带着**它们
 *    (只是打了 `FACE_FLAG.DEGENERATE` 标记),manifold 收不了。
 * 2. **逐个连通分量翻绕序** —— 仓库标了哪些壳「整体朝内」
 *    (`components[i].globalInverted`)。manifold **不抛错**,只是把那个壳
 *    当成反向的实体 ⇒ 布尔结果会错。翻过来就好。
 *
 *    注意是**逐分量**翻,不是整个模型一起翻 —— 一个模型里可以有
 *    「外壳正常 + 内腔空腔」这种组合,整体翻会把好的那个也翻坏。
 */
function buildManifoldMesh(topo: ReturnType<typeof weldAndAnalyzeTopology>): {
  vertProperties: Float32Array;
  triVerts: Uint32Array;
} {
  const mesh = topo.mesh;
  const inverted = new Set<number>();
  topo.components.forEach((c, i) => {
    if (c.globalInverted) inverted.add(i);
  });

  const triVerts = new Uint32Array(mesh.faceCount * 3);
  let w = 0;
  for (let f = 0; f < mesh.faceCount; f++) {
    if ((topo.flags[f] ?? 0) & FACE_FLAG.DEGENERATE) continue;
    const a = mesh.faceVertex[f * 3]!;
    const b = mesh.faceVertex[f * 3 + 1]!;
    const c = mesh.faceVertex[f * 3 + 2]!;
    const comp = topo.faceComponent[f] ?? -1;
    if (comp >= 0 && inverted.has(comp)) {
      triVerts[w++] = a;
      triVerts[w++] = c;
      triVerts[w++] = b;
    } else {
      triVerts[w++] = a;
      triVerts[w++] = b;
      triVerts[w++] = c;
    }
  }

  return {
    vertProperties: mesh.vertices,
    triVerts: triVerts.subarray(0, w),
  };
}

/** manifold 抛的错 → 人话 */
function describeManifoldError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: unknown }).code);
    if (code === "NotManifold") return "网格不是封闭流形";
    return code;
  }
  if (err instanceof Error) return err.message;
  return "未知错误";
}

// ---------------------------------------------------------------------------
// 挑面
// ---------------------------------------------------------------------------

/** 面内基向量(垂直于法线的两个正交单位向量) */
function inPlaneBasis(normal: Vec3): { u: Vec3; v: Vec3 } {
  const n = normalize(normal);
  const seed: Vec3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(seed, n));
  const v = cross(n, u);
  return { u, v };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(len) || len <= 0) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * 量「从这个点出发,沿面内方向能走多远才出实体」
 *
 * **射线起点要沉进实体内部一点点**(1e-3mm)。从面上出发的话,射线沿着面跑,
 * 命中的全是同一张面,量不出边缘(会得到 Infinity)。
 */
function measureClearance(
  model: Manifold,
  point: Vec3,
  normal: Vec3,
  maxDim: number
): number | null {
  const { u, v } = inPlaneBasis(normal);
  const eps = 1e-3;
  const start: Vec3 = [
    point[0] - normal[0] * eps,
    point[1] - normal[1] * eps,
    point[2] - normal[2] * eps,
  ];
  let min = Infinity;
  // 16 个方向 —— 最差情况(方向正好落在两条边中间)误差 1/cos(11.25°) ≈ 1.02
  for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * Math.PI * 2;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const dir: Vec3 = [
      u[0] * c + v[0] * s,
      u[1] * c + v[1] * s,
      u[2] * c + v[2] * s,
    ];
    const end: Vec3 = [
      start[0] + dir[0] * maxDim * 2,
      start[1] + dir[1] * maxDim * 2,
      start[2] + dir[2] * maxDim * 2,
    ];
    const hits = model.rayCast(start, end);
    if (!hits.length) continue;
    const d = dist(hits[0]!.position, start);
    if (d < min) min = d;
  }
  return Number.isFinite(min) ? min : null;
}

/** 量命中点的局部厚度(沿朝内方向量到下一个面) */
function measureThickness(
  model: Manifold,
  point: Vec3,
  normal: Vec3,
  maxDim: number
): number | null {
  const inward: Vec3 = [-normal[0], -normal[1], -normal[2]];
  const end: Vec3 = [
    point[0] + inward[0] * maxDim * 2,
    point[1] + inward[1] * maxDim * 2,
    point[2] + inward[2] * maxDim * 2,
  ];
  const hits = model.rayCast(point, end);
  // 从**面上**出发 ⇒ hits[0] 就是对面那个面(不是 hits[1])
  for (const hit of hits) {
    const d = dist(hit.position, point);
    if (d > 1e-4) return d;
  }
  return null;
}

/**
 * 六个面各打一条轴向射线,量出平整度 / 厚度 / 净空
 *
 * **射线要从 `+dir` 那一侧射进去** —— `origin = center + dir * 2 * maxDim`。
 * 第一个命中就是外表面,它的法线是**朝外**的(跟 `dir` 同向 ⇒ 平整度 0°)。
 */
export function pickFaces(prepared: PreparedModel): MagnetFaceReport[] {
  const { model, center, maxDim } = prepared;
  const reports: MagnetFaceReport[] = [];

  for (const faceId of MAGNET_FACE_IDS) {
    const dir = MAGNET_FACE_DIRECTIONS[faceId] as Vec3;
    const origin: Vec3 = [
      center[0] + dir[0] * maxDim * 2,
      center[1] + dir[1] * maxDim * 2,
      center[2] + dir[2] * maxDim * 2,
    ];
    const endpoint: Vec3 = [
      center[0] - dir[0] * maxDim * 2,
      center[1] - dir[1] * maxDim * 2,
      center[2] - dir[2] * maxDim * 2,
    ];
    const hits = model.rayCast(origin, endpoint);
    if (!hits.length) {
      reports.push({
        faceId,
        direction: [dir[0], dir[1], dir[2]],
        hit: false,
        flatnessDeg: 180,
        point: [0, 0, 0],
        normal: [dir[0], dir[1], dir[2]],
        thicknessMm: null,
        clearanceMm: null,
        verdict: "no_hit",
      });
      continue;
    }
    const h = hits[0]!;
    const normal = h.normal;
    const cosine = Math.min(
      1,
      Math.max(-1, normal[0] * dir[0] + normal[1] * dir[1] + normal[2] * dir[2])
    );
    const flatnessDeg = (Math.acos(cosine) * 180) / Math.PI;
    const thicknessMm = measureThickness(model, h.position, normal, maxDim);
    const clearanceMm = measureClearance(model, h.position, normal, maxDim);

    reports.push({
      faceId,
      direction: [dir[0], dir[1], dir[2]],
      hit: true,
      flatnessDeg,
      point: [h.position[0], h.position[1], h.position[2]],
      normal: [normal[0], normal[1], normal[2]],
      thicknessMm,
      clearanceMm,
      verdict: judgeFaceVerdict({ thicknessMm, clearanceMm }),
    });
  }

  return reports;
}

// ---------------------------------------------------------------------------
// 对外两个动作
// ---------------------------------------------------------------------------

/** 分析:挑面 + 报体积 */
export async function analyzeModel(
  positions: Float32Array
): Promise<MagnetAnalyzeOutcome> {
  const prepared = await prepareModel(positions);
  return {
    faces: pickFaces(prepared),
    volume: prepared.volume,
    bboxMin: [prepared.bbox.min[0], prepared.bbox.min[1], prepared.bbox.min[2]],
    bboxMax: [prepared.bbox.max[0], prepared.bbox.max[1], prepared.bbox.max[2]],
  };
}

/**
 * 切一个磁吸孔
 *
 * 收尾检查(照搬 Blender 脚本的 sanity check,阈值按 manifold 的实际行为调):
 *
 * | 检查 | 动作 |
 * |---|---|
 * | `status() !== "NoError"` | 拒绝 |
 * | `isEmpty()` | 拒绝(切没了) |
 * | `numTri() < 原 × 0.5` | 拒绝 —— 面数锐减 |
 * | `numTri() === 原` | 拒绝 —— 没切进去 |
 * | `volume() >= 原` | 拒绝 —— 体积没减少 |
 * | 去掉量 < 理论值 × 98% | 拒绝 —— 孔切到边上去了 |
 */
export async function cutMagnetPocket(
  positions: Float32Array,
  faceId: MagnetFaceId
): Promise<MagnetCutOutcome> {
  const prepared = await prepareModel(positions);
  const { runtime, model } = prepared;

  const faces = pickFaces(prepared);
  const face = faces.find((f) => f.faceId === faceId);
  if (!face || !face.hit) {
    throw new MagnetCutterError(
      "FACE_NOT_CUTTABLE",
      "选的那个面在这个方向上没有 —— 换一个面试试。"
    );
  }
  if (face.verdict === "too_thin") {
    throw new MagnetCutterError(
      "FACE_NOT_CUTTABLE",
      `这个面只有 ${face.thicknessMm?.toFixed(2)}mm 厚 —— 切 ${MAGNET_HOLE_DEPTH_MM}mm 会捅穿。` +
        "换一个厚一点的面,或者先把模型加厚。"
    );
  }
  if (face.verdict === "edge_spill") {
    throw new MagnetCutterError(
      "FACE_NOT_CUTTABLE",
      `孔心离这个面的边缘只有 ${face.clearanceMm?.toFixed(2)}mm —— ` +
        "孔的半径是 10.35mm,会切到边上。换一个面,或者把模型放大。"
    );
  }

  const placement = computeCutterPlacement(
    face.point as MagnetVec3,
    face.normal as MagnetVec3
  );

  /**
   * 切刀 = 一根 64 段的圆柱
   *
   * `cylinder` 是**静态方法**,返回的就是一个 `Manifold` —— **不加 `new`**。
   *
   * (加 `new` 在 JS 里也能跑通:构造函数的返回值是对象时,返回的就是那个对象。
   * 但那纯属巧合,而且 TypeScript 直接报错 —— 别留着。)
   *
   * 第 5 个参数 `center = true` = 圆柱**居中**(默认是底面在原点)——
   * 切刀中心是 `facePoint + inward × (d/2 − p)`,不是底面。
   */
  const cutter = runtime.Manifold.cylinder(
    placement.height,
    placement.radius,
    placement.radius,
    placement.segments,
    true
  )
    .transform(alignZTo(placement.axis) as unknown as Mat4)
    .translate(placement.center as Vec3);

  let result: Manifold;
  try {
    result = model.subtract(cutter);
  } catch (err) {
    throw new MagnetCutterError(
      "BOOLEAN_FAILED",
      `布尔运算失败了(${describeManifoldError(err)})。`
    );
  }

  const status = result.status();
  if (status !== "NoError") {
    throw new MagnetCutterError(
      "BOOLEAN_FAILED",
      `布尔运算没成功(引擎返回 ${status})。`
    );
  }
  if (result.isEmpty()) {
    throw new MagnetCutterError(
      "BOOLEAN_FAILED",
      "切完整个模型都没了 —— 这个面切不得。"
    );
  }

  const origTri = model.numTri();
  const newTri = result.numTri();
  if (newTri < origTri * 0.5) {
    throw new MagnetCutterError(
      "FACE_COUNT_COLLAPSED",
      `切完面数从 ${origTri} 掉到 ${newTri} —— 几何塌了,结果不能用。`
    );
  }
  if (newTri === origTri) {
    throw new MagnetCutterError(
      "NOTHING_CUT",
      "切完面数一点没变 —— 根本没切进去。"
    );
  }

  const volumeAfter = result.volume();
  if (volumeAfter >= prepared.volume) {
    throw new MagnetCutterError(
      "VOLUME_UNCHANGED",
      "切完体积没减少 —— 什么都没切掉。"
    );
  }

  const removedVolume = prepared.volume - volumeAfter;
  const expectedRemovedVolume = expectedRemovedVolumeMm3();
  if (
    removedVolume <
    expectedRemovedVolume * (1 - MAGNET_REMOVED_VOLUME_TOLERANCE)
  ) {
    throw new MagnetCutterError(
      "HOLE_SPILLED",
      `实际只去掉 ${removedVolume.toFixed(1)} mm³(理论 ${expectedRemovedVolume.toFixed(1)} mm³)` +
        " —— 孔有一截跑到实体外面了,换个面再切。"
    );
  }

  const mesh = result.getMesh();
  return {
    positions: meshToSoup(mesh),
    volumeBefore: prepared.volume,
    volumeAfter,
    removedVolume,
    expectedRemovedVolume,
    triangleCount: newTri,
  };
}

/** manifold 的 indexed 网格 → 三角汤(9 floats/tri) */
function meshToSoup(mesh: Mesh): Float32Array {
  const numProp = mesh.numProp;
  const soup = new Float32Array((mesh.triVerts.length / 3) * 9);
  for (let i = 0, t = 0; i < mesh.triVerts.length; i += 3, t++) {
    for (let k = 0; k < 3; k++) {
      const vi = mesh.triVerts[i + k]! * numProp;
      soup[t * 9 + k * 3] = mesh.vertProperties[vi]!;
      soup[t * 9 + k * 3 + 1] = mesh.vertProperties[vi + 1]!;
      soup[t * 9 + k * 3 + 2] = mesh.vertProperties[vi + 2]!;
    }
  }
  return soup;
}

// ---------------------------------------------------------------------------
// Worker 入口
// ---------------------------------------------------------------------------

/**
 * Worker 的消息处理(跟测试共用同一份)
 *
 * **错误一律回成带 code 的结构** —— 界面按 code 查文案表,不给用户看
 * 「请稍后重试」那种废话。
 */
export function handleMagnetWorkerMessage(
  msg: MagnetWorkerIn,
  post: (out: MagnetWorkerOut) => void
): void {
  void (async () => {
    try {
      if (msg.type === "analyze") {
        const result = await analyzeModel(msg.positions);
        post({ type: "analyze", seq: msg.seq, result });
        return;
      }
      const result = await cutMagnetPocket(msg.positions, msg.faceId);
      post({ type: "cut", seq: msg.seq, result });
    } catch (err) {
      post({
        type: "error",
        seq: msg.seq,
        code: err instanceof MagnetCutterError ? err.code : "BOOLEAN_FAILED",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}
