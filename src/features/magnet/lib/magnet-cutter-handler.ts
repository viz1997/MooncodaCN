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
 * 三角汤 → weldAndAnalyzeTopology() → 建流形 → 六个轴向各打一条射线挑面
 *        → 区域生长找出最大的平面区域(智能识别背面)
 *        → 布尔相减 → 收尾检查 → 出料
 * ```
 *
 * ## 工作室 2026-11-11 提的三条,这条文件都管
 *
 * 1. **磁吸沉孔需要可调** —— 孔径 / 沉孔深走参数(默认仍是实物磁铁的
 *    Ø20.7 / 1.3),但**不跟模型缩放**。
 * 2. **智能识别背面** —— 原脚本只在六个轴向里找,模型一歪就找不着了。
 *    这里改成**区域生长找最大平面区域**(`magnet-backface.ts`),跟模型朝向无关。
 * 3. **导出要保留原来的材质贴图** —— Manifold3D 支持**属性通道**
 *    (`numProp = 5` = xyz + uv),材质走 `reserveIDs()` + 逐三角形 run。
 *    实测:布尔之后 UV 与材质分组**都还在**(见 `magnet-cut.test.ts`)。
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
 * 8. **属性通道的 UV 要「每个角一份」** —— manifold 的属性是**逐顶点**的,
 *    而 UV 是**逐角**的(同一个位置在两个面上 UV 不一样)。所以带贴图时要
 *    把三角形**拆成逐角的属性顶点**,再用 `mergeFromVert` / `mergeToVert`
 *    把位置相同的角合并回去。少了这一步 manifold 直接抛 `NotManifold`。
 * 9. **`runIndex` 是「顶点单位」** —— 必须是 3 的倍数(它是 `triVerts` 的下标,
 *    不是三角形号)。写错了材质分组全乱。
 * 10. **材质要排成连续的 run** —— manifold 的文档原话:「sort the materials
 *    into triangle runs」。所以建网格时按材质把三角形**重排**一遍。
 */

import type {
  Box,
  Manifold,
  ManifoldToplevel,
  Mat4,
  Mesh,
  MeshOptions,
  Vec3,
} from "manifold-3d";
import { FACE_FLAG } from "@/features/tools/lib/mesh/types";
import { weldAndAnalyzeTopology } from "@/features/tools/lib/mesh/weld";
import {
  detectFlatPatches,
  type MagnetFlatPatch,
  type MagnetIndexedMesh,
} from "./magnet-backface";
import type {
  MagnetAnalyzeOutcome,
  MagnetCutOutcome,
  MagnetErrorCode,
  MagnetFaceReport,
  MagnetPatchReport,
  MagnetTextureInput,
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
  MAGNET_REMOVED_VOLUME_TOLERANCE,
  MAGNET_TARGET_AUTO,
  type MagnetFaceId,
  type MagnetHoleParams,
  type MagnetTargetId,
  type MagnetVec3,
  normalizeHoleParams,
  parsePatchTarget,
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
// 拓扑准备(焊接 + 绕序修正)
// ---------------------------------------------------------------------------

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

/** 焊接 + 校验之后的东西 —— 按位置指纹缓存 */
type Topology = {
  /** 仓库焊接出来的拓扑 */
  topo: ReturnType<typeof weldAndAnalyzeTopology>;
  /** 绕序修正后的 indexed 网格(法线朝外)—— 智能识别背面用它 */
  corrected: MagnetIndexedMesh;
  /** 要翻绕序的那些面(焊接后的面号) */
  flippedFaces: Set<number>;
};

let topologyCache: { key: string; topology: Topology } | null = null;

/**
 * 三角汤 → 焊接好的拓扑(带三道闸)
 *
 * 四道闸(工作室的模型是 AI 生成的(Meshy),非流形是常态 —— 这四道**不是**
 * 可选项):
 *
 * 1. 不是封闭流形(有开放边 / 非流形边)⇒ 拒绝
 * 2. 有局部翻转的面 ⇒ 拒绝(manifold 不看绕向,喂进去就是烂件)
 * 3. 法线朝内的壳 ⇒ **自己翻过来**(manifold 不抛错,只是算错)
 * 4. manifold 自己抛错 ⇒ 拒绝(在 `buildModel` 那一步)
 */
function prepareTopology(positions: Float32Array): Topology {
  const key = fingerprint(positions);
  if (topologyCache && topologyCache.key === key) return topologyCache.topology;

  let topo: ReturnType<typeof weldAndAnalyzeTopology>;
  try {
    topo = weldAndAnalyzeTopology(positions);
  } catch (err) {
    // 焊接在极端几何(退化面 / NaN 顶点)上会抛 —— 原始信息得留住
    throw engineError("网格焊接", err);
  }

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

  const { corrected, flippedFaces } = buildCorrectedMesh(topo);

  const topology: Topology = { topo, corrected, flippedFaces };
  topologyCache = { key, topology };
  return topology;
}

/**
 * 绕序修正后的 indexed 网格
 *
 * 逐个连通分量翻绕序 —— 仓库标了哪些壳「整体朝内」
 * (`components[i].globalInverted`)。manifold **不抛错**,只是把那个壳
 * 当成反向的实体 ⇒ 布尔结果会错。翻过来就好。
 *
 * 注意是**逐分量**翻,不是整个模型一起翻 —— 一个模型里可以有
 * 「外壳正常 + 内腔空腔」这种组合,整体翻会把好的那个也翻坏。
 *
 * 翻绕序的时候**UV 也要跟着换角**(见 `buildTexturedMeshInput`)。
 */
function buildCorrectedMesh(topo: ReturnType<typeof weldAndAnalyzeTopology>): {
  corrected: MagnetIndexedMesh;
  flippedFaces: Set<number>;
} {
  const mesh = topo.mesh;
  const inverted = new Set<number>();
  topo.components.forEach((c, i) => {
    if (c.globalInverted) inverted.add(i);
  });

  const faceVertex = new Uint32Array(mesh.faceVertex);
  const flippedFaces = new Set<number>();
  for (let f = 0; f < mesh.faceCount; f++) {
    const comp = topo.faceComponent[f] ?? -1;
    if (comp < 0 || !inverted.has(comp)) continue;
    const b = faceVertex[f * 3 + 1]!;
    const c = faceVertex[f * 3 + 2]!;
    faceVertex[f * 3 + 1] = c;
    faceVertex[f * 3 + 2] = b;
    flippedFaces.add(f);
  }

  return {
    corrected: { vertices: mesh.vertices, faceVertex },
    flippedFaces,
  };
}

// ---------------------------------------------------------------------------
// 建流形
// ---------------------------------------------------------------------------

/** manifold 的 `Mesh` 构造参数 */
type ManifoldMeshInput = {
  numProp: number;
  vertProperties: Float32Array;
  triVerts: Uint32Array;
  mergeFromVert?: Uint32Array;
  mergeToVert?: Uint32Array;
  runIndex?: Uint32Array;
  runOriginalID?: Uint32Array;
};

/**
 * 把我们的输入转成 manifold 的 `MeshOptions`
 *
 * **可选字段不能带 `undefined`** —— 仓库开了 `exactOptionalPropertyTypes`,
 * `mergeFromVert: undefined` 不许赋给 `mergeFromVert?: Uint32Array`。
 * 所以有值才写进去。
 */
function toMeshOptions(input: ManifoldMeshInput): MeshOptions {
  const options: MeshOptions = {
    numProp: input.numProp,
    vertProperties: input.vertProperties,
    triVerts: input.triVerts,
  };
  if (input.mergeFromVert && input.mergeToVert) {
    options.mergeFromVert = input.mergeFromVert;
    options.mergeToVert = input.mergeToVert;
  }
  if (input.runIndex && input.runOriginalID) {
    options.runIndex = input.runIndex;
    options.runOriginalID = input.runOriginalID;
  }
  return options;
}

/** 建好之后的模型 */
type BuiltModel = {
  runtime: ManifoldToplevel;
  model: Manifold;
  /** 有符号体积(切之前) */
  volume: number;
  bbox: Box;
  center: Vec3;
  /** 包围盒最长边 —— 射线起点要用它 */
  maxDim: number;
  topology: Topology;
  /**
   * 我们自己预留的材质 id → 材质下标
   *
   * 布尔之后靠这个把输出三角形的 run id 对回原模型的材质。空数组 = 没贴图。
   */
  materialIds: number[];
};

/**
 * 建一个可以参与布尔的流形实体
 *
 * 有贴图时走「逐角属性顶点」那条路(保住 UV),没贴图时走原来那条
 * (numProp = 3,直接用焊接出来的顶点)。
 */
async function buildModel(
  positions: Float32Array,
  texture?: MagnetTextureInput | null
): Promise<BuiltModel> {
  const runtime = await loadManifoldRuntime();
  const topology = prepareTopology(positions);

  let input: ManifoldMeshInput;
  let materialIds: number[];
  if (texture) {
    try {
      const built = buildTexturedMeshInput(runtime, topology, texture);
      input = built.input;
      materialIds = built.materialIds;
    } catch (err) {
      // `buildTexturedMeshInput` 自己抛的 `MagnetCutterError` 原样放行
      if (err instanceof MagnetCutterError) throw err;
      // `reserveIDs()` 之类的调用炸了 —— 说清楚是哪一步
      throw engineError("带贴图的网格构建", err);
    }
  } else {
    input = buildPlainMeshInput(topology);
    materialIds = [];
  }

  let model: Manifold;
  try {
    model = new runtime.Manifold(new runtime.Mesh(toMeshOptions(input)));
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

  return {
    runtime,
    model,
    volume,
    bbox,
    center,
    maxDim,
    topology,
    materialIds,
  };
}

/**
 * 不带贴图时的网格 —— 直接用焊接出来的顶点(`numProp = 3`)
 *
 * 两件事:
 *
 * 1. **剔掉退化面**(零面积 / 顶点重合)—— 仓库的焊接输出**带着**它们
 *    (只是打了 `FACE_FLAG.DEGENERATE` 标记),manifold 收不了。
 * 2. **逐个连通分量翻绕序**(见 `buildCorrectedMesh`)。
 */
function buildPlainMeshInput(topology: Topology): ManifoldMeshInput {
  const { topo, flippedFaces } = topology;
  const mesh = topo.mesh;

  const triVerts = new Uint32Array(mesh.faceCount * 3);
  let w = 0;
  for (let f = 0; f < mesh.faceCount; f++) {
    if ((topo.flags[f] ?? 0) & FACE_FLAG.DEGENERATE) continue;
    const a = mesh.faceVertex[f * 3]!;
    const b = mesh.faceVertex[f * 3 + 1]!;
    const c = mesh.faceVertex[f * 3 + 2]!;
    if (flippedFaces.has(f)) {
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
    numProp: 3,
    vertProperties: mesh.vertices,
    triVerts: triVerts.subarray(0, w),
  };
}

/**
 * 带贴图时的网格 —— **保住 UV 和材质分组**
 *
 * ## 为什么不能直接用焊接出来的顶点
 *
 * manifold 的属性是**逐顶点**的,而 UV 是**逐角**的 —— 同一个位置在两个面
 * 上的 UV 可以不一样(UV 展开就是这样的)。共用顶点 ⇒ 只能保一个 UV ⇒
 * 贴图会花。
 *
 * ## 这里的做法
 *
 * 1. **每个角一份属性顶点**(`numProp = 5` = x,y,z,u,v)
 * 2. **位置相同的角用 merge 向量合并回去** —— `mergeFromVert` 指向
 *    「要合并的角」,`mergeToVert` 指向「位置完全相同的那个角」。manifold
 *    只合并位置,属性各留各的 ⇒ UV 保住了,网格还是流形。
 * 3. **按材质把三角形重排成连续的 run** —— manifold 的文档原话:
 *    「sort the materials into triangle runs」。
 * 4. **`runIndex` 用「顶点单位」** —— 它是 `triVerts` 的下标,必须是 3 的倍数。
 *
 * 实测(40mm 立方体,两个材质):布尔之后 140 个三角形,材质分布
 * `材质0: 40 / 材质1: 6 / 切刀新生成的: 94`,UV 全部对得上原面。
 */
function buildTexturedMeshInput(
  runtime: ManifoldToplevel,
  topology: Topology,
  texture: MagnetTextureInput
): { input: ManifoldMeshInput; materialIds: number[] } {
  const { topo, flippedFaces } = topology;
  const mesh = topo.mesh;
  const uvs = texture.uvs ?? null;
  const materialIndex = texture.materialIndex ?? null;
  const materialCount = Math.max(1, texture.materialNames?.length ?? 1);

  // --- ① 有效面(剔掉退化面)+ 每个面的材质 ---
  const facesByMaterial = new Map<number, number[]>();
  for (let f = 0; f < mesh.faceCount; f++) {
    if ((topo.flags[f] ?? 0) & FACE_FLAG.DEGENERATE) continue;
    const raw = materialIndex?.[f];
    const mat =
      raw === undefined || !Number.isFinite(raw)
        ? 0
        : Math.min(materialCount - 1, Math.max(0, raw));
    const list = facesByMaterial.get(mat);
    if (list) list.push(f);
    else facesByMaterial.set(mat, [f]);
  }
  const materials = [...facesByMaterial.keys()].sort((a, b) => a - b);
  if (materials.length === 0) {
    throw new MagnetCutterError(
      "EMPTY_MODEL",
      "这个模型里没有能参与布尔运算的面。"
    );
  }

  // --- ② 给每个材质预留一个 id(布尔之后靠它对回材质)---
  const idBase = runtime.Manifold.reserveIDs(materials.length);
  const materialIds: number[] = [];
  materials.forEach((mat, i) => {
    materialIds[mat] = idBase + i;
  });

  // --- ③ 按材质排成连续的三角形 ---
  const orderedFaces: number[] = [];
  for (const mat of materials) orderedFaces.push(...facesByMaterial.get(mat)!);

  // --- ④ 逐角建属性顶点 ---
  const numProp = 5;
  const nCorners = orderedFaces.length * 3;
  const vertProperties = new Float32Array(nCorners * numProp);
  const triVerts = new Uint32Array(nCorners);
  const mergeFrom: number[] = [];
  const mergeTo: number[] = [];
  /** 焊接顶点号 → 第一个用它的角(规范角) */
  const canonical = new Map<number, number>();

  orderedFaces.forEach((f, t) => {
    // 绕序翻了的话,新三角形是 (0, 2, 1) —— UV 也要跟着换角
    const flipped = flippedFaces.has(f);
    const cornerOrder = flipped ? [0, 2, 1] : [0, 1, 2];
    for (let k = 0; k < 3; k++) {
      const ci = t * 3 + k;
      const oi = cornerOrder[k]!;
      const weldedVert = mesh.faceVertex[f * 3 + oi]!;
      vertProperties[ci * numProp] = mesh.vertices[weldedVert * 3]!;
      vertProperties[ci * numProp + 1] = mesh.vertices[weldedVert * 3 + 1]!;
      vertProperties[ci * numProp + 2] = mesh.vertices[weldedVert * 3 + 2]!;
      if (uvs) {
        vertProperties[ci * numProp + 3] = uvs[f * 6 + oi * 2] ?? 0;
        vertProperties[ci * numProp + 4] = uvs[f * 6 + oi * 2 + 1] ?? 0;
      }
      triVerts[ci] = ci;

      const canon = canonical.get(weldedVert);
      if (canon === undefined) canonical.set(weldedVert, ci);
      else {
        mergeFrom.push(ci);
        mergeTo.push(canon);
      }
    }
  });

  // --- ⑤ 材质 run ---
  const runIndex: number[] = [];
  const runOriginalID: number[] = [];
  let cursor = 0;
  for (const mat of materials) {
    runIndex.push(cursor * 3);
    runOriginalID.push(materialIds[mat]!);
    cursor += facesByMaterial.get(mat)!.length;
  }
  runIndex.push(cursor * 3);

  return {
    input: {
      numProp,
      vertProperties,
      triVerts,
      mergeFromVert: new Uint32Array(mergeFrom),
      mergeToVert: new Uint32Array(mergeTo),
      runIndex: new Uint32Array(runIndex),
      runOriginalID: new Uint32Array(runOriginalID),
    },
    materialIds,
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

/**
 * 引擎那一步抛了个预料之外的错 → `ENGINE_FAILED`
 *
 * **带上原始信息** —— 工作室要能一眼看出是哪一步炸的(「建网格失败」/
 * 「切刀摆放失败」/「取结果失败」),而不是一句「出了个预料之外的错」。
 *
 * 以前这些错一路冒到最外层,全被归成 `UNEXPECTED`,原始信息全丢了 ——
 * 工作室看到的只有一句「切割过程出了意外(不是模型的问题)」。
 */
function engineError(what: string, err: unknown): MagnetCutterError {
  return new MagnetCutterError(
    "ENGINE_FAILED",
    `${what}失败:${describeManifoldError(err)}`
  );
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
 *
 * 判定阈值跟**当前的孔参数**走 —— 孔调大了,「太薄」「切到边上」跟着变。
 */
export function pickFaces(
  prepared: BuiltModel,
  hole?: Partial<MagnetHoleParams> | null
): MagnetFaceReport[] {
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
      verdict: judgeFaceVerdict({ thicknessMm, clearanceMm }, hole),
    });
  }

  return reports;
}

// ---------------------------------------------------------------------------
// 智能识别背面(区域生长)
// ---------------------------------------------------------------------------

/** 候选平面区域最多摆几个 —— 再多界面也看不过来 */
const MAX_PATCHES = 8;

/** 面积太小的区域直接丢掉(mm²)—— 孔根本放不下 */
const MIN_PATCH_AREA_MM2 = 1;

/**
 * 找出模型上所有「足够平」的面区域 —— **跟模型朝向无关**
 *
 * 这是工作室 2026-11-11 问的那个「智能识别背面」的答案。原脚本只在六个
 * 轴向里找(模型一歪就找不着了),这里是**区域生长**:从面积最大的面开始,
 * 把跟它差不多平的面收进来,凑成一块平面区域。
 *
 * 每块区域再打一条射线落到表面上,量出**那个点**的厚度与净空 ——
 * 判定「能不能切」跟六个面用的是同一套阈值。
 */
export function pickPatches(
  prepared: BuiltModel,
  hole?: Partial<MagnetHoleParams> | null
): MagnetPatchReport[] {
  const { model, maxDim, topology } = prepared;
  const flat = detectFlatPatches(topology.corrected, {
    minAreaMm2: MIN_PATCH_AREA_MM2,
  });
  const reports: MagnetPatchReport[] = [];

  for (const patch of flat.slice(0, MAX_PATCHES)) {
    const hit = castOntoSurface(model, patch, maxDim);
    const thicknessMm = hit
      ? measureThickness(model, hit.position, hit.normal, maxDim)
      : null;
    const clearanceMm = hit
      ? measureClearance(model, hit.position, hit.normal, maxDim)
      : null;
    reports.push({
      areaMm2: patch.areaMm2,
      faceCount: patch.faceCount,
      normal: [patch.normal[0], patch.normal[1], patch.normal[2]],
      centroid: [patch.centroid[0], patch.centroid[1], patch.centroid[2]],
      point: hit
        ? [hit.position[0], hit.position[1], hit.position[2]]
        : [patch.centroid[0], patch.centroid[1], patch.centroid[2]],
      meanDeviationDeg: patch.meanDeviationDeg,
      thicknessMm,
      clearanceMm,
      verdict: judgeFaceVerdict({ thicknessMm, clearanceMm }, hole),
    });
  }

  return reports;
}

/**
 * 从平面区域的质心往里打一条射线,找到真正落在表面上的那个点
 *
 * 质心只是「这块区域的中心」,不一定精确落在面上(浮雕的背面常常是
 * 一圈边框 + 中间凸起)。下刀点必须落在**表面上**。
 */
function castOntoSurface(
  model: Manifold,
  patch: MagnetFlatPatch,
  maxDim: number
): { position: Vec3; normal: Vec3 } | null {
  const n = patch.normal;
  const start: Vec3 = [
    patch.centroid[0] + n[0] * 1e-3,
    patch.centroid[1] + n[1] * 1e-3,
    patch.centroid[2] + n[2] * 1e-3,
  ];
  const end: Vec3 = [
    patch.centroid[0] - n[0] * maxDim * 2,
    patch.centroid[1] - n[1] * maxDim * 2,
    patch.centroid[2] - n[2] * maxDim * 2,
  ];
  const hits = model.rayCast(start, end);
  if (!hits.length) return null;
  const h = hits[0]!;
  return { position: h.position, normal: h.normal };
}

// ---------------------------------------------------------------------------
// 对外两个动作
// ---------------------------------------------------------------------------

/** 分析:挑面 + 智能识别背面 + 报体积 */
export async function analyzeModel(
  positions: Float32Array,
  hole?: Partial<MagnetHoleParams> | null
): Promise<MagnetAnalyzeOutcome> {
  const prepared = await buildModel(positions);
  const patches = pickPatches(prepared, hole);
  return {
    faces: pickFaces(prepared, hole),
    backFace: patches[0] ?? null,
    patches,
    volume: prepared.volume,
    bboxMin: [prepared.bbox.min[0], prepared.bbox.min[1], prepared.bbox.min[2]],
    bboxMax: [prepared.bbox.max[0], prepared.bbox.max[1], prepared.bbox.max[2]],
  };
}

/** 切割目标 → 实际下刀的地方 */
type CutSite = {
  /** 下刀点(在表面上) */
  point: MagnetVec3;
  /** 命中面的朝外单位法线 */
  normal: MagnetVec3;
  /** 能不能切 */
  verdict: MagnetFaceReport["verdict"];
  /** 厚度(mm) */
  thicknessMm: number | null;
  /** 净空(mm) */
  clearanceMm: number | null;
};

/**
 * 把「切哪个」解析成具体下刀点
 *
 * - `posZ` 那一批 = 六个轴向面
 * - `"auto"` = 智能识别出来的那块最大平面
 * - `"patch:3"` = 第 3 块候选平面
 */
function resolveTarget(
  prepared: BuiltModel,
  target: MagnetTargetId,
  hole?: Partial<MagnetHoleParams> | null
): CutSite {
  const patchIndex = parsePatchTarget(target);

  if (patchIndex !== null) {
    const patches = pickPatches(prepared, hole);
    const patch = patches[patchIndex];
    if (!patch) {
      throw new MagnetCutterError(
        "FACE_NOT_CUTTABLE",
        "选的那个平面区域已经不在了 —— 重新分析一次再切。"
      );
    }
    return {
      point: patch.point as MagnetVec3,
      normal: patch.normal as MagnetVec3,
      verdict: patch.verdict,
      thicknessMm: patch.thicknessMm,
      clearanceMm: patch.clearanceMm,
    };
  }

  if (target === MAGNET_TARGET_AUTO) {
    const patches = pickPatches(prepared, hole);
    const back = patches[0];
    if (!back) {
      throw new MagnetCutterError(
        "FACE_NOT_CUTTABLE",
        "这个模型上找不出一块像样的平面 —— 换一个模型试试。"
      );
    }
    return {
      point: back.point as MagnetVec3,
      normal: back.normal as MagnetVec3,
      verdict: back.verdict,
      thicknessMm: back.thicknessMm,
      clearanceMm: back.clearanceMm,
    };
  }

  const faces = pickFaces(prepared, hole);
  const face = faces.find((f) => f.faceId === (target as MagnetFaceId));
  if (!face || !face.hit) {
    throw new MagnetCutterError(
      "FACE_NOT_CUTTABLE",
      "选的那个面在这个方向上没有 —— 换一个面试试。"
    );
  }
  return {
    point: face.point as MagnetVec3,
    normal: face.normal as MagnetVec3,
    verdict: face.verdict,
    thicknessMm: face.thicknessMm,
    clearanceMm: face.clearanceMm,
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
  target: MagnetTargetId = MAGNET_TARGET_AUTO,
  hole?: Partial<MagnetHoleParams> | null,
  texture?: MagnetTextureInput | null
): Promise<MagnetCutOutcome> {
  const params = normalizeHoleParams(hole);
  const prepared = await buildModel(positions, texture);
  const { runtime, model } = prepared;

  const site = resolveTarget(prepared, target, params);

  if (site.verdict === "too_thin") {
    throw new MagnetCutterError(
      "FACE_NOT_CUTTABLE",
      `这个面只有 ${site.thicknessMm?.toFixed(2)}mm 厚 —— 切 ${params.holeDepthMm}mm 会捅穿。` +
        "换一个厚一点的面,或者先把模型加厚。"
    );
  }
  if (site.verdict === "edge_spill") {
    throw new MagnetCutterError(
      "FACE_NOT_CUTTABLE",
      `孔心离这个面的边缘只有 ${site.clearanceMm?.toFixed(2)}mm —— ` +
        `孔的半径是 ${(params.holeDiaMm / 2).toFixed(2)}mm,会切到边上。` +
        "换一个面,或者把模型放大。"
    );
  }

  const placement = computeCutterPlacement(site.point, site.normal, params);

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
  let cutter: Manifold;
  try {
    cutter = runtime.Manifold.cylinder(
      placement.height,
      placement.radius,
      placement.radius,
      placement.segments,
      true
    )
      .transform(alignZTo(placement.axis) as unknown as Mat4)
      .translate(placement.center as Vec3);
  } catch (err) {
    // 切刀造不出来(参数非法 / 引擎抽风)—— 说清楚是哪一步
    throw engineError("切刀摆放", err);
  }

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
  const expectedRemovedVolume = expectedRemovedVolumeMm3(
    params.holeDepthMm,
    params.holeDiaMm / 2
  );
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

  let mesh: Mesh;
  try {
    mesh = result.getMesh();
  } catch (err) {
    throw engineError("取切完的结果", err);
  }
  // 孔壁是新生成的三角形 —— 它们属于「被切的那个面」的材质
  const fallbackMaterial = findMaterialAtPoint(
    prepared.topology.corrected,
    site.point,
    texture?.materialIndex ?? null,
    0
  );

  let output: ReturnType<typeof extractOutput>;
  try {
    output = extractOutput(mesh, prepared.materialIds, fallbackMaterial);
  } catch (err) {
    throw engineError("读取切完的三角形", err);
  }

  return {
    ...output,
    volumeBefore: prepared.volume,
    volumeAfter,
    removedVolume,
    expectedRemovedVolume,
    triangleCount: newTri,
    materialNames: texture?.materialNames ?? null,
  };
}

/** manifold 的 indexed 网格 → 三角汤(+ UV / 材质) */
function extractOutput(
  mesh: Mesh,
  materialIds: number[],
  fallbackMaterial: number
): {
  positions: Float32Array;
  uvs: Float32Array | null;
  materialIndex: Uint16Array | null;
} {
  const numProp = mesh.numProp;
  const triCount = mesh.triVerts.length / 3;
  const positions = new Float32Array(triCount * 9);
  const hasProps = numProp >= 5;
  const uvs = hasProps ? new Float32Array(triCount * 6) : null;

  for (let i = 0, t = 0; i < mesh.triVerts.length; i += 3, t++) {
    for (let k = 0; k < 3; k++) {
      const vi = mesh.triVerts[i + k]! * numProp;
      positions[t * 9 + k * 3] = mesh.vertProperties[vi]!;
      positions[t * 9 + k * 3 + 1] = mesh.vertProperties[vi + 1]!;
      positions[t * 9 + k * 3 + 2] = mesh.vertProperties[vi + 2]!;
      if (uvs) {
        uvs[t * 6 + k * 2] = mesh.vertProperties[vi + 3]!;
        uvs[t * 6 + k * 2 + 1] = mesh.vertProperties[vi + 4]!;
      }
    }
  }

  return {
    positions,
    uvs,
    materialIndex: extractMaterialIndex(mesh, materialIds, fallbackMaterial),
  };
}

/**
 * 输出网格的三角形 → 材质下标
 *
 * manifold 在输出里把三角形按「来源」分成若干 **run**,每个 run 带一个
 * `runOriginalID` —— 那就是我们建网格时预留的材质 id。
 *
 * **认不出来的 id = 布尔新生成的三角形**(孔壁、孔底)⇒ 用被切那个面的材质。
 */
function extractMaterialIndex(
  mesh: Mesh,
  materialIds: number[],
  fallbackMaterial: number
): Uint16Array | null {
  if (materialIds.length === 0) return null;
  // ⚠️ 键是**预留的 id**,值才是材质下标
  //
  // `materialIds[材质下标] = 预留id`,而 `runOriginalID` 里装的是**预留id**。
  // 早先写成 `set(数组下标, 预留id)` —— 查表用预留id,永远查不到 ⇒ 全部
  // 掉进 fallback,材质分组整个丢光。
  //
  // (`forEach` 会跳过稀疏数组的空位 —— 那是对的:没被用到的材质下标本来
  //  就不该出现在表里。)
  const idToMaterial = new Map<number, number>();
  materialIds.forEach((reservedId, materialIndex) => {
    if (reservedId !== undefined) idToMaterial.set(reservedId, materialIndex);
  });

  const triCount = mesh.triVerts.length / 3;
  const out = new Uint16Array(triCount);
  const runIndex = mesh.runIndex;
  const runOriginalID = mesh.runOriginalID;

  for (let r = 0; r < runOriginalID.length; r++) {
    const id = runOriginalID[r]!;
    const material = idToMaterial.get(id) ?? fallbackMaterial;
    const from = (runIndex[r] ?? 0) / 3;
    const to = (runIndex[r + 1] ?? mesh.triVerts.length) / 3;
    for (let t = from; t < to && t < triCount; t++) out[t] = material;
  }

  return out;
}

/**
 * 找出「这个点在哪个三角形上」→ 那个三角形的材质
 *
 * 孔壁是新生成的三角形,得给它一个材质 —— 最合理的是**被切的那个面**的材质。
 * manifold 的 `rayCast` 回的 `faceID` **不是**输入的三角形号(实测),所以
 * 这里自己算:遍历三角形,找包含这个点的那个。
 */
function findMaterialAtPoint(
  mesh: MagnetIndexedMesh,
  point: MagnetVec3,
  materialIndex: Uint16Array | null,
  fallback: number
): number {
  if (!materialIndex) return fallback;
  const { vertices, faceVertex } = mesh;
  const faceCount = faceVertex.length / 3;
  const tol = 1e-4; // mm —— 命中点在面上的容差

  for (let f = 0; f < faceCount; f++) {
    const a = faceVertex[f * 3]!;
    const b = faceVertex[f * 3 + 1]!;
    const c = faceVertex[f * 3 + 2]!;
    const p0: MagnetVec3 = [
      vertices[a * 3]!,
      vertices[a * 3 + 1]!,
      vertices[a * 3 + 2]!,
    ];
    const p1: MagnetVec3 = [
      vertices[b * 3]!,
      vertices[b * 3 + 1]!,
      vertices[b * 3 + 2]!,
    ];
    const p2: MagnetVec3 = [
      vertices[c * 3]!,
      vertices[c * 3 + 1]!,
      vertices[c * 3 + 2]!,
    ];
    const e1: MagnetVec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2: MagnetVec3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const n = cross(e1, e2);
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-12) continue;
    const rel: MagnetVec3 = [
      point[0] - p0[0],
      point[1] - p0[1],
      point[2] - p0[2],
    ];
    // 点到平面的距离
    const dist = Math.abs(
      (rel[0] * n[0] + rel[1] * n[1] + rel[2] * n[2]) / len
    );
    if (dist > tol) continue;
    // 重心坐标
    const d00 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2];
    const d01 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2];
    const d11 = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2];
    const d20 = rel[0] * e1[0] + rel[1] * e1[1] + rel[2] * e1[2];
    const d21 = rel[0] * e2[0] + rel[1] * e2[1] + rel[2] * e2[2];
    const denom = d00 * d11 - d01 * d01;
    if (Math.abs(denom) < 1e-18) continue;
    const u = (d11 * d20 - d01 * d21) / denom;
    const w = (d00 * d21 - d01 * d20) / denom;
    if (u >= -1e-6 && w >= -1e-6 && u + w <= 1 + 1e-6) {
      const mat = materialIndex[f];
      return mat === undefined ? fallback : mat;
    }
  }

  return fallback;
}

// ---------------------------------------------------------------------------
// Worker 入口
// ---------------------------------------------------------------------------

/**
 * Worker 的消息处理(跟测试共用同一份)
 *
 * **错误一律回成带 code 的结构** —— 界面按 code 查文案表,不给用户看
 * 「请稍后重试」那种废话。
 *
 * **预料之外的错单独一个码**(`UNEXPECTED`)—— 以前一律报成
 * `BOOLEAN_FAILED`,用户看到的是「布尔运算在这个模型上失败了」,但真因
 * (Worker 崩了 / 超时了 / 某个 TypeError)全被吞了。
 */
export function handleMagnetWorkerMessage(
  msg: MagnetWorkerIn,
  post: (out: MagnetWorkerOut) => void
): void {
  void (async () => {
    try {
      if (msg.type === "analyze") {
        const result = await analyzeModel(msg.positions, msg.hole);
        post({ type: "analyze", seq: msg.seq, result });
        return;
      }
      const result = await cutMagnetPocket(
        msg.positions,
        msg.target,
        msg.hole,
        msg.texture
      );
      post({ type: "cut", seq: msg.seq, result });
    } catch (err) {
      post({
        type: "error",
        seq: msg.seq,
        code: err instanceof MagnetCutterError ? err.code : "UNEXPECTED",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}
