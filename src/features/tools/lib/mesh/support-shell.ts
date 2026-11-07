/**
 * 包裹支撑 —— 检测工具与克重工具共用的支撑几何 / 体积算法
 *
 * 2026-11-02 从 `analyze.ts` 抽出来。打印前工作台(`/tools/workbench`)原先自己有一套
 * 「PolyJet 双体积公式」(外壳包裹体积 + 底部填充体积),跟检测工具画出来的
 * 包裹支撑对不上 —— 同一个模型两个工具给两个数。现在两边共用这一份:
 *
 *   - 检测工具:用它画包裹支撑(外壳 / 顶面 / 外壁 / 平台投影)
 *   - 克重工具:用它算支撑体积(平台到下朝向面之间的包裹材料)
 *
 * ## 支撑体是什么
 *
 * WJP 全彩打印用水溶性包裹支撑:支撑材料从平台往上长,长到模型的下表面为止。
 * 支撑先在平台上长一层 5mm 托底(`SUPPORT_LIFT_MM`),模型整个悬在托底上,
 * 不直接贴平台 —— 托底那层也是支撑材料,算进克重。
 * 支撑体由三部分围合(和检测工具的可视化一一对应):
 *
 *   - underside:模型的下朝向面(法线朝下)—— 支撑材料的上边界
 *   - curtain  :下朝向区域的边界边竖直挤出到平台 —— 支撑体的外壁
 *   - 平台投影 :模型在平台上的投影 —— 支撑体的底面 / 占地区域
 *
 * ## 支撑体积怎么算
 *
 * 按列算(height field),但**列里的模型材料不一定是连续的一段**:
 *
 *   一列(垂直视线)穿过模型表面 = 一串 z 交点。按奇偶配对,相邻两个交点之间
 *   是模型材料,再往下就是空腔(要填支撑)。列高(顶交点 − 平台)减去材料长度,
 *   就是这一列的支撑高度。
 *
 * 这样「蘑菇」(宽帽 + 细腿)算出来是帽子下面那圈空间,而不是把整根柱子
 * 都当成支撑;「宽底座 + 细身体」也不会因为底座盖住身体就漏掉悬空那圈。
 *
 * 之前用的是「列内模型 = 从 modelLo 一直实心到 modelHi」的近似,
 * 一旦同一列里模型上下两截(底座 + 上面的身体 / 悬空手臂),
 * 中间那段空腔就被当成模型自己占掉,支撑体积被整段抹掉 ——
 * 有底座的手办,支撑克重能偏小 5 倍以上。
 *
 * ## 口径必须跟模型克重一致(2026-11-03)
 *
 * 模型克重 = 真网格的有符号四面体体积(解析值,精确)。
 * 支撑克重如果拿**外扩过的外壳**去算,同样的模型两个数就对不上:
 * 外壳间隙(对角线 2%,0.8~5mm)只是可视化用的间隙,算进体积会让支撑
 * 克重系统性地高 10~30%(形状越细高越离谱)。
 *
 * 所以支撑体积一律用**真几何**(mesh.vertices),平台取模型最低点,
 * 外壳间隙只留在可视化那一侧。
 *
 * ## 姿态搜索为什么不用重复焊接
 *
 * 焊接 / 拓扑是**姿态无关**的:顶点合并关系、边-面映射在刚体旋转下完全不变。
 * 所以摆盘搜索焊一次就够,之后每个候选姿态只旋转顶点和法线
 * (见 `rotateSupportMesh`),每个姿态的代价是 O(V + F)。
 */
// @ts-nocheck —— 同 weld.ts / analyze.ts:全是 typedArray 下标访问,逐个加 `!`
// 会淹没 diff。行为由 src/test/tools/pure/wjp-mesh.test.ts 守住。
import { type MeshCheckSummary, summarizeTopology } from "./summary";
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

/**
 * 支撑托底高度 (mm)
 *
 * 有支撑的时候模型不会直接贴紧平台 —— 支撑材料先在平台上长一层 **5mm**
 * 托住模型,模型整个悬在这层托底上(工作室的实际工艺,2026-11-04 确认)。
 * 所以:
 *
 *   平台面 = 模型最低点 − 5mm
 *   支撑   = 托底那 5mm + 平台到模型下表面之间的空腔
 *
 * 托底那层也是支撑材料(打印完一起洗掉),要算进支撑克重 —— 占地就是模型
 * 的投影面积,一个 40×40mm 的手办光托底就 8cm³(5mm 厚)。
 *
 * 这个高度同时决定 3D 预览里模型离平台多远(共用的
 * `shared/components/model-viewport` 直接用这个常量)—— 改了这里,画面跟着变。
 */
export const SUPPORT_LIFT_MM = 5;

/**
 * 底板留边 (mm)
 *
 * 工作室的支撑工艺:底板**比模型轮廓四周各留一圈边**再铺 5mm 托底 ——
 * 底板不是照着模型的轮廓卡着裁,而是往外多出一圈(2026-11-04 跟工作室
 * 对数确认:留边 5mm 时冰箱贴 43 + 59 = 102g,跟工作室报的一致;留边 0
 * 只有 90g,轻 12g)。
 *
 * 这圈边也是 5mm 厚的支撑材料,算进支撑克重 —— 底板占地 = 模型轮廓
 * (投影面积)按欧氏距离外扩这么多。
 */
export const SUPPORT_BASE_MARGIN_MM = 5;

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
  /**
   * 托底高度 (mm) —— 平台面在模型最低点下方多远
   *
   * 默认 `SUPPORT_LIFT_MM`(5mm)。**2026-11-06 起这个值由工作室在
   * `/admin/print-pricing` 里配** —— 不传就退回 5mm(行为跟以前一样)。
   */
  liftMm?: number | undefined;
  /**
   * 是否生成**底板留边**那一圈的几何
   *
   * 工作室的工艺:底板比模型轮廓四周各留一圈边(默认 5mm),那圈边也是
   * 实心支撑 —— 克重那边**算进去了**,画面上原来没画。两个视角并排看,
   * 差的就是这一圈。
   *
   * 默认**关**:摆盘搜索一次要算 625 个姿态,每个姿态都做一遍栅格外扩太贵。
   * 只在真的要画的那两条路(检查视角 / 克重视角)打开。
   */
  includeBaseRing?: boolean | undefined;
  /**
   * 底板留边 (mm) —— 底板比模型轮廓四周各留多宽
   *
   * 默认 `SUPPORT_BASE_MARGIN_MM`(5mm)。跟克重那边算支撑体积用的是
   * **同一个数**(都跟随后台 `/admin/print-pricing`)。
   */
  baseMarginMM?: number | undefined;
  /**
   * 栅格精度 (mm) —— 画底板那一圈用的栅格
   *
   * 默认 1mm。**要跟算支撑体积那一路用同一个值**,否则画出来的底板边界跟
   * 算克重时的边界会差半格到几格。克重那边算体积默认也是 1mm。
   */
  gridSizeMM?: number | undefined;
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
  // 平台平面(模型坐标):托底 5mm(支撑托着模型,模型不贴平台)再略下方,
  // 主线程整组平移后即为打印平台
  const groundZ =
    mesh.bboxMin[2] -
    (options?.liftMm ?? SUPPORT_LIFT_MM) -
    Math.max(0.05, mesh.diag * 0.002);
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

  // ---- 底板留边那一圈(可选) ----
  //
  // 底板比模型轮廓四周各留一圈边,那圈边也是实心支撑 —— 克重那边算进去了,
  // 画面上原来没画。栅格 / 膨胀 / 外扩距离跟算体积那一条路**完全共用**
  // (`rasterizeFootprint` + `dilateMaskByDistance`),所以画出来的底板边界
  // 就是算克重时的底板边界,不是「差不多」。
  const baseRing = options?.includeBaseRing
    ? buildBasePlateRing(mesh, {
        baseMarginMM: options?.baseMarginMM,
        gridSizeMM: options?.gridSizeMM,
        z: groundZ,
      })
    : new Float32Array(0);

  return {
    positions,
    index: mesh.faceVertex,
    topIndex: new Uint32Array(topIndex),
    underside: new Float32Array(underside),
    gap,
    groundZ,
    downFaces: new Uint32Array(downFaces),
    curtain: new Float32Array(curtain),
    baseRing,
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

/**
 * 按 XYZ 缩放焊接后的网格(拓扑不变,只挪顶点)
 *
 * 缩放不改变拓扑:焊接结果、面邻接、边-面映射、内腔标记都跟尺寸无关。
 * 所以改尺寸不用重新解析 / 重新焊接 —— 挪一下顶点就行(2026-11-03)。
 *
 *   - 顶点:v' = S·v(以模型原点为中心,跟 OBJ 导出 / 预览同一口径)
 *   - 法线:n' ∝ S⁻ᵀn(逆转置)—— 非均匀缩放时法线方向真的会变
 *   - 面积:A' = A·|det S|·|S⁻ᵀn̂| —— 缩放后三角面的真实面积
 *   - 包围盒 / 对角线:重算(外壳间隙、平台平面都依赖它)
 */
export function scaleSupportMesh(
  mesh: SupportMesh,
  sx: number,
  sy: number,
  sz: number
): SupportMesh {
  const vc = mesh.vertexCount;
  const vertices = new Float32Array(vc * 3);
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let v = 0; v < vc; v++) {
    const x = mesh.vertices[v * 3] * sx;
    const y = mesh.vertices[v * 3 + 1] * sy;
    const z = mesh.vertices[v * 3 + 2] * sz;
    vertices[v * 3] = x;
    vertices[v * 3 + 1] = y;
    vertices[v * 3 + 2] = z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  // 法线按逆转置变换 diag(1/sx, 1/sy, 1/sz)·n,再归一化
  const det = Math.abs(sx * sy * sz);
  const faceNormals = new Float32Array(mesh.faceCount * 3);
  const faceAreas = new Float32Array(mesh.faceCount);
  for (let f = 0; f < mesh.faceCount; f++) {
    const nx = mesh.faceNormals[f * 3];
    const ny = mesh.faceNormals[f * 3 + 1];
    const nz = mesh.faceNormals[f * 3 + 2];
    const tx = nx / sx;
    const ty = ny / sy;
    const tz = nz / sz;
    // |S⁻ᵀn̂| —— 面被拉伸的倍数(退化面是 0,面积保持 0)
    const stretch = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (stretch > 0) {
      faceNormals[f * 3] = tx / stretch;
      faceNormals[f * 3 + 1] = ty / stretch;
      faceNormals[f * 3 + 2] = tz / stretch;
    }
    // 面积 = 原面积 × |det S| × |S⁻ᵀn̂|
    faceAreas[f] = mesh.faceAreas[f] * det * stretch;
  }

  const dx = maxX - minX,
    dy = maxY - minY,
    dz = maxZ - minZ;
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return {
    vertexCount: vc,
    vertices,
    faceVertex: mesh.faceVertex,
    faceCount: mesh.faceCount,
    faceNormals,
    faceAreas,
    edgeFaceMap: mesh.edgeFaceMap,
    diag: Number.isFinite(diag) && diag > 0 ? diag : 1,
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

/** 摆盘用的模型:焊接后的网格 + 内腔标记 + 自检摘要 */
export interface SupportModel {
  mesh: SupportMesh;
  faceEnclosed: Uint8Array;
  /**
   * 网格自检摘要 —— **焊接的时候顺手算出来的**
   *
   * 焊接 / 拓扑本来就要跑一遍(摆盘要靠它建边-面映射),自检摘要只是把
   * 这份拓扑**再读一遍**得出结论,不额外焊接。
   *
   * 克重工具的「打印前检查」徽标吃的就是它 —— 用户不用把同一个文件再拖
   * 进检查工具。
   *
   * 摘要里的结论(状态 / 问题清单)跟**尺寸无关**,所以缩放不用重算。
   * 但 `stats` 里的尺寸和体积是**焊接时那份网格**的(文件里的原始坐标)——
   * 徽标不显示它们,页面上显示的尺寸在尺寸面板里(那里用的是缩放后的值)。
   */
  summary: MeshCheckSummary;
}

/**
 * 把三角汤(OBJ 解析出来的 9 float/面)备成摆盘用的模型。
 *
 * 焊接 + 拓扑一次性做完 —— 后面每个候选姿态只旋转,不重算。
 *
 * 自检摘要也在这里出:它吃的就是刚算出来的那份拓扑,**不多焊一次**。
 */
export function prepareSupportModel(
  positions: Float32Array,
  options?: { fileName?: string | undefined }
): SupportModel {
  const t0 = performance.now();
  const topo = weldAndAnalyzeTopology(positions);
  return {
    mesh: topo.mesh,
    faceEnclosed: markEnclosedFaces(topo),
    summary: summarizeTopology(topo, {
      fileName: options?.fileName,
      analysisMs: Math.round(performance.now() - t0),
    }),
  };
}

/**
 * 把摆盘模型缩放到实际尺寸(拓扑 / 内腔标记不变,只挪顶点)
 *
 * 克重工具按用户调过的尺寸算支撑,所以支撑计算必须跑在**缩放后**的网格上:
 * 非均匀缩放时模型的高度、投影、悬垂面全变了,拿原始网格乘个系数去凑
 * 会算不准(尤其高度限制那一步)。缩放只挪顶点,不用重新焊接 ✓
 */
export function scaleSupportModel(
  model: SupportModel,
  sx: number,
  sy: number,
  sz: number
): SupportModel {
  return {
    mesh: scaleSupportMesh(model.mesh, sx, sy, sz),
    faceEnclosed: model.faceEnclosed,
    // 摘要的结论跟尺寸无关(拓扑不变),原样带着走
    summary: model.summary,
  };
}

/** 支撑体积计算的选项 */
export interface SupportVolumeOptions {
  /** 栅格精度 (mm),默认 1 */
  gridSizeMM?: number | undefined;
  /** 栅格格数上限,默认 200_000(超了就放大栅格) */
  maxCells?: number | undefined;
  /**
   * 底板留边 (mm) —— 底板比模型轮廓四周各留多宽
   *
   * 默认 `SUPPORT_BASE_MARGIN_MM`(5mm)。传 0 = 底板照着模型轮廓裁
   * (老口径,工作室报数对不上)。
   */
  baseMarginMM?: number | undefined;
  /**
   * 托底高度 (mm) —— 平台面在模型最低点下方多远
   *
   * 默认 `SUPPORT_LIFT_MM`(5mm)。**2026-11-06 起这个值由工作室在
   * `/admin/print-pricing` 里配** —— 不传就退回 5mm(行为跟以前一样)。
   *
   * 底板那圈留边的**厚度**也是这个值(底板就是平台上那层托底)。
   */
  liftMm?: number | undefined;
}

/**
 * 一维平方距离变换(Felzenszwalb 的抛物线下包络)
 *
 * `f[i]` 换成一维「到最近零点位的距离平方」:f 里是 0 的位置是源点。
 * O(n),每个元素进栈出栈各一次。
 */
function distanceTransform1D(
  f: Float64Array,
  n: number,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array
): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]!] + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q] + q * q - (f[v[k]!] + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const dq = q - v[k]!;
    d[q] = dq * dq + f[v[k]!];
  }
}

/**
 * 把 0/1 掩膜按**欧氏距离**外扩 `marginMM`
 *
 * 返回的掩膜 = 原掩膜 + 距离最近被置位格子 ≤ marginMM 的格子。
 * 用来算「底板比模型轮廓四周各留 N mm」。
 *
 * 为什么不用八邻域的逐层外扩(便宜得多):那是切比雪夫距离,底板会变成
 * 方角,面积比真实的圆角外扩大一点点 —— 报价跟工作室对不上就差在这儿。
 * 这里用精确的欧氏距离变换(Felzenszwalb 两遍一维),格子数只多几个百分点。
 *
 * **半格修正**:掩膜置位的是「格心落在模型轮廓内」的格子,它的外边界比
 * 真实轮廓往里缩了约半格。所以距离阈值加上半格,外扩出来的才是「离真实
 * 轮廓 marginMM」的那一圈。
 */
export function dilateMaskByDistance(
  mask: Uint8Array,
  gridW: number,
  gridH: number,
  marginMM: number,
  cellSizeMM: number
): Uint8Array {
  const out = new Uint8Array(mask.length);
  if (marginMM <= 0 || cellSizeMM <= 0) {
    out.set(mask);
    return out;
  }
  const INF = 1e20;
  const f = new Float64Array(mask.length);
  for (let i = 0; i < mask.length; i++) f[i] = mask[i] ? 0 : INF;

  const n = Math.max(gridW, gridH);
  const line = new Float64Array(n);
  const lineOut = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  // 先按列,再按行 —— 两遍一维变换拼出二维距离
  // (输入输出必须分开:第二遍会读 f[v[k]],同一个数组会被前一次写入覆盖)
  for (let x = 0; x < gridW; x++) {
    for (let y = 0; y < gridH; y++) line[y] = f[y * gridW + x]!;
    distanceTransform1D(line, gridH, lineOut, v, z);
    for (let y = 0; y < gridH; y++) f[y * gridW + x] = lineOut[y]!;
  }
  for (let y = 0; y < gridH; y++) {
    const row = y * gridW;
    for (let x = 0; x < gridW; x++) line[x] = f[row + x]!;
    distanceTransform1D(line, gridW, lineOut, v, z);
    for (let x = 0; x < gridW; x++) f[row + x] = lineOut[x]!;
  }

  // 阈值:margin + 半格(掩膜外边界比真实轮廓往里缩了半格)
  const maxDistCells = marginMM / cellSizeMM + 0.5;
  const maxDist2 = maxDistCells * maxDistCells;
  for (let i = 0; i < mask.length; i++) out[i] = f[i]! <= maxDist2 ? 1 : 0;
  return out;
}

/**
 * 支撑体积 / 底板留边共用的栅格 —— **一份口径**
 *
 * 「模型在平台上的投影」这个概念有两处要用:
 *
 *   ① 算支撑体积(`computeSupportVolume`)—— 底板留边那圈是实心支撑
 *   ② 画底板(`buildBasePlateRing`)—— 画面上要看得见那圈边
 *
 * 两处必须用**同一张栅格**:栅格原点 / 格边长 / 留边宽度一旦有一处不一样,
 * 画出来的底板边界跟算克重时的底板边界就会差半格到几格 —— 两个视角并排看
 * 的时候一眼就看出来。所以栅格只在这里建一次,两边共用。
 */
export interface FootprintGrid {
  /** 栅格原点(模型坐标 mm) */
  originX: number;
  originY: number;
  /** 格边长 (mm) */
  gridSize: number;
  gridW: number;
  gridH: number;
  cellCount: number;
  /** 每格面积 (mm²) */
  cellArea: number;
  /** 底板留边 (mm) —— 栅格比模型包围盒大一圈 */
  marginMM: number;
  /** 格心落在模型轮廓内的格子 */
  covered: Uint8Array;
  /** 每一列下朝向面的最高 z —— 支撑材料的上边界 */
  underZ: Float32Array;
  /** 每一列模型材料的最低 z */
  modelLo: Float32Array;
  /** 每一列模型材料的最高 z */
  modelHi: Float32Array;
  /** z 交点(按面收集,后面按格归拢) */
  crossZ: Float32Array;
  /** 每个交点属于哪一格 */
  crossCell: Uint32Array;
  /** 掠射交点标记(格心正好落在面的边界上) */
  crossGraz: Uint8Array;
  crossCount: number;
}

/** 栅格化选项 */
export interface FootprintOptions {
  /** 栅格精度 (mm),默认 1 */
  gridSizeMM?: number | undefined;
  /** 栅格格数上限,默认 200_000(超了就放大栅格) */
  maxCells?: number | undefined;
  /**
   * 底板留边 (mm) —— 底板比模型轮廓四周各留多宽
   *
   * 默认 `SUPPORT_BASE_MARGIN_MM`(5mm)。跟克重那边算支撑体积用的是
   * **同一个数**(都跟随后台 `/admin/print-pricing`)。
   */
  baseMarginMM?: number | undefined;
}

/**
 * 把模型栅格化成 XY 高度场 —— 算体积 / 画底板共用的那一份
 *
 * 逐面把三角形投影到 XY 栅格里,每格记下:模型材料的高度区间、下朝向面的
 * 上边界、以及穿过这一列的 z 交点(奇偶配对用)。
 *
 * @param isDown 下朝向面标记(1 = 支撑材料的上边界)。传 `null` = 不需要
 *   `underZ`(画底板时用不上),省掉一次写数组。
 */
function rasterizeFootprint(
  mesh: SupportMesh,
  isDown: Uint8Array | null,
  options?: FootprintOptions
): FootprintGrid | null {
  const positions = mesh.vertices;
  const faceVertex = mesh.faceVertex;

  // 模型 XY 包围盒(支撑体的占地区域)
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
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  // 底板留边:底板比模型轮廓四周各留一圈 —— 栅格要比模型包围盒大一圈,
  // 留边那部分落在模型轮廓外面(底板是实心的,那圈也是 5mm 厚的支撑)。
  const marginMM = Math.max(0, options?.baseMarginMM ?? SUPPORT_BASE_MARGIN_MM);
  const originX = minX - marginMM;
  const originY = minY - marginMM;
  const width = maxX - minX + marginMM * 2;
  const height = maxY - minY + marginMM * 2;
  if (width <= 0 || height <= 0) return null;

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
  if (gridW <= 0 || gridH <= 0) return null;
  const cellCount = gridW * gridH;
  const cellArea = gridSize * gridSize;

  // ---- 逐列收集 z 交点 ----
  // 交点数量 ≈ 面片数(密集网格每片面覆盖一格),用可增长数组兜住
  let crossCap = Math.max(1024, Math.min(1 << 20, mesh.faceCount * 2));
  let crossZ = new Float32Array(crossCap);
  let crossCell = new Uint32Array(crossCap);
  // 「掠射」标记:采样点正好落在面的边界上(栅格线跟面重合),这一格的交点
  // 个数会被多算一个 —— 奇偶配对整体错位,支撑体积系统性地偏大。
  let crossGraz = new Uint8Array(crossCap);
  let crossCount = 0;

  const underZ = new Float32Array(cellCount).fill(-Infinity);
  const modelLo = new Float32Array(cellCount).fill(Infinity);
  const modelHi = new Float32Array(cellCount).fill(-Infinity);
  const covered = new Uint8Array(cellCount);

  // 面法线 z 分量接近 0 = 竖直面:视线与它相切,不产生穿越交点
  const VERTICAL_NZ = 1e-3;

  for (let f = 0; f < mesh.faceCount; f++) {
    const a = faceVertex[f * 3],
      b = faceVertex[f * 3 + 1],
      c = faceVertex[f * 3 + 2];
    if (a === b || b === c || a === c) continue;
    const ax = positions[a * 3] - originX,
      ay = positions[a * 3 + 1] - originY,
      az = positions[a * 3 + 2];
    const bx = positions[b * 3] - originX,
      by = positions[b * 3 + 1] - originY,
      bz = positions[b * 3 + 2];
    const cx = positions[c * 3] - originX,
      cy = positions[c * 3 + 1] - originY,
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
          // 交点入列
          if (crossCount === crossCap) {
            crossCap *= 2;
            const grownZ = new Float32Array(crossCap);
            grownZ.set(crossZ);
            crossZ = grownZ;
            const grownCell = new Uint32Array(crossCap);
            grownCell.set(crossCell);
            crossCell = grownCell;
            const grownGraz = new Uint8Array(crossCap);
            grownGraz.set(crossGraz);
            crossGraz = grownGraz;
          }
          crossZ[crossCount] = zLocal;
          crossCell[crossCount] = idx;
          // 采样点落在面的边界上(而不是面的内部)→ 掠射交点。
          // 判据用重心坐标:某个 w 距离 0 不超过 1e-9。
          const grazeTol = a2 * 1e-9;
          crossGraz[crossCount] =
            Math.abs(eAB) <= grazeTol ||
            Math.abs(eBC) <= grazeTol ||
            Math.abs(eCA) <= grazeTol
              ? 1
              : 0;
          crossCount++;
        }

        // 下朝向面 = 支撑材料的上边界
        if (isDown?.[f] && zLocal > underZ[idx]) underZ[idx] = zLocal;
      }
    }
  }

  return {
    originX,
    originY,
    gridSize,
    gridW,
    gridH,
    cellCount,
    cellArea,
    marginMM,
    covered,
    underZ,
    modelLo,
    modelHi,
    crossZ,
    crossCell,
    crossGraz,
    crossCount,
  };
}

/** 底板留边那一圈的几何选项 */
export interface BasePlateRingOptions extends FootprintOptions {
  /** 底板所在平面的 z(模型坐标) —— 平台平面 */
  z: number;
}

/**
 * 底板留边那一圈的几何(三角汤,无索引)
 *
 * 工作室的工艺:底板**比模型轮廓四周各留一圈边**再铺 5mm 托底 —— 那圈边
 * 也是实心支撑材料。`computeSupportVolume` 把它的体积算进支撑克重,这里
 * 把它的形状画出来 —— **同一张栅格、同一套欧氏距离外扩**,所以画出来的
 * 边界就是算克重时的边界。
 *
 * 外扩走**欧氏距离**(距离变换 + 半格修正),不是八邻域 —— 八邻域是切比雪夫
 * 距离,底板会变成方角,面积跟工作室对不上。
 *
 * @returns 每个格子两个三角形;没有留边时返回空数组
 */
export function buildBasePlateRing(
  mesh: SupportMesh,
  options: BasePlateRingOptions
): Float32Array {
  const marginMM = Math.max(0, options.baseMarginMM ?? SUPPORT_BASE_MARGIN_MM);
  if (marginMM <= 0) return new Float32Array(0);

  const grid = rasterizeFootprint(mesh, null, {
    baseMarginMM: marginMM,
    gridSizeMM: options.gridSizeMM,
    maxCells: options.maxCells,
  });
  if (!grid) return new Float32Array(0);

  const { originX, originY, gridSize, gridW, gridH, cellCount, covered } = grid;
  const dilated = dilateMaskByDistance(
    covered,
    gridW,
    gridH,
    marginMM,
    gridSize
  );

  // 先数一遍有几格是「外扩出来的」—— 没有就不建几何
  let extraCells = 0;
  for (let i = 0; i < cellCount; i++) {
    if (dilated[i] && !covered[i]) extraCells++;
  }
  if (extraCells === 0) return new Float32Array(0);

  // 每格两个三角形(6 个顶点 × 3 个 float)
  const out = new Float32Array(extraCells * 18);
  const z = options.z;
  let w = 0;
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const i = gy * gridW + gx;
      if (!dilated[i] || covered[i]) continue;
      const x0 = originX + gx * gridSize;
      const y0 = originY + gy * gridSize;
      const x1 = x0 + gridSize;
      const y1 = y0 + gridSize;
      // 三角形 1:(x0,y0) (x1,y0) (x1,y1)
      out[w++] = x0;
      out[w++] = y0;
      out[w++] = z;
      out[w++] = x1;
      out[w++] = y0;
      out[w++] = z;
      out[w++] = x1;
      out[w++] = y1;
      out[w++] = z;
      // 三角形 2:(x0,y0) (x1,y1) (x0,y1)
      out[w++] = x0;
      out[w++] = y0;
      out[w++] = z;
      out[w++] = x1;
      out[w++] = y1;
      out[w++] = z;
      out[w++] = x0;
      out[w++] = y1;
      out[w++] = z;
    }
  }
  return out;
}

/** 支撑体积计算结果 */
export interface SupportVolumeResult {
  /** 包裹支撑体积 (mm³) —— 支撑材料本身 */
  volumeMM3: number;
  /**
   * 全包裹体积 (mm³) —— 平台到模型顶的整块(支撑 + 模型)
   *
   * 逐列取「模型在该列的最高点 − 平台」再乘格子面积求和。
   * 支撑克重 = 全包裹克重 − 模型克重 —— 全包裹就是这一整块,
   * 减去模型自己占的那部分,剩下的才是支撑材料。
   */
  wrapVolumeMM3: number;
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
 * 包裹支撑体积(按列算 · 列内材料按奇偶配对求 · 真几何)
 *
 * 每个 XY 格子是一根垂直视线,穿过模型表面得到一串 z 交点:
 *
 *   - 交点按 z 排序后相邻两个之间是**模型材料**,再往下是**空腔**(填支撑)
 *   - 列高 = 顶交点 − 平台
 *   - 支撑高 = 列高 − 材料总长
 *
 * 列高(平台到模型顶)逐列加起来就是**全包裹体积** —— 打印出来那一整块
 * (支撑 + 模型)。所以支撑克重 = 全包裹克重 − 模型克重:整块称重,
 * 减去模型自己那份,剩下的才是支撑。
 *
 * 奇偶配对跟法线朝向无关,只看交点个数 —— 封闭网格的交点个数必然是偶数,
 * 配对出来的区间就是真正的材料段。这样同一列里模型上下两截时
 * (宽底座 + 细身体、悬空手臂、封闭内腔)中间的空腔不会被误当成模型。
 *
 * 竖直面与视线相切,不算「穿越」(上下沿各记一个会打乱奇偶配对),
 * 只保留 min/max 用于兜底:一列里若没有可配对的交点(开口网格、
 * 只有竖直面),退回「实心列」估算。
 *
 * **用真几何,不用外壳**:交点取自 `mesh.vertices`(模型自己的顶点),
 * 不是 `shell.positions`(沿法线外扩过的外壳)。模型克重用的是真网格的
 * 解析体积,支撑克重必须同一口径 —— 外壳间隙(对角线 2%,0.8~5mm)是
 * 可视化用的,算进体积会让支撑克重系统性地高 10~30%。
 *
 * 平台取模型最低点下方 5mm(`SUPPORT_LIFT_MM`):有支撑时支撑先在平台上
 * 长一层 5mm 托住模型,模型整个悬在托底上,不直接贴平台。托底那层也是
 * 支撑材料(打印完一起洗掉),算进支撑体积 —— 占地就是模型的投影面积。
 * `shell.groundZ` 还要再低 0.05~0.1mm(避免平台投影跟模型底面
 * z-fighting),那点缝不是材料,不算进支撑。
 *
 * @param shell buildSupportShell 的输出(必须是**旋转后**网格算出来的)
 * @param mesh  与 shell 对应的(旋转后)网格 —— 用来取顶点、面索引和面积
 */
export function computeSupportVolume(
  shell: SupportShellData,
  mesh: SupportMesh,
  options?: SupportVolumeOptions
): SupportVolumeResult {
  // 平台面比模型最低点低 5mm:支撑先长一层托底,模型悬在托底上(见
  // `SUPPORT_LIFT_MM`)。托底那层也是支撑材料,算进支撑体积。
  const liftMm = options?.liftMm ?? SUPPORT_LIFT_MM;
  const platformZ = mesh.bboxMin[2] - liftMm;
  const faceAreas = mesh.faceAreas;

  const empty: SupportVolumeResult = {
    volumeMM3: 0,
    wrapVolumeMM3: 0,
    footprintAreaMM2: 0,
    supportAreaMM2: 0,
    maxHeightMM: 0,
    contactAreaMM2: 0,
  };

  // 下朝向面标记(shell.downFaces 是索引表)
  const isDown = new Uint8Array(mesh.faceCount);
  for (let i = 0; i < shell.downFaces.length; i++)
    isDown[shell.downFaces[i]] = 1;

  // 栅格化 —— **跟画底板共用同一份**(`rasterizeFootprint`)
  //
  // 栅格原点 / 格边长 / 留边宽度一旦有一处不一样,算出来的底板边界跟画出来的
  // 底板边界就会差几格。所以两边走同一个函数,不各写一遍。
  const grid = rasterizeFootprint(mesh, isDown, options);
  if (!grid) return empty;
  const {
    gridSize,
    gridW,
    gridH,
    cellCount,
    cellArea,
    marginMM,
    covered,
    underZ,
    modelLo,
    modelHi,
    crossZ,
    crossCell,
    crossGraz,
    crossCount,
  } = grid;

  // ---- 按格归拢交点(计数排序)----
  const offsets = new Uint32Array(cellCount + 1);
  for (let i = 0; i < crossCount; i++) offsets[crossCell[i] + 1]++;
  for (let i = 1; i <= cellCount; i++) offsets[i] += offsets[i - 1];
  const cursor = new Uint32Array(cellCount);
  for (let i = 0; i < cellCount; i++) cursor[i] = offsets[i];
  const sortedZ = new Float32Array(crossCount);
  const sortedGraz = new Uint8Array(crossCount);
  for (let i = 0; i < crossCount; i++) {
    const cell = crossCell[i];
    sortedZ[cursor[cell]] = crossZ[i];
    sortedGraz[cursor[cell]] = crossGraz[i];
    cursor[cell]++;
  }

  let volume = 0;
  let wrapVolume = 0;
  let supportArea = 0;
  let footprintArea = 0;
  let maxHeight = 0;
  let contactArea = 0;
  for (let f = 0; f < mesh.faceCount; f++) {
    if (isDown[f]) contactArea += faceAreas[f];
  }

  // 单列交点通常 2~6 个,小缓冲 + 插入排序;超了再单独分配
  let sortBuf = new Float32Array(16);
  let sortBufGraz = new Uint8Array(16);
  let sortBufAlt = new Float32Array(16);
  // 几乎重合的交点要合并:格心正好落在两片三角形的公共边上时,同一张表面
  // 会被数成两次穿越,奇偶配对整体错位(立方体的对角线格就是这样)。
  const mergeEps = Math.max(1e-5, mesh.diag * 1e-6);
  for (let i = 0; i < cellCount; i++) {
    if (!covered[i]) continue;
    footprintArea += cellArea;
    const start = offsets[i];
    const k = offsets[i + 1] - start;
    let gel = NaN; // 支撑高度(NaN = 这列走兜底)
    let gelTop = -Infinity; // 支撑顶面(这一列最高的空腔上沿)
    if (k >= 2) {
      let buf = sortBuf;
      let bufGraz = sortBufGraz;
      if (k > buf.length) {
        // 记回外层,后面那几列直接复用(别每列都重新分配)
        buf = new Float32Array(k);
        bufGraz = new Uint8Array(k);
        sortBuf = buf;
        sortBufGraz = bufGraz;
        sortBufAlt = new Float32Array(k);
      }
      for (let j = 0; j < k; j++) {
        buf[j] = sortedZ[start + j];
        bufGraz[j] = sortedGraz[start + j];
      }
      // 插入排序(交点个数很少);掠射标记跟着一起搬
      for (let j = 1; j < k; j++) {
        const v = buf[j];
        const g = bufGraz[j];
        let t = j - 1;
        while (t >= 0 && buf[t] > v) {
          buf[t + 1] = buf[t];
          bufGraz[t + 1] = bufGraz[t];
          t--;
        }
        buf[t + 1] = v;
        bufGraz[t + 1] = g;
      }
      // 合并重合交点
      let m = 0;
      let hasGrazing = 0;
      for (let j = 0; j < k; j++) {
        if (m > 0 && buf[j] - buf[m - 1] <= mergeEps) {
          if (bufGraz[j]) bufGraz[m - 1] = 1;
          continue;
        }
        buf[m] = buf[j];
        bufGraz[m] = bufGraz[j];
        if (bufGraz[m]) hasGrazing = 1;
        m++;
      }
      if (m % 2 === 0) {
        // 奇偶配对:相邻交点之间是模型材料
        let material = 0;
        for (let j = 0; j + 1 < m; j += 2) material += buf[j + 1] - buf[j];
        const top = buf[m - 1];
        gel = top - platformZ - material;
        // 空腔上沿 = 奇数位的交点(最大的那个)
        gelTop = buf[m - 2];
        if (hasGrazing) {
          // 掠射列:格心正好落在面的边界上,这一格被那张面切成两半。
          // 「算这个交点」和「不算这个交点」各对应半格,取平均才是这一格的
          // 真实体积 —— 只取一种解释的话,整片倒向一边(封闭内腔的支撑会
          // 系统性地多算 10~30%)。
          let mAlt = 0;
          const bufAlt = sortBufAlt;
          for (let j = 0; j < m; j++) {
            if (bufGraz[j]) continue;
            bufAlt[mAlt++] = buf[j];
          }
          if (mAlt >= 2 && mAlt % 2 === 0) {
            let materialAlt = 0;
            for (let j = 0; j + 1 < mAlt; j += 2)
              materialAlt += bufAlt[j + 1] - bufAlt[j];
            const gelAlt = bufAlt[mAlt - 1] - platformZ - materialAlt;
            gel = (gel + gelAlt) / 2;
            const topAlt = bufAlt[mAlt - 2];
            if (topAlt > gelTop) gelTop = topAlt;
          }
        }
      } else {
        gel = NaN; // 交点个数是奇数 → 走兜底
      }
    }
    if (!(gel >= 0)) {
      // 兜底:这一列没法按奇偶配对(开口网格 / 只有竖直面 / 交点落单)
      // → 退回「实心列」估算:支撑从平台长到模型下边界
      const uz = underZ[i];
      if (!Number.isFinite(uz)) continue;
      const h = uz - platformZ;
      if (h <= 0) continue;
      const lo = modelLo[i];
      const hi = modelHi[i];
      let modelBelow = 0;
      if (Number.isFinite(lo) && Number.isFinite(hi)) {
        modelBelow = Math.min(hi, uz) - lo;
        if (modelBelow < 0) modelBelow = 0;
      }
      gel = h - modelBelow;
      gelTop = uz;
    }
    // 全包裹体积:这一列从平台到模型顶的整块(支撑 + 模型)。
    // 「支撑克重 = 全包裹克重 − 模型克重」里的那块全包裹就是它。
    // 放在跳过空支撑之前 —— 没有支撑的列(模型直接坐在平台上)也占全包裹。
    const hi = modelHi[i];
    if (Number.isFinite(hi)) {
      const wrapH = hi - platformZ;
      if (wrapH > 0) wrapVolume += wrapH * cellArea;
    }
    // 平台正好等于模型最低点时,浮点噪声会让「平底模型」多出 1e-16mm 的支撑,
    // 摆盘时同一姿态的正/负 180° 会因此差一点点、选出莫名其妙的角度。
    // 1e-9mm 远小于任何有意义的尺寸,只是把噪声抹平。
    if (gel <= 1e-9) continue;
    volume += gel * cellArea;
    supportArea += cellArea;
    const hTop = gelTop - platformZ;
    if (hTop > maxHeight) maxHeight = hTop;
  }

  // ---- 底板留边:模型轮廓外扩 marginMM 的一圈,也是 5mm 厚的底板 ----
  // 工作室的工艺:底板比模型大一圈(2026-11-04 确认)。这圈底板是实心的
  // 支撑材料,体积 = 外扩出来的占地 × 托底厚度。
  if (marginMM > 0 && footprintArea > 0) {
    const dilated = dilateMaskByDistance(
      covered,
      gridW,
      gridH,
      marginMM,
      gridSize
    );
    let extraCells = 0;
    for (let i = 0; i < cellCount; i++) {
      if (dilated[i] && !covered[i]) extraCells++;
    }
    const extraVolume = extraCells * cellArea * liftMm;
    volume += extraVolume;
    // 全包裹也跟着涨:底板那圈也在打印出来的整块里(上面没有模型,
    // 全包裹 = 平台 → 底板顶面 = 5mm)
    wrapVolume += extraVolume;
    // 支撑在平台上的占地 = 底板(模型轮廓 + 留边)
    supportArea += extraCells * cellArea;
  }

  return {
    volumeMM3: volume,
    wrapVolumeMM3: wrapVolume,
    footprintAreaMM2: footprintArea,
    supportAreaMM2: supportArea,
    maxHeightMM: maxHeight,
    contactAreaMM2: contactArea,
  };
}
