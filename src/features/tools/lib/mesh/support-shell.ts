/**
 * 包裹支撑 —— 检测工具与克重工具共用的支撑几何 / 体积算法
 *
 * 2026-11-02 从 `analyze.ts` 抽出来。克重工具(`/tools/weight`)原先自己有一套
 * 「PolyJet 双体积公式」(外壳包裹体积 + 底部填充体积),跟检测工具画出来的
 * 包裹支撑对不上 —— 同一个模型两个工具给两个数。现在两边共用这一份:
 *
 *   - 检测工具:用它画包裹支撑(外壳 / 顶面 / 外壁 / 平台投影)
 *   - 克重工具:用它算支撑体积(平台到下朝向面之间的包裹材料)
 *
 * ## 支撑体是什么
 *
 * WJP 全彩打印用水溶性包裹支撑:支撑材料从平台往上长,长到模型的下表面为止。
 * 支撑体由三部分围合(和检测工具的可视化一一对应):
 *
 *   - underside:模型的下朝向面(法线朝下)—— 支撑材料的上边界
 *   - curtain  :下朝向区域的边界边竖直挤出到平台 —— 支撑体的外壁
 *   - 平台投影 :模型在平台上的投影 —— 支撑体的底面 / 占地区域
 *
 * ## 支撑体积怎么算
 *
 * 按列算(height field):每个 XY 格子里,支撑从平台长到该列的下朝向面
 * (underZ),再扣掉该列里模型自己占掉的部分(模型底面 modelLo 到 underZ 之间)。
 * 这样「蘑菇」(宽帽 + 细腿)算出来是帽子下面那圈空间,而不是把整根柱子
 * 都当成支撑。
 *
 * ## 姿态搜索为什么不用重复焊接
 *
 * 焊接 / 拓扑是**姿态无关**的:顶点合并关系、边-面映射在刚体旋转下完全不变。
 * 所以摆盘搜索焊一次就够,之后每个候选姿态只旋转顶点和法线
 * (见 `rotateSupportMesh`),每个姿态的代价是 O(V + F)。
 */
// @ts-nocheck —— 同 weld.ts / analyze.ts:全是 typedArray 下标访问,逐个加 `!`
// 会淹没 diff。行为由 src/test/tools/pure/wjp-mesh.test.ts 守住。
import type { SupportShellData } from "./types";
import { type TopologyResult, weldAndAnalyzeTopology } from "./weld";

/**
 * `buildSupportShell` 需要的网格子集 —— `WeldedMesh` 天然满足。
 *
 * 单独定义是为了让「旋转后的网格」也能传进来(旋转不改变拓扑,只改坐标)。
 */
export interface SupportMesh {
  vertexCount: number;
  /** 3 floats per vertex */
  vertices: Float32Array;
  /** 3 indices per face */
  faceVertex: Uint32Array;
  faceCount: number;
  /** 3 per face(单位法线) */
  faceNormals: Float32Array;
  /** per face(mm²) */
  faceAreas: Float32Array;
  /** edge key → 该边上的面列表 */
  edgeFaceMap: Map<number, number[]>;
  /** 包围盒对角线 mm(旋转不变) */
  diag: number;
  /** 包围盒最小角 */
  bboxMin: [number, number, number];
  /** 包围盒最大角 */
  bboxMax: [number, number, number];
}

/** 包裹支撑外壳的生成选项 */
export interface SupportShellOptions {
  /**
   * 是否生成支撑体外壁(下朝向区域的边界边竖直挤出到平台)。
   * 克重工具的摆盘热循环不需要(体积按列算,不靠外壁),关掉能省掉每个
   * 下朝向面 3 次边-面映射查询。
   */
  includeCurtain?: boolean | undefined;
  /**
   * 是否生成外壳渲染索引(剔除下朝向面后的三角形索引)。
   * 只有可视化需要;克重工具用不上。
   */
  includeTopIndex?: boolean | undefined;
}

/**
 * 包裹支撑几何:焊接顶点按相邻面面积加权平均出平滑法线,再沿法线整体外扩固定间隙。
 * WJP 全彩打印的水溶性支撑为整体包裹式(逐层喷射、包住模型),此几何即其包裹范围示意。
 * 间隙随模型尺寸自适应:对角线的 2%,限制在 0.8~5mm,保证任何尺寸下都看得清。
 *
 * 支撑体积(平台到模型之间全部为支撑材料)由三部分共同围合:
 * - underside:下朝向面片(支撑材料的上边界,贴着模型底面);
 * - curtain:下朝向区域的边界边竖直向下挤出至平台平面(支撑体外壁),内部共享边不挤出;
 * - 平台投影(主线程把全部面片压平到平台生成,支撑体的底面 / 占地区域)。
 *
 * 坐标基准:groundZ 取模型自身最低点略下方(非世界原点),主线程把整组几何再平移
 * -bboxMin.z 后,模型最低点恰好落在打印平台上。外壳顶点 z 不低于 groundZ:
 * 支撑材料落在平台上,不会下探到平台以下。
 *
 * faceEnclosed:被外壳包裹的内腔 / 碎片壳面片标记(1 = 封闭内部)。这些面片朝下也
 * 不生成支撑体(内部支撑无法清除的问题已由密封内腔告警覆盖),避免在模型实心内部
 * 出现误导性的支撑墙面。
 *
 * @param gapScale 间隙倍率 —— 1 = 检测工具的自适应间隙;克重工具用它做校准旋钮
 */
export function buildSupportShell(
  mesh: SupportMesh,
  faceEnclosed: Uint8Array,
  options?: SupportShellOptions,
  gapScale: number = 1
): SupportShellData {
  const includeCurtain = options?.includeCurtain !== false;
  const includeTopIndex = options?.includeTopIndex !== false;
  const vc = mesh.vertexCount;
  const normals = new Float32Array(vc * 3);
  for (let f = 0; f < mesh.faceCount; f++) {
    const w = mesh.faceAreas[f];
    const nx = mesh.faceNormals[f * 3] * w;
    const ny = mesh.faceNormals[f * 3 + 1] * w;
    const nz = mesh.faceNormals[f * 3 + 2] * w;
    if (nx === 0 && ny === 0 && nz === 0) continue; // 退化面不参与
    for (let k = 0; k < 3; k++) {
      const v = mesh.faceVertex[f * 3 + k];
      normals[v * 3] += nx;
      normals[v * 3 + 1] += ny;
      normals[v * 3 + 2] += nz;
    }
  }
  // 平台平面(模型坐标):模型最低点略下方,主线程整组平移后即为打印平台
  const groundZ = mesh.bboxMin[2] - Math.max(0.05, mesh.diag * 0.002);
  const gap = Math.min(5, Math.max(0.8, mesh.diag * 0.02)) * gapScale;
  const positions = new Float32Array(vc * 3);
  for (let v = 0; v < vc; v++) {
    let nx = normals[v * 3],
      ny = normals[v * 3 + 1],
      nz = normals[v * 3 + 2];
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-12) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = 0;
      ny = 0;
      nz = 1;
    }
    positions[v * 3] = mesh.vertices[v * 3] + nx * gap;
    positions[v * 3 + 1] = mesh.vertices[v * 3 + 1] + ny * gap;
    const pz = mesh.vertices[v * 3 + 2] + nz * gap;
    positions[v * 3 + 2] = pz < groundZ ? groundZ : pz; // 支撑落在平台上,不下探到平台以下
  }

  // ---- 下朝向面判定:z 分量略小于 0 即视为朝下(阈值贴近 0,使支撑体侧壁上沿
  // 贴到模型最宽轮廓,支撑填充看起来包裹到侧面中部);封闭内腔 / 包裹碎片除外 ----
  const DOWN_NZ = -1e-3;
  const isDownFace = (f: number) =>
    faceEnclosed[f] === 0 && mesh.faceNormals[f * 3 + 2] < DOWN_NZ;
  const GROUND_EPS = 0.02; // 贴地阈值:压平到平台的几何由平台投影负责,不再重复生成

  const topIndex: number[] = [];
  const underside: number[] = [];
  const curtain: number[] = [];
  const downFaces: number[] = [];
  const BUILD_CAP = 5_400_000; // ≈60 万面片,防御异常网格
  let capped = false;
  for (let f = 0; f < mesh.faceCount; f++) {
    const a = mesh.faceVertex[f * 3],
      b = mesh.faceVertex[f * 3 + 1],
      c = mesh.faceVertex[f * 3 + 2];
    if (!isDownFace(f)) {
      if (includeTopIndex) topIndex.push(a, b, c); // 外壳渲染索引:下朝向面由支撑体负责,避免两层面片叠加
      continue;
    }
    downFaces.push(f);
    if (capped) continue;
    const za = positions[a * 3 + 2],
      zb = positions[b * 3 + 2],
      zc = positions[c * 3 + 2];
    // 支撑体顶面:下朝向面本身(贴着模型底面的支撑上边界)
    if (
      za - groundZ > GROUND_EPS ||
      zb - groundZ > GROUND_EPS ||
      zc - groundZ > GROUND_EPS
    ) {
      underside.push(
        positions[a * 3],
        positions[a * 3 + 1],
        za,
        positions[b * 3],
        positions[b * 3 + 1],
        zb,
        positions[c * 3],
        positions[c * 3 + 1],
        zc
      );
    }
    // 支撑体外壁:下朝向区域的边界边竖直向下挤出至平台,内部共享边不挤出
    if (!includeCurtain) continue;
    const edges: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];
    for (const [u, v] of edges) {
      if (u === v) continue;
      const key = u < v ? u * vc + v : v * vc + u;
      const list = mesh.edgeFaceMap.get(key);
      let boundary = true;
      if (list) {
        for (const e of list) {
          const g = e >>> 1;
          if (g !== f && isDownFace(g)) {
            boundary = false;
            break;
          }
        }
      }
      if (!boundary) continue;
      const uz = positions[u * 3 + 2],
        vz = positions[v * 3 + 2];
      if (uz - groundZ < GROUND_EPS && vz - groundZ < GROUND_EPS) continue; // 贴地边,无侧壁
      curtain.push(
        positions[u * 3],
        positions[u * 3 + 1],
        uz,
        positions[v * 3],
        positions[v * 3 + 1],
        vz,
        positions[v * 3],
        positions[v * 3 + 1],
        groundZ,
        positions[u * 3],
        positions[u * 3 + 1],
        uz,
        positions[v * 3],
        positions[v * 3 + 1],
        groundZ,
        positions[u * 3],
        positions[u * 3 + 1],
        groundZ
      );
    }
    if (curtain.length >= BUILD_CAP || underside.length >= BUILD_CAP)
      capped = true;
  }

  return {
    positions,
    index: mesh.faceVertex,
    topIndex: new Uint32Array(topIndex),
    underside: new Float32Array(underside),
    gap,
    groundZ,
    downFaces: new Uint32Array(downFaces),
    curtain: new Float32Array(curtain),
  };
}

/**
 * 刚体旋转焊接后的网格(顶点 + 面法线)。
 *
 * 拓扑(faceVertex / edgeFaceMap)旋转不变,直接沿用;`bboxMin` 随姿态变,
 * 必须重算 —— `buildSupportShell` 用它定平台平面。
 */
export function rotateSupportMesh(
  mesh: SupportMesh,
  rotXDeg: number,
  rotYDeg: number,
  rotZDeg: number = 0
): SupportMesh {
  const rx = (rotXDeg * Math.PI) / 180;
  const ry = (rotYDeg * Math.PI) / 180;
  const rz = (rotZDeg * Math.PI) / 180;
  const cosX = Math.cos(rx),
    sinX = Math.sin(rx);
  const cosY = Math.cos(ry),
    sinY = Math.sin(ry);
  const cosZ = Math.cos(rz),
    sinZ = Math.sin(rz);

  const vc = mesh.vertexCount;
  const vertices = new Float32Array(vc * 3);
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let v = 0; v < vc; v++) {
    const x0 = mesh.vertices[v * 3];
    const y0 = mesh.vertices[v * 3 + 1];
    const z0 = mesh.vertices[v * 3 + 2];
    // X → Y → Z
    const y1 = y0 * cosX - z0 * sinX;
    const z1 = y0 * sinX + z0 * cosX;
    const x2 = x0 * cosY + z1 * sinY;
    const z2 = -x0 * sinY + z1 * cosY;
    const x3 = x2 * cosZ - y1 * sinZ;
    const y3 = x2 * sinZ + y1 * cosZ;
    vertices[v * 3] = x3;
    vertices[v * 3 + 1] = y3;
    vertices[v * 3 + 2] = z2;
    if (x3 < minX) minX = x3;
    if (x3 > maxX) maxX = x3;
    if (y3 < minY) minY = y3;
    if (y3 > maxY) maxY = y3;
    if (z2 < minZ) minZ = z2;
    if (z2 > maxZ) maxZ = z2;
  }

  const faceNormals = new Float32Array(mesh.faceCount * 3);
  for (let f = 0; f < mesh.faceCount; f++) {
    const nx = mesh.faceNormals[f * 3];
    const ny = mesh.faceNormals[f * 3 + 1];
    const nz = mesh.faceNormals[f * 3 + 2];
    const y1 = ny * cosX - nz * sinX;
    const z1 = ny * sinX + nz * cosX;
    const x2 = nx * cosY + z1 * sinY;
    const z2 = -nx * sinY + z1 * cosY;
    const x3 = x2 * cosZ - y1 * sinZ;
    const y3 = x2 * sinZ + y1 * cosZ;
    faceNormals[f * 3] = x3;
    faceNormals[f * 3 + 1] = y3;
    faceNormals[f * 3 + 2] = z2;
  }

  return {
    vertexCount: vc,
    vertices,
    faceVertex: mesh.faceVertex,
    faceCount: mesh.faceCount,
    faceNormals,
    faceAreas: mesh.faceAreas,
    edgeFaceMap: mesh.edgeFaceMap,
    diag: mesh.diag,
    bboxMin: [minX, minY, minZ],
    bboxMax: [maxX, maxY, maxZ],
  };
}

/** 标记被外壳包裹的内腔 / 碎片面片(与检测工具一致) */
export function markEnclosedFaces(topo: TopologyResult): Uint8Array {
  const faceEnclosed = new Uint8Array(topo.mesh.faceCount);
  for (let f = 0; f < topo.mesh.faceCount; f++) {
    const c = topo.faceComponent[f];
    if (c === -1) continue;
    const info = topo.components[c];
    if (info && (info.isCavity || info.isDebris)) faceEnclosed[f] = 1;
  }
  return faceEnclosed;
}

/** 摆盘用的模型:焊接后的网格 + 内腔标记 */
export interface SupportModel {
  mesh: SupportMesh;
  faceEnclosed: Uint8Array;
}

/**
 * 把三角汤(OBJ 解析出来的 9 float/面)备成摆盘用的模型。
 *
 * 焊接 + 拓扑一次性做完 —— 后面每个候选姿态只旋转,不重算。
 */
export function prepareSupportModel(positions: Float32Array): SupportModel {
  const topo = weldAndAnalyzeTopology(positions);
  return {
    mesh: topo.mesh,
    faceEnclosed: markEnclosedFaces(topo),
  };
}

/** 支撑体积计算的选项 */
export interface SupportVolumeOptions {
  /** 栅格精度 (mm),默认 1 */
  gridSizeMM?: number | undefined;
  /** 栅格格数上限,默认 200_000(超了就放大栅格) */
  maxCells?: number | undefined;
}

/** 支撑体积计算结果 */
export interface SupportVolumeResult {
  /** 包裹支撑体积 (mm³) */
  volumeMM3: number;
  /** 模型 XY 投影面积 (mm²) —— 支撑底面 / 占地区域 */
  footprintAreaMM2: number;
  /** 有支撑的投影面积 (mm²) */
  supportAreaMM2: number;
  /** 支撑体最高点(相对平台) (mm) */
  maxHeightMM: number;
  /** 下朝向面总面积 (mm²) —— 支撑顶面与模型的接触面积 */
  contactAreaMM2: number;
}

/**
 * 包裹支撑体积(按列算)
 *
 * 每个 XY 格子:
 *   - underZ  = 该列下朝向面的高度(支撑材料的上边界;没有下朝向面 → 该列无支撑)
 *   - modelLo / modelHi = 该列模型自身占据的 z 区间
 *   - 支撑高  = max(0, underZ - groundZ) - max(0, min(modelHi, underZ) - modelLo)
 *
 * 最后一项是「扣掉模型自己占掉的部分」:蘑菇的帽下那圈有支撑,帽正中间
 * (模型自己的腿)没有支撑。
 *
 * @param shell buildSupportShell 的输出(必须是**旋转后**网格算出来的)
 * @param mesh  与 shell 对应的(旋转后)网格 —— 用来取面索引和面积
 */
export function computeSupportVolume(
  shell: SupportShellData,
  mesh: SupportMesh,
  options?: SupportVolumeOptions
): SupportVolumeResult {
  const positions = shell.positions;
  const groundZ = shell.groundZ;
  const faceVertex = mesh.faceVertex;
  const faceAreas = mesh.faceAreas;

  const empty: SupportVolumeResult = {
    volumeMM3: 0,
    footprintAreaMM2: 0,
    supportAreaMM2: 0,
    maxHeightMM: 0,
    contactAreaMM2: 0,
  };

  // 下朝向面标记(shell.downFaces 是索引表)
  const isDown = new Uint8Array(mesh.faceCount);
  for (let i = 0; i < shell.downFaces.length; i++)
    isDown[shell.downFaces[i]] = 1;

  // 外壳包围盒(支撑体的占地区域)
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  const vc = mesh.vertexCount;
  for (let v = 0; v < vc; v++) {
    const x = positions[v * 3],
      y = positions[v * 3 + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return empty;
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return empty;

  // 栅格(格数超上限就放大栅格)
  const maxCells = options?.maxCells ?? 200_000;
  let gridSize = options?.gridSizeMM ?? 1;
  if (gridSize <= 0) gridSize = 1;
  let gridW = Math.ceil(width / gridSize);
  let gridH = Math.ceil(height / gridSize);
  if (gridW * gridH > maxCells) {
    const scale = Math.sqrt((gridW * gridH) / maxCells);
    gridSize *= scale;
    gridW = Math.ceil(width / gridSize);
    gridH = Math.ceil(height / gridSize);
  }
  if (gridW <= 0 || gridH <= 0) return empty;
  const cellCount = gridW * gridH;
  const cellArea = gridSize * gridSize;

  const underZ = new Float32Array(cellCount).fill(-Infinity);
  const modelLo = new Float32Array(cellCount).fill(Infinity);
  const modelHi = new Float32Array(cellCount).fill(-Infinity);
  const covered = new Uint8Array(cellCount);

  // 面法线 z 分量接近 0 = 竖直面:这一列穿过的是整段 z 区间,不是一个点
  const VERTICAL_NZ = 1e-3;

  for (let f = 0; f < mesh.faceCount; f++) {
    const a = faceVertex[f * 3],
      b = faceVertex[f * 3 + 1],
      c = faceVertex[f * 3 + 2];
    if (a === b || b === c || a === c) continue;
    const ax = positions[a * 3] - minX,
      ay = positions[a * 3 + 1] - minY,
      az = positions[a * 3 + 2];
    const bx = positions[b * 3] - minX,
      by = positions[b * 3 + 1] - minY,
      bz = positions[b * 3 + 2];
    const cx = positions[c * 3] - minX,
      cy = positions[c * 3 + 1] - minY,
      cz = positions[c * 3 + 2];

    const faceMinZ = Math.min(az, bz, cz);
    const faceMaxZ = Math.max(az, bz, cz);

    const txMin = Math.max(0, Math.floor(Math.min(ax, bx, cx) / gridSize));
    const txMax = Math.min(
      gridW - 1,
      Math.floor(Math.max(ax, bx, cx) / gridSize)
    );
    const tyMin = Math.max(0, Math.floor(Math.min(ay, by, cy) / gridSize));
    const tyMax = Math.min(
      gridH - 1,
      Math.floor(Math.max(ay, by, cy) / gridSize)
    );
    if (txMin > txMax || tyMin > tyMax) continue;

    // 投影面积(用于重心坐标);竖直面(投影退化成线)单独处理
    const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const a2 = Math.abs(area2);
    const nz = mesh.faceNormals[f * 3 + 2];
    const vertical = Math.abs(nz) < VERTICAL_NZ || a2 < 1e-12;
    const sign = area2 >= 0 ? 1 : -1;

    for (let gy = tyMin; gy <= tyMax; gy++) {
      const py = (gy + 0.5) * gridSize;
      for (let gx = txMin; gx <= txMax; gx++) {
        const px = (gx + 0.5) * gridSize;
        const eAB = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
        const eBC = (cx - bx) * (py - by) - (cy - by) * (px - bx);
        const eCA = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
        if (eAB * sign < 0 || eBC * sign < 0 || eCA * sign < 0) continue;

        const idx = gy * gridW + gx;
        covered[idx] = 1;

        // 这一列穿过模型的位置:非竖直面 = 面上那一点;竖直面 = 整段 z 区间
        let zLocal: number;
        if (vertical) {
          zLocal = faceMinZ;
        } else {
          const wA = (eBC * sign) / a2;
          const wB = (eCA * sign) / a2;
          const wC = (eAB * sign) / a2;
          zLocal = wA * az + wB * bz + wC * cz;
          if (zLocal < faceMinZ) zLocal = faceMinZ;
          else if (zLocal > faceMaxZ) zLocal = faceMaxZ;
        }
        if (vertical) {
          if (faceMinZ < modelLo[idx]) modelLo[idx] = faceMinZ;
          if (faceMaxZ > modelHi[idx]) modelHi[idx] = faceMaxZ;
        } else {
          if (zLocal < modelLo[idx]) modelLo[idx] = zLocal;
          if (zLocal > modelHi[idx]) modelHi[idx] = zLocal;
        }

        // 下朝向面 = 支撑材料的上边界
        if (isDown[f] && zLocal > underZ[idx]) underZ[idx] = zLocal;
      }
    }
  }

  let volume = 0;
  let supportArea = 0;
  let footprintArea = 0;
  let maxHeight = 0;
  let contactArea = 0;
  for (let f = 0; f < mesh.faceCount; f++) {
    if (isDown[f]) contactArea += faceAreas[f];
  }
  for (let i = 0; i < cellCount; i++) {
    if (!covered[i]) continue;
    footprintArea += cellArea;
    const uz = underZ[i];
    if (!Number.isFinite(uz)) continue;
    const h = uz - groundZ;
    if (h <= 0) continue;
    const lo = modelLo[i];
    const hi = modelHi[i];
    // 模型自己占掉的部分(列内 from modelLo 到 underZ)
    let modelBelow = 0;
    if (Number.isFinite(lo) && Number.isFinite(hi)) {
      modelBelow = Math.min(hi, uz) - lo;
      if (modelBelow < 0) modelBelow = 0;
    }
    const gel = h - modelBelow;
    if (gel <= 0) continue;
    volume += gel * cellArea;
    supportArea += cellArea;
    if (h > maxHeight) maxHeight = h;
  }

  return {
    volumeMM3: volume,
    footprintAreaMM2: footprintArea,
    supportAreaMM2: supportArea,
    maxHeightMM: maxHeight,
    contactAreaMM2: contactArea,
  };
}
