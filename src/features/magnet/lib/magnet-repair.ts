/**
 * 磁吸孔切割的网格清理 —— 让「不是封闭实体」的模型也能切
 *
 * ## 这一层**不修复用户的模型**(2026-11-11)
 *
 * 工作室的原话:**「不需要修复用户的模型,只需要完成磁铁孔」**。
 *
 * 跟另一句话是**同时成立**的:
 *
 * > 「不用装任何东西 —— 但模型不是封闭实体(有开放边 / 非流形边)时会切不了
 * > / 不要因为这个问题切不了」
 *
 * ⇒ **既要把孔切出来,又不能改用户的模型。**
 *
 * 所以这一层**只做「不改形状」的清理**(剔退化面 / 剔重复面 / 修绕序 /
 * 拆蝴蝶结顶点),**不再往模型里补面**。洞用**临时盖面**处理 ——
 * 盖面在 `magnet-lid.ts` 里生成,**只喂给布尔运算,切完就摘掉**
 * ⇒ 用户拿到的还是他自己的模型,破口还在那儿。
 *
 * ## Manifold3D 自己不会修
 *
 * 试过了(单测里跑真引擎):`Manifold.ofMesh()` 就是构造函数
 * (`ofMesh = function(mesh){return new Module.Manifold(mesh)}`),
 * **没有补洞、没有修法线**;除了 `ofMesh` 和 `levelSet`(SDF 那条路,
 * 几十万面根本跑不动)没有别的静态方法。所以清理**只能自己写**。
 *
 * ## 清理的是什么(照搬工作室那段 Blender 脚本的预处理)
 *
 * 工作室脚本自己就写了三步:`remove_doubles`(= 焊接)、
 * `quads_convert_to_tris`(用不上,本来就是三角面)、
 * `normals_make_consistent`(= 修绕序)。网页端把「焊接」那步接上了仓库的
 * `weldAndAnalyzeTopology()`,**另外两步自己补**。
 *
 * | 毛病 | 怎么处理 |
 * |---|---|
 * | 退化面(零面积 / 顶点重合) | **删掉**(manifold 收不了)—— 无效几何,不算改模型 |
 * | 重复面(同一组顶点) | **只留一张** —— 同一块皮贴了两遍 |
 * | 绕序不一致(有的面法线是翻着的) | **翻少数派那一侧**(见下面「绕序怎么修」)—— 只改法线方向,不改形状 |
 * | 整体朝内 | 交给仓库的 `buildCorrectedMesh` 逐壳翻(不在这一层做)—— 同上 |
 * | 开放边(有洞 / 有裂缝) | **不动** —— 交给临时盖面(`magnet-lid.ts`) |
 * | 非流形边(三个以上的面共用一条边) | **暂时剔掉多出来的面**(切完**放回去**)—— 见下 |
 * | 非流形顶点(蝴蝶结:两个壳只共一个顶点) | **给多出来的扇区一份私有顶点副本** —— 坐标一样,形状不变 |
 *
 * ## 非流形边剔掉的面要**放回去**
 *
 * 一条边上挤了三张以上的面(最常见的原因:两张面重复但绕序相反、或者一个
 * 「鳍」贴在主体边上)。布尔运算收不了 ⇒ 剔掉多出来的。
 *
 * **但那些面是用户模型的一部分** —— 切完必须**放回输出里**,不然用户的
 * 模型就少了一块。这一层把剔掉的面单独交出去(`droppedFaces`),调用方
 * 在导出时补回去。
 *
 * ## 临时盖面的方向(实测出来的,别改反)
 *
 * 边界环**顺着相邻面的走向**走一圈,右手定则算出来的法线指向**实体内部**
 * (立方体缺了 -X 面时,环是 0→3→7→4→0,算出来 +X = 朝着实体)⇒
 * **盖面必须用反过来那个环**(0→4→7→3→0,法线 -X = 朝外)。
 *
 * 实测:立方体缺 -X 面 + 反向盖面 ⇒ `volume = 8`(正好是立方体)✓。
 * 用正着的环盖 ⇒ manifold 抛 `Not manifold`。
 *
 * (这一段逻辑搬到了 `magnet-lid.ts` —— 盖面在那儿生成。)
 *
 * ## 绕序怎么修(XOR 约束)
 *
 * 一条边被两个面共用时,两个面必须**一个朝这头、一个朝那头**。
 * 设 `x_f ∈ {0,1}` = 面 f 要不要翻,则约束是
 *
 * ```
 * x_f1 ⊕ x_f2 = 1 ⊕ (d_f1 ⊕ d_f2)
 * ```
 *
 * 就是一个**异或约束图** ⇒ BFS 一遍就解出来了。解出来的解**唯一到
 * 「整体取反」为止** —— 所以「翻哪一侧」都行,取**人数少的那一侧**
 * (改动最小)。整组同色(本来就一致)⇒ 一个都不用翻。
 *
 * 仓库的 `weld.ts` 里也有一份同样的 BFS(统计「局部翻转面」用的),
 * 口径一致 —— 但它有一个缺口:`c0 === c1` 时它**一个都不翻**(平手就放弃),
 * 那一半的面还是翻着的 ⇒ 补洞的时候环的走向就是错的。
 * 这一层自己解,平手时翻 0 号那侧。
 *
 * ## 纯函数,不碰 manifold
 *
 * 这一层只跟「顶点 / 面」打交道 —— 布尔运算在下一层(manifold)做。
 * 所以它能进 `unit` project 跑单测,不用起 wasm。
 */

/** 顶点下标编码进边键用的步长 / 边键 / 边索引 —— 跟临时盖面那一层共用 */
import { buildEdgeIndex, countEdges, edgeKey } from "./magnet-lid";

/** 修网时要处理的输入(**焊接之后**的 indexed 网格) */
export interface MagnetRepairInput {
  /** 焊接后的顶点(3 个 float 一个) */
  vertices: Float32Array;
  /** 焊接后的面(3 个顶点下标一个面)—— 面序跟原始三角汤一致 */
  faceVertex: Uint32Array;
  /** 逐角 UV(每三角形 6 个 float)—— 可选 */
  uvs?: Float32Array | null;
  /** 逐面材质下标 —— 可选 */
  materialIndex?: Uint16Array | null;
}

/** 清理了什么 —— 给界面 / 日志看的 */
export interface MagnetRepairReport {
  /** 删掉的退化面(零面积 / 顶点重合) */
  droppedDegenerate: number;
  /** 删掉的重复面 */
  droppedDuplicate: number;
  /** 剔掉的「多出来的」非流形边上的面 —— **切完会放回输出里** */
  droppedNonManifold: number;
  /** 拆开的非流形顶点(蝴蝶结) */
  splitVertices: number;
  /** 翻了绕序的面 */
  flippedFaces: number;
  /**
   * **临时**盖面补上的边界环数量
   *
   * 盖面**只喂给布尔运算,切完就摘掉** ⇒ 用户的模型上**没有**多出
   * 任何几何(见 `magnet-lid.ts`)。
   */
  cappedLoops: number;
  /** 临时盖面用了几何三角形 */
  lidFaces: number;
  /** 清理之前的开放边 / 非流形边条数 */
  openEdgesBefore: number;
  nonManifoldEdgesBefore: number;
  /** 清理之后的开放边 / 非流形边条数 —— **这是用户模型自己的破口** */
  openEdgesAfter: number;
  nonManifoldEdgesAfter: number;
  /** 用户模型本身封闭吗(有洞就是 false) */
  closed: boolean;
  /**
   * 补上临时盖面之后能参与布尔运算吗
   *
   * `closed === false` 但 `closedForBoolean === true` 是**正常**的 ——
   * 意思是「模型有洞,但我们用临时盖面把它封上参与运算,切完再摘掉」。
   */
  closedForBoolean: boolean;
  /** 有没有真的动过手(没动过就不用重新焊接) */
  changed: boolean;
  /**
   * 焊接合并掉的顶点数(容差阶梯那一层 —— 见 `magnet-weld.ts`)
   *
   * **这是「不改动用户模型」的那一层** —— 焊掉的顶点本来就在那儿,
   * 只是差了 1e-4mm 被算成了两个点。
   */
  weldedVertices: number;
  /**
   * 其中**坐标不完全相同**的那些 —— 「模型里有几个点其实是同一个点,
   * 只是算出来差了一点」。**这才是界面上要摆的数**(三角汤天生就有
   * 大量完全重复的顶点,那个总数没什么信息量)。
   */
  weldedNearDuplicates: number;
  /** 焊接用的容差(mm)—— 0 = 一档都没用上 */
  weldToleranceMm: number;
}

/**
 * 被剔掉的面 —— 切完要**放回输出里**
 *
 * 非流形边上「多出来的」那些面是用户模型的一部分。布尔运算收不了它们
 * ⇒ 运算前剔掉,运算后**放回去** ⇒ 用户的模型不会少东西。
 */
export interface MagnetDroppedFaces {
  /** 三角汤(9 个 float 一个三角形) */
  positions: Float32Array;
  /** 逐角 UV(每三角形 6 个 float)—— 原模型没贴图时是 null */
  uvs: Float32Array | null;
  /** 逐面材质下标 —— 原模型没材质时是 null */
  materialIndex: Uint16Array | null;
}

/** 修完的结果 */
export interface MagnetRepairResult {
  /** 修好的三角汤(9 个 float 一个三角形) */
  positions: Float32Array;
  /** 逐角 UV(每三角形 6 个 float)—— 原模型没贴图时是 null */
  uvs: Float32Array | null;
  /** 逐面材质下标 —— 原模型没材质时是 null */
  materialIndex: Uint16Array | null;
  /** 被剔掉的面 —— 切完放回输出 */
  droppedFaces: MagnetDroppedFaces;
  /** 修了什么 */
  report: MagnetRepairReport;
}

/** 三角形叉积的长度(= 2 倍面积) */
function triArea2(pos: number[], a: number, b: number, c: number): number {
  const ax = pos[a * 3]!,
    ay = pos[a * 3 + 1]!,
    az = pos[a * 3 + 2]!;
  const bx = pos[b * 3]!,
    by = pos[b * 3 + 1]!,
    bz = pos[b * 3 + 2]!;
  const cx = pos[c * 3]!,
    cy = pos[c * 3 + 1]!,
    cz = pos[c * 3 + 2]!;
  const e1x = bx - ax,
    e1y = by - ay,
    e1z = bz - az;
  const e2x = cx - ax,
    e2y = cy - ay,
    e2z = cz - az;
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  return Math.sqrt(nx * nx + ny * ny + nz * nz);
}

/** 包围盒对角线 —— 面积阈值按它缩放 */
function bboxDiag(pos: number[]): number {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i + 2 < pos.length; i += 3) {
    const x = pos[i]!,
      y = pos[i + 1]!,
      z = pos[i + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const dx = maxX - minX,
    dy = maxY - minY,
    dz = maxZ - minZ;
  const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Number.isFinite(diag) && diag > 0 ? diag : 1;
}

/**
 * 面 → 壳(连通分量)
 *
 * 共用一条边的面算同一个壳。用来判断「非流形边上的几张面是不是同一个
 * 壳」—— 保留同一个壳上的那两张,别的删掉。
 */
function computeShells(
  faces: number[][],
  edgeIndex: Map<number, number[]>
): Int32Array {
  const n = faces.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => {
    let r = x;
    while (parent[r] !== r) r = parent[r]!;
    let c = x;
    while (parent[c] !== c) {
      const next = parent[c]!;
      parent[c] = r;
      c = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (const list of edgeIndex.values()) {
    for (let i = 1; i < list.length; i++) {
      union(list[0]! >>> 1, list[i]! >>> 1);
    }
  }
  const shell = new Int32Array(n);
  for (let i = 0; i < n; i++) shell[i] = find(i);
  return shell;
}

/**
 * 非流形边 —— **删掉多出来的面**
 *
 * 一条边上挤了三个以上的面(最常见的原因:两张面重复但绕序相反、
 * 或者一个「鳍」贴在主体边上)。做法:
 *
 * 1. 按**壳**给这些面分组 —— 同一个壳上的面优先保留
 * 2. 保留的那两张要**方向相反**(一个朝这头、一个朝那头)
 * 3. 别的面**剔掉**(但**记住它们** —— 切完要放回输出里)
 *
 * 剔掉之后那个位置会留个洞 ⇒ 后面「临时盖面」那一步会把它**临时**封上
 * (切完再摘掉 ⇒ 用户的模型上不会多出几何)。
 */
function resolveNonManifoldEdges(
  faces: number[][],
  keep: boolean[],
  edgeIndex: Map<number, number[]>,
  report: MagnetRepairReport
): number[] {
  const doomed = new Set<number>();
  const shell = computeShells(faces, edgeIndex);

  for (const list of edgeIndex.values()) {
    if (list.length <= 2) continue;
    const faceList = list.map((e) => e >>> 1);
    // 按壳分组
    const groups = new Map<number, number[]>();
    for (const f of faceList) {
      const s = shell[f]!;
      const g = groups.get(s);
      if (g) g.push(f);
      else groups.set(s, [f]);
    }
    // 挑一个组:面最多的那个(平手取壳号小的)
    let best: number[] | null = null;
    let bestShell = -1;
    for (const [s, g] of groups) {
      if (
        !best ||
        g.length > best.length ||
        (g.length === best.length && s < bestShell)
      ) {
        best = g;
        bestShell = s;
      }
    }
    if (!best) continue;

    // 在这个组里挑「方向相反」的两张
    const dirs = new Map<number, number>();
    for (const e of list) {
      const f = e >>> 1;
      if (!dirs.has(f)) dirs.set(f, e & 1);
    }
    const keepPair = new Set<number>();
    const first = best[0]!;
    keepPair.add(first);
    const firstDir = dirs.get(first) ?? 0;
    const opposite = best.find((f) => (dirs.get(f) ?? 0) !== firstDir);
    if (opposite !== undefined) keepPair.add(opposite);
    else if (best.length > 1) keepPair.add(best[1]!);

    for (const f of faceList) {
      if (!keepPair.has(f)) doomed.add(f);
    }
  }

  if (!doomed.size) return [];
  for (const f of doomed) {
    keep[f] = false;
    report.droppedNonManifold++;
  }
  return [...doomed].sort((a, b) => a - b);
}

/**
 * 把标记为「删掉」的面剔掉(面 / UV 槽位 / 材质一起走)
 *
 * 剔完**立刻**做 —— 边索引是从面表算出来的,留着被删的面会让它算错
 * (被删的面还占着边 ⇒ 边界边看起来不是边界边 ⇒ 补洞那一步找不到洞)。
 */
function compactFaces(
  faces: number[][],
  keep: boolean[],
  faceSlot: number[],
  faceMaterial: number[]
): void {
  let w = 0;
  for (let f = 0; f < faces.length; f++) {
    if (!keep[f]) continue;
    if (w !== f) {
      faces[w] = faces[f]!;
      faceSlot[w] = faceSlot[f] ?? -1;
      faceMaterial[w] = faceMaterial[f] ?? -1;
    }
    w++;
  }
  faces.length = w;
  faceSlot.length = w;
  faceMaterial.length = w;
  keep.length = w;
}

/**
 * 把顶点周围的邻接面分成若干**扇区**
 *
 * 两个面在同一个扇区 ⇔ 它们共享一条含该顶点的边。蝴蝶结顶点就是
 * 「一个顶点上有两个互不连通的扇区」。
 */
function collectFans(
  faces: number[][],
  edgeIndex: Map<number, number[]>,
  v: number,
  list: number[]
): number[][] {
  const seen = new Set<number>();
  const fans: number[][] = [];
  for (const seed of list) {
    if (seen.has(seed)) continue;
    const fan: number[] = [];
    const stack = [seed];
    seen.add(seed);
    while (stack.length) {
      const f = stack.pop()!;
      fan.push(f);
      const t = faces[f]!;
      for (let k = 0; k < 3; k++) {
        if (t[k] !== v && t[(k + 1) % 3] !== v) continue;
        const u = t[k]!;
        const w = t[(k + 1) % 3]!;
        const edge = edgeIndex.get(edgeKey(u, w));
        if (!edge) continue;
        for (const e of edge) {
          const g = e >>> 1;
          if (g === f || seen.has(g)) continue;
          // 邻居也得含 v
          if (!faces[g]!.includes(v)) continue;
          seen.add(g);
          stack.push(g);
        }
      }
    }
    fans.push(fan);
  }
  return fans;
}

/**
 * 非流形顶点(蝴蝶结)—— **给多出来的扇区一份私有顶点副本**
 *
 * 两个壳只共一个顶点(顶点坐标一样、但周围的扇区是分开的)⇒ manifold
 * 判它不是流形顶点。做法:按「共享含该顶点的边」把邻接面分成若干**扇区**,
 * 第一个扇区用原顶点,别的扇区各自拿一份**坐标相同的新顶点**。
 *
 * 拆完之后那两个壳彻底分开了 —— 各自还是封闭的壳 ⇒ manifold 收得了。
 *
 * ⚠️ **拆完不能再焊** —— 再焊会把坐标相同的那几份又合回去(蝴蝶结又回来)。
 * 所以这一步排在「再焊一次」**之后**(见 `splitMagnetVertices`)。
 */
export function splitMagnetVertices(input: {
  vertices: Float32Array;
  faceVertex: Uint32Array;
}): {
  vertices: Float32Array;
  faceVertex: Uint32Array;
  splitVertices: number;
} {
  const faceCount = input.faceVertex.length / 3;
  const faces: number[][] = [];
  for (let f = 0; f < faceCount; f++) {
    faces.push([
      input.faceVertex[f * 3]!,
      input.faceVertex[f * 3 + 1]!,
      input.faceVertex[f * 3 + 2]!,
    ]);
  }
  const pos = Array.from(input.vertices);
  const edgeIndex = buildEdgeIndex(faces);

  // 顶点 → 邻接面
  const vertFaces = new Map<number, number[]>();
  for (let f = 0; f < faces.length; f++) {
    const t = faces[f]!;
    for (let k = 0; k < 3; k++) {
      const v = t[k]!;
      const list = vertFaces.get(v);
      if (list) list.push(f);
      else vertFaces.set(v, [f]);
    }
  }

  let splitVertices = 0;
  for (const [v, list] of vertFaces) {
    if (list.length < 2) continue;
    const fans = collectFans(faces, edgeIndex, v, list);
    if (fans.length < 2) continue;

    // 第一个扇区用原顶点,别的扇区各拿一份副本
    for (let i = 1; i < fans.length; i++) {
      const copy = pos.length / 3;
      pos.push(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
      for (const f of fans[i]!) {
        const t = faces[f]!;
        for (let k = 0; k < 3; k++) {
          if (t[k] === v) t[k] = copy;
        }
      }
      splitVertices++;
    }
  }

  const outFaceVertex = new Uint32Array(faces.length * 3);
  faces.forEach((t, f) => {
    outFaceVertex[f * 3] = t[0]!;
    outFaceVertex[f * 3 + 1] = t[1]!;
    outFaceVertex[f * 3 + 2] = t[2]!;
  });

  return {
    vertices: new Float32Array(pos),
    faceVertex: outFaceVertex,
    splitVertices,
  };
}

/**
 * 修绕序 —— 异或约束 + BFS,翻人数少的那一侧
 *
 * 详见文件头「绕序怎么修」。
 *
 * 翻了绕序 ⇒ **UV 的角 1 / 角 2 也要对调**(UV 是逐角存的)。
 */
function fixWinding(
  faces: number[][],
  edgeIndex: Map<number, number[]>,
  faceSlot: number[],
  uvStore: number[],
  report: MagnetRepairReport
): boolean {
  const n = faces.length;
  const color = new Int8Array(n).fill(-1);
  let changed = false;

  for (let seed = 0; seed < n; seed++) {
    if (color[seed] !== -1) continue;
    const members: number[] = [];
    const stack = [seed];
    color[seed] = 0;
    while (stack.length) {
      const f = stack.pop()!;
      members.push(f);
      const myColor = color[f]!;
      const t = faces[f]!;
      for (let k = 0; k < 3; k++) {
        const u = t[k]!;
        const v = t[(k + 1) % 3]!;
        const list = edgeIndex.get(edgeKey(u, v));
        if (!list || list.length !== 2) continue;
        const myDir = u < v ? 0 : 1;
        let other = -1;
        let otherDir = 0;
        for (const e of list) {
          const g = e >>> 1;
          if (g === f) continue;
          other = g;
          otherDir = e & 1;
          break;
        }
        if (other < 0 || color[other] !== -1) continue;
        // 方向相反 ⇒ 两张面要「翻一样」(x1 ⊕ x2 = 0)
        // 方向相同   ⇒ 两张面要「翻不一样」(x1 ⊕ x2 = 1)
        color[other] = myDir !== otherDir ? myColor : 1 - myColor;
        stack.push(other);
      }
    }

    let c0 = 0;
    let c1 = 0;
    for (const f of members) {
      if (color[f] === 0) c0++;
      else c1++;
    }
    // 整组同色 ⇒ 这一组本来就绕序一致(只是可能整体朝内)—— 整体朝向
    // 交给仓库的 `buildCorrectedMesh` 逐壳处理,这里不动
    if (c0 === 0 || c1 === 0) continue;
    // 两侧都能满足约束,取人数少的那一侧(改动最小)
    // ⚠️ 平手(c0 === c1)也照样翻 —— 仓库那份 BFS 在平手时**一个都不翻**,
    // 那一半的面还是翻着的 ⇒ 补洞时环的走向就是错的。
    const flipColor = c1 < c0 ? 1 : 0;
    for (const f of members) {
      if (color[f] !== flipColor) continue;
      const t = faces[f]!;
      const tmp = t[1]!;
      t[1] = t[2]!;
      t[2] = tmp;
      // UV 的角 1 / 角 2 对调
      const slot = faceSlot[f];
      if (slot !== undefined && slot >= 0) {
        const u1 = uvStore[slot * 6 + 2] ?? 0;
        const v1 = uvStore[slot * 6 + 3] ?? 0;
        uvStore[slot * 6 + 2] = uvStore[slot * 6 + 4] ?? 0;
        uvStore[slot * 6 + 3] = uvStore[slot * 6 + 5] ?? 0;
        uvStore[slot * 6 + 4] = u1;
        uvStore[slot * 6 + 5] = v1;
      }
      report.flippedFaces++;
      changed = true;
    }
  }
  return changed;
}

/**
 * 清网(阶段 A)—— 把「不是封闭实体」的模型清理成能参与布尔运算的流形
 *
 * 输入是**焊接之后**的 indexed 网格(仓库 `weldAndAnalyzeTopology()` 的
 * 输出),输出是**清理好的三角汤**(+ 对齐的 UV / 材质)+ 被剔掉的面。
 *
 * 这一阶段**不拆蝴蝶结顶点** —— 拆出来的那几份顶点坐标一样,调用方
 * 拿到结果要**再焊一次**(焊接会再算一遍拓扑:壳 / 整体朝向 / 退化标记),
 * 而再焊会把拆开的那几份又合回去 ⇒ 拆顶点得排在再焊**之后**
 * (见 `splitMagnetVertices`)。
 *
 * 这一阶段**不补洞** —— 洞交给 `magnet-lid.ts` 的**临时盖面**
 * (只喂给布尔运算,切完就摘掉 ⇒ 用户的模型上不会多出几何)。
 *
 * 调用方拿到的三角汤可以直接喂给 `weldAndAnalyzeTopology()`。
 */
export function repairMagnetGeometry(
  input: MagnetRepairInput
): MagnetRepairResult {
  const report: MagnetRepairReport = {
    droppedDegenerate: 0,
    droppedDuplicate: 0,
    droppedNonManifold: 0,
    splitVertices: 0,
    flippedFaces: 0,
    cappedLoops: 0,
    lidFaces: 0,
    openEdgesBefore: 0,
    nonManifoldEdgesBefore: 0,
    openEdgesAfter: 0,
    nonManifoldEdgesAfter: 0,
    closed: false,
    closedForBoolean: false,
    changed: false,
    weldedVertices: 0,
    weldedNearDuplicates: 0,
    weldToleranceMm: 0,
  };

  const srcFaces = input.faceVertex;
  const srcFaceCount = srcFaces.length / 3;

  // 顶点表(可以加副本)
  const pos: number[] = Array.from(input.vertices);
  const diag = bboxDiag(pos);
  const areaEps = 1e-9 * diag * diag;

  // 面表 + 每张面的 UV 槽位 / 材质
  const faces: number[][] = [];
  const keep: boolean[] = [];
  const faceSlot: number[] = [];
  const faceMaterial: number[] = [];
  const uvStore: number[] = [];
  const seenTri = new Set<string>();

  const srcUvs = input.uvs ?? null;
  const srcMaterial = input.materialIndex ?? null;

  for (let f = 0; f < srcFaceCount; f++) {
    const a = srcFaces[f * 3]!;
    const b = srcFaces[f * 3 + 1]!;
    const c = srcFaces[f * 3 + 2]!;
    if (a === b || b === c || a === c) {
      report.droppedDegenerate++;
      continue;
    }
    if (triArea2(pos, a, b, c) <= areaEps) {
      report.droppedDegenerate++;
      continue;
    }
    // 重复面:同一组顶点(顺序不同也算)只留第一张
    const sorted = [a, b, c].sort((x, y) => x - y);
    const key = `${sorted[0]}_${sorted[1]}_${sorted[2]}`;
    if (seenTri.has(key)) {
      report.droppedDuplicate++;
      continue;
    }
    seenTri.add(key);
    faces.push([a, b, c]);
    keep.push(true);
    faceSlot.push(f);
    if (srcUvs) {
      for (let k = 0; k < 6; k++) uvStore.push(srcUvs[f * 6 + k] ?? 0);
    }
    faceMaterial.push(srcMaterial ? (srcMaterial[f] ?? 0) : -1);
  }

  if (!faces.length) {
    return {
      positions: new Float32Array(0),
      uvs: null,
      materialIndex: null,
      droppedFaces: emptyDroppedFaces(),
      report,
    };
  }

  let edgeIndex = buildEdgeIndex(faces);
  const before = countEdges(edgeIndex);
  report.openEdgesBefore = before.open;
  report.nonManifoldEdgesBefore = before.nonManifold;

  // ① 非流形边 —— 剔掉多出来的面(**记住它们**,切完放回输出)
  const doomed = resolveNonManifoldEdges(faces, keep, edgeIndex, report);
  let droppedFaces = emptyDroppedFaces();
  if (doomed.length) {
    droppedFaces = captureDroppedFaces(
      faces,
      doomed,
      pos,
      faceSlot,
      faceMaterial,
      uvStore,
      srcUvs !== null,
      srcMaterial !== null
    );
    // ⚠️ **立刻剔掉** —— 边索引是从面表算出来的,留着被删的面会让它算错
    compactFaces(faces, keep, faceSlot, faceMaterial);
    edgeIndex = buildEdgeIndex(faces);
  }

  // ② 绕序 —— 异或约束 BFS,翻人数少的那一侧
  if (fixWinding(faces, edgeIndex, faceSlot, uvStore, report)) {
    edgeIndex = buildEdgeIndex(faces);
  }

  // ③ 出料(被剔掉的面在 ① 里已经剔走了,单独交出去)
  const outFaces = faces;
  const outSlots = faceSlot;
  const outMaterials = faceMaterial;

  const after = countEdges(edgeIndex);
  report.openEdgesAfter = after.open;
  report.nonManifoldEdgesAfter = after.nonManifold;
  report.closed = after.open === 0 && after.nonManifold === 0;
  // 补上临时盖面之后能不能参与布尔 —— 调用方填(`magnet-lid.ts` 那边)
  report.closedForBoolean = false;
  report.changed =
    report.droppedDegenerate > 0 ||
    report.droppedDuplicate > 0 ||
    report.droppedNonManifold > 0 ||
    report.splitVertices > 0 ||
    report.flippedFaces > 0;

  // 输出三角汤
  const outPositions = new Float32Array(outFaces.length * 9);
  const outUvs = srcUvs ? new Float32Array(outFaces.length * 6) : null;
  const outMaterial = srcMaterial ? new Uint16Array(outFaces.length) : null;

  for (let f = 0; f < outFaces.length; f++) {
    const t = outFaces[f]!;
    for (let k = 0; k < 3; k++) {
      const v = t[k]!;
      outPositions[f * 9 + k * 3] = pos[v * 3]!;
      outPositions[f * 9 + k * 3 + 1] = pos[v * 3 + 1]!;
      outPositions[f * 9 + k * 3 + 2] = pos[v * 3 + 2]!;
    }
    const slot = outSlots[f];
    if (outUvs && slot !== undefined && slot >= 0) {
      for (let k = 0; k < 6; k++) {
        outUvs[f * 6 + k] = uvStore[slot * 6 + k] ?? 0;
      }
    }
    if (outMaterial) {
      outMaterial[f] = Math.max(0, outMaterials[f] ?? 0);
    }
  }

  return {
    positions: outPositions,
    uvs: outUvs,
    materialIndex: outMaterial,
    droppedFaces,
    report,
  };
}

/** 空的「被剔掉的面」 */
function emptyDroppedFaces(): MagnetDroppedFaces {
  return {
    positions: new Float32Array(0),
    uvs: null,
    materialIndex: null,
  };
}

/**
 * 把被剔掉的面**单独记一份** —— 切完要放回输出里
 *
 * 用户模型上的这些面是**真几何**(比如贴在主体边上的一片「鳍」)——
 * 布尔运算收不了它们,运算前得剔掉;但**不能让用户的模型少东西** ⇒
 * 运算后原样放回去。
 */
function captureDroppedFaces(
  faces: number[][],
  doomed: number[],
  pos: number[],
  faceSlot: number[],
  faceMaterial: number[],
  uvStore: number[],
  hasUvs: boolean,
  hasMaterial: boolean
): MagnetDroppedFaces {
  const positions = new Float32Array(doomed.length * 9);
  const uvs = hasUvs ? new Float32Array(doomed.length * 6) : null;
  const materialIndex = hasMaterial ? new Uint16Array(doomed.length) : null;

  doomed.forEach((f, i) => {
    const t = faces[f];
    if (!t) return;
    for (let k = 0; k < 3; k++) {
      const v = t[k]!;
      positions[i * 9 + k * 3] = pos[v * 3]!;
      positions[i * 9 + k * 3 + 1] = pos[v * 3 + 1]!;
      positions[i * 9 + k * 3 + 2] = pos[v * 3 + 2]!;
    }
    const slot = faceSlot[f];
    if (uvs && slot !== undefined && slot >= 0) {
      for (let k = 0; k < 6; k++) {
        uvs[i * 6 + k] = uvStore[slot * 6 + k] ?? 0;
      }
    }
    if (materialIndex) {
      materialIndex[i] = Math.max(0, faceMaterial[f] ?? 0);
    }
  });

  return { positions, uvs, materialIndex };
}
