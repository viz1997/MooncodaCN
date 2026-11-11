/**
 * 磁吸孔切割的网格修复 —— 让「不是封闭实体」的模型也能切
 *
 * ## 为什么需要这一层(2026-11-11)
 *
 * 工作室的原话:**「不用装任何东西 —— 但模型不是封闭实体(有开放边 /
 * 非流形边)时会切不了 / 不要因为这个问题切不了」**。
 *
 * 也就是说:**浏览器那条路不许因为「模型不是封闭实体」就拒绝切割。**
 *
 * ## Manifold3D 自己不会修
 *
 * 试过了(单测里跑真引擎):`Manifold.ofMesh()` 就是构造函数
 * (`ofMesh = function(mesh){return new Module.Manifold(mesh)}`),
 * **没有补洞、没有修法线**;除了 `ofMesh` 和 `levelSet`(SDF 那条路,
 * 几十万面根本跑不动)没有别的静态方法。所以修复**只能自己写**。
 *
 * ## 修的是什么(照搬工作室那段 Blender 脚本的预处理)
 *
 * 工作室脚本自己就写了三步:`remove_doubles`(= 焊接)、
 * `quads_convert_to_tris`(用不上,本来就是三角面)、
 * `normals_make_consistent`(= 修绕序)。网页端把「焊接」那步接上了仓库的
 * `weldAndAnalyzeTopology()`,**另外两步自己补**,再加一步脚本没有的:
 * **补洞**。
 *
 * | 毛病 | 怎么修 |
 * |---|---|
 * | 退化面(零面积 / 顶点重合) | **删掉**(manifold 收不了) |
 * | 重复面(同一组顶点) | **只留一张** |
 * | 绕序不一致(有的面法线是翻着的) | **翻少数派那一侧**(见下面「绕序怎么修」) |
 * | 整体朝内 | 交给仓库的 `buildCorrectedMesh` 逐壳翻(不在这一层做) |
 * | 开放边(有洞 / 有裂缝) | **补面**:把边界环翻过来做耳切三角化 |
 * | 非流形边(三个以上的面共用一条边) | **删掉多出来的面**,保留同一个壳上的那两张 |
 * | 非流形顶点(蝴蝶结:两个壳只共一个顶点) | **给多出来的扇区一份私有顶点副本** |
 *
 * ## 补面的方向(实测出来的,别改反)
 *
 * 边界环**顺着相邻面的走向**走一圈,它的法线指向**实体内部**
 * (立方体缺了 -X 面时,环是 0→3→7→4→0,右手定则算出 +X = 朝着实体)⇒
 * **盖面必须用反过来那个环**(0→4→7→3→0,法线 -X = 朝外)。
 *
 * 实测:立方体缺 -X 面 + 反向盖面 ⇒ `volume = 8`(正好是立方体)✓。
 * 用正着的环盖 ⇒ manifold 抛 `Not manifold`。
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

/** 顶点下标编码进边键用的步长(下标 < 2^24 ⇒ 键不会撞) */
const EDGE_STRIDE = 1 << 24;

/** 边键 —— 无向边 (a,b) */
function edgeKey(a: number, b: number): number {
  return a < b ? a * EDGE_STRIDE + b : b * EDGE_STRIDE + a;
}

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

/** 修了什么 —— 给界面 / 日志看的 */
export interface MagnetRepairReport {
  /** 删掉的退化面(零面积 / 顶点重合) */
  droppedDegenerate: number;
  /** 删掉的重复面 */
  droppedDuplicate: number;
  /** 删掉的「多出来的」非流形边上的面 */
  droppedNonManifold: number;
  /** 拆开的非流形顶点(蝴蝶结) */
  splitVertices: number;
  /** 翻了绕序的面 */
  flippedFaces: number;
  /** 补上的洞(边界环 / 裂缝链) */
  filledLoops: number;
  /** 补洞用了几何三角形 */
  capFaces: number;
  /** 修之前的开放边 / 非流形边条数 */
  openEdgesBefore: number;
  nonManifoldEdgesBefore: number;
  /** 修之后的开放边 / 非流形边条数 */
  openEdgesAfter: number;
  nonManifoldEdgesAfter: number;
  /** 修完之后封闭了吗 */
  closed: boolean;
  /** 有没有真的动过手(没动过就不用重新焊接) */
  changed: boolean;
}

/** 修完的结果 */
export interface MagnetRepairResult {
  /** 修好的三角汤(9 个 float 一个三角形) */
  positions: Float32Array;
  /** 逐角 UV(每三角形 6 个 float)—— 原模型没贴图时是 null */
  uvs: Float32Array | null;
  /** 逐面材质下标 —— 原模型没材质时是 null */
  materialIndex: Uint16Array | null;
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
 * 边索引 —— 边键 → 该边上的面
 *
 * 元素编码成 `面号 * 2 + 方向位`:方向位 0 = 顺着 min→max 走,1 = 顺着
 * max→min 走。跟仓库 `weld.ts` 的编码一致。
 */
function buildEdgeIndex(faces: number[][]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (let f = 0; f < faces.length; f++) {
    const t = faces[f]!;
    for (let k = 0; k < 3; k++) {
      const u = t[k]!;
      const v = t[(k + 1) % 3]!;
      if (u === v) continue;
      const key = edgeKey(u, v);
      const dir = u < v ? 0 : 1;
      const list = map.get(key);
      if (list) list.push(f * 2 + dir);
      else map.set(key, [f * 2 + dir]);
    }
  }
  return map;
}

/** 统计开放边 / 非流形边条数 */
function countEdges(edgeIndex: Map<number, number[]>): {
  open: number;
  nonManifold: number;
} {
  let open = 0;
  let nonManifold = 0;
  for (const list of edgeIndex.values()) {
    if (list.length === 1) open++;
    else if (list.length > 2) nonManifold++;
  }
  return { open, nonManifold };
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
 * 3. 别的面**删掉**
 *
 * 删掉之后那个位置会留个洞 ⇒ 后面「补洞」那一步会把它补上。
 */
function resolveNonManifoldEdges(
  faces: number[][],
  keep: boolean[],
  edgeIndex: Map<number, number[]>,
  report: MagnetRepairReport
): boolean {
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

  if (!doomed.size) return false;
  for (const f of doomed) {
    keep[f] = false;
    report.droppedNonManifold++;
  }
  return true;
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
 * 补洞 —— 把边界环 / 裂缝链封上
 *
 * ## 方向(实测出来的,别改反)
 *
 * 边界环**顺着相邻面的走向**走一圈,右手定则算出来的法线指向**实体内部**
 * ⇒ 盖面必须用**反过来**那个环。
 *
 * ## 怎么把环变成三角形
 *
 * 投影到最佳拟合平面上做**耳切**(能处理凹多边形);耳切不出来(多边形
 * 自交 / 退化)就退回**扇形** —— 扇形可能切出多边形外的三角形,但至少
 * **是流形的**(几何对不对是另一回事,布尔那一步还会再检查体积)。
 */
function fillBoundaryLoops(
  faces: number[][],
  pos: number[],
  edgeIndex: Map<number, number[]>,
  faceSlot: number[],
  uvStore: number[],
  faceMaterial: number[],
  report: MagnetRepairReport
): boolean {
  // 边界边(只被一个面用到)+ 它的「走向」
  const boundary = new Map<
    number,
    { face: number; from: number; to: number }
  >();
  for (const [key, list] of edgeIndex) {
    if (list.length !== 1) continue;
    const e = list[0]!;
    const face = e >>> 1;
    const dir = e & 1;
    const u = Math.floor(key / EDGE_STRIDE);
    const v = key % EDGE_STRIDE;
    // dir 0 = 顺着 min→max 走
    boundary.set(
      key,
      dir === 0 ? { face, from: u, to: v } : { face, from: v, to: u }
    );
  }
  if (!boundary.size) return false;

  // 顶点 → 从它出发的边界边
  const outgoing = new Map<number, number[]>();
  for (const [key, info] of boundary) {
    const list = outgoing.get(info.from);
    if (list) list.push(key);
    else outgoing.set(info.from, [key]);
  }

  const used = new Set<number>();
  let changed = false;

  for (const startKey of boundary.keys()) {
    if (used.has(startKey)) continue;
    const start = boundary.get(startKey)!;
    used.add(startKey);

    // 顺着走向把环 / 链走完
    //
    // ⚠️ `outFaces[i]` = 边 (seq[i] → seq[i+1]) 所在的面 —— 借 UV 用
    // ⚠️ 第一条边已经走过了 ⇒ 从它的**终点**接着走
    const seq: number[] = [start.from];
    const outFaces: number[] = [start.face];
    let cur = start.to;
    const guard = boundary.size + 2;
    for (let step = 0; step < guard; step++) {
      const candidates = outgoing.get(cur);
      let nextKey = -1;
      if (candidates) {
        for (const k of candidates) {
          if (used.has(k)) continue;
          nextKey = k;
          break;
        }
      }
      if (nextKey === -1) {
        // 链走到头了 —— 最后一个顶点也记下来(它没有后继边)
        if (seq[seq.length - 1] !== cur) {
          seq.push(cur);
          outFaces.push(-1);
        }
        break;
      }
      used.add(nextKey);
      const info = boundary.get(nextKey)!;
      if (info.to === seq[0]) {
        // 走回第一个顶点 ⇒ 环闭合(`cur` 是环上最后一个顶点)
        seq.push(cur);
        outFaces.push(info.face);
        break;
      }
      // `cur` 落定 —— 它后面那条边就是刚找到的这条
      seq.push(cur);
      outFaces.push(info.face);
      cur = info.to;
    }

    if (seq.length < 3) {
      // 一条边都凑不出三角形 —— 没法补(留着,后面会报「还是不封闭」)
      continue;
    }

    // 盖面用的是**反过来**那个环
    const loop = seq.slice().reverse();
    const loopFaces = outFaces.slice().reverse();

    // 每个环顶点从相邻的边界面借一个 UV
    const uvByVertex = new Map<number, number[]>();
    for (let i = 0; i < loop.length; i++) {
      const vertex = loop[i]!;
      if (uvByVertex.has(vertex)) continue;
      // 这个顶点相邻的两张边界面(环边**起点**那张 + **终点**那张)
      const candidates = [
        loopFaces[(i + 1) % loop.length],
        loopFaces[i],
        loopFaces[0],
      ];
      for (const face of candidates) {
        if (face === undefined) continue;
        const slot = faceSlot[face];
        if (slot === undefined || slot < 0) continue;
        const t = faces[face]!;
        // 找这个顶点在那个面里的角号
        const k = t.indexOf(vertex);
        if (k < 0) continue;
        uvByVertex.set(vertex, [
          uvStore[slot * 6 + k * 2] ?? 0,
          uvStore[slot * 6 + k * 2 + 1] ?? 0,
        ]);
        break;
      }
    }

    const tris = triangulateLoop(loop, pos);
    if (!tris.length) continue;

    const material = faceMaterial[loopFaces[0] ?? 0] ?? -1;
    for (const tri of tris) {
      const t: number[] = [loop[tri[0]!]!, loop[tri[1]!]!, loop[tri[2]!]!];
      faces.push(t);
      // 新面没有原始 UV —— 借边界面的;没有贴图就填 0
      const slot = uvStore.length / 6;
      for (let k = 0; k < 3; k++) {
        const uv = uvByVertex.get(t[k]!) ?? [0, 0];
        uvStore.push(uv[0]!, uv[1]!);
      }
      faceSlot.push(slot);
      faceMaterial.push(material);
      report.capFaces++;
    }
    report.filledLoops++;
    changed = true;
  }

  return changed;
}

/**
 * 环 → 三角形(耳切,不行就扇形)
 *
 * 投影到最佳拟合平面(用环自己的 Newell 法线)⇒ 投影保持朝向 ⇒ 耳切出来
 * 的三角形跟环的走向一致。
 *
 * 返回的三角形里装的是**环内的下标**(不是顶点号)。
 */
function triangulateLoop(loop: number[], pos: number[]): number[][] {
  const n = loop.length;
  if (n < 3) return [];

  // Newell 法线(按环的**给定走向**算)
  let nx = 0,
    ny = 0,
    nz = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % n]!;
    nx +=
      (pos[a * 3 + 1]! - pos[b * 3 + 1]!) * (pos[a * 3 + 2]! + pos[b * 3 + 2]!);
    ny += (pos[a * 3 + 2]! - pos[b * 3 + 2]!) * (pos[a * 3]! + pos[b * 3]!);
    nz += (pos[a * 3]! - pos[b * 3]!) * (pos[a * 3 + 1]! + pos[b * 3 + 1]!);
  }
  const nlen = Math.hypot(nx, ny, nz);
  if (!Number.isFinite(nlen) || nlen < 1e-12) {
    // 法线算不出来(环退化)⇒ 退回扇形
    return fanTriangulate(n);
  }
  nx /= nlen;
  ny /= nlen;
  nz /= nlen;

  // 右手基底 (u, v, n)
  let ux: number, uy: number, uz: number;
  if (Math.abs(nz) < 0.9) {
    ux = -ny;
    uy = nx;
    uz = 0;
  } else {
    ux = 0;
    uy = -nz;
    uz = ny;
  }
  const ulen = Math.hypot(ux, uy, uz) || 1;
  ux /= ulen;
  uy /= ulen;
  uz /= ulen;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;

  // 投影
  const flat: number[] = [];
  for (const vert of loop) {
    const dx = pos[vert * 3]!;
    const dy = pos[vert * 3 + 1]!;
    const dz = pos[vert * 3 + 2]!;
    flat.push(dx * ux + dy * uy + dz * uz, dx * vx + dy * vy + dz * vz);
  }

  // 有向面积 —— 负的话说明环在 2D 里是顺时针,耳切要逆时针
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += flat[i * 2]! * flat[j * 2 + 1]! - flat[j * 2]! * flat[i * 2 + 1]!;
  }
  const reversed = area2 < 0;

  // 耳切要在**逆时针**的多边形上做 ⇒ 顺时针时把下标顺序反过来
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(reversed ? n - 1 - i : i);

  let ears = earClip(flat, order);
  if (!ears) ears = fanTriangulate(n);

  // 映射回环内的下标;顺序反过的时候把三角形也反一下(保持环的走向)
  return ears.map((tri) => {
    const a = order[tri[0]!]!;
    const b = order[tri[1]!]!;
    const c = order[tri[2]!]!;
    return reversed ? [a, c, b] : [a, b, c];
  });
}

/** 扇形三角化 —— 耳切失败时的兜底(几何可能不准,但一定是流形) */
function fanTriangulate(n: number): number[][] {
  if (n < 3) return [];
  const tris: number[][] = [];
  for (let i = 1; i + 1 < n; i++) {
    tris.push([0, i, i + 1]);
  }
  return tris;
}

/**
 * 耳切(2D,逆时针多边形)
 *
 * `order` 是参与三角化的下标顺序(逆时针)。返回三角形里的下标是
 * **`order` 里的位置**,不是原始下标 —— 调用方自己映射回去。
 */
function earClip(flat: number[], order: number[]): number[][] | null {
  const n = order.length;
  if (n < 3) return null;
  if (n === 3) return [[0, 1, 2]];

  const idx = order.slice();
  const posInOrder = new Map<number, number>();
  order.forEach((v, i) => {
    posInOrder.set(v, i);
  });
  const tris: number[][] = [];
  let guard = n * n + 16;

  while (idx.length > 3 && guard-- > 0) {
    let ear = -1;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k - 1 + idx.length) % idx.length]!;
      const i1 = idx[k]!;
      const i2 = idx[(k + 1) % idx.length]!;
      if (!isEar(flat, idx, i0, i1, i2)) continue;
      ear = k;
      tris.push([
        posInOrder.get(i0)!,
        posInOrder.get(i1)!,
        posInOrder.get(i2)!,
      ]);
      break;
    }
    if (ear === -1) return null;
    idx.splice(ear, 1);
  }
  if (idx.length === 3) {
    tris.push([
      posInOrder.get(idx[0]!)!,
      posInOrder.get(idx[1]!)!,
      posInOrder.get(idx[2]!)!,
    ]);
  }
  return tris;
}

/** (i0,i1,i2) 是不是一只耳朵 —— 凸的,而且不含别的顶点 */
function isEar(
  flat: number[],
  idx: number[],
  i0: number,
  i1: number,
  i2: number
): boolean {
  const ax = flat[i0 * 2]!,
    ay = flat[i0 * 2 + 1]!;
  const bx = flat[i1 * 2]!,
    by = flat[i1 * 2 + 1]!;
  const cx = flat[i2 * 2]!,
    cy = flat[i2 * 2 + 1]!;
  // 凸性(逆时针 ⇒ 叉积 > 0)
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (cross <= 0) return false;
  for (const j of idx) {
    if (j === i0 || j === i1 || j === i2) continue;
    if (
      pointInTriangle(flat[j * 2]!, flat[j * 2 + 1]!, ax, ay, bx, by, cx, cy)
    ) {
      return false;
    }
  }
  return true;
}

/** 点在三角形里吗(含边界) */
function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * 修网(阶段 A)—— 把「不是封闭实体」的模型修成能参与布尔运算的流形
 *
 * 输入是**焊接之后**的 indexed 网格(仓库 `weldAndAnalyzeTopology()` 的
 * 输出),输出是**修好的三角汤**(+ 对齐的 UV / 材质)。
 *
 * 这一阶段**不拆蝴蝶结顶点** —— 拆出来的那几份顶点坐标一样,调用方
 * 拿到结果要**再焊一次**(焊接会再算一遍拓扑:壳 / 整体朝向 / 退化标记),
 * 而再焊会把拆开的那几份又合回去 ⇒ 拆顶点得排在再焊**之后**
 * (见 `splitMagnetVertices`)。
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
    filledLoops: 0,
    capFaces: 0,
    openEdgesBefore: 0,
    nonManifoldEdgesBefore: 0,
    openEdgesAfter: 0,
    nonManifoldEdgesAfter: 0,
    closed: false,
    changed: false,
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
      report,
    };
  }

  let edgeIndex = buildEdgeIndex(faces);
  const before = countEdges(edgeIndex);
  report.openEdgesBefore = before.open;
  report.nonManifoldEdgesBefore = before.nonManifold;

  // ① 非流形边 —— 删掉多出来的面
  if (resolveNonManifoldEdges(faces, keep, edgeIndex, report)) {
    // ⚠️ **立刻剔掉** —— 边索引是从面表算出来的,留着被删的面会让它算错
    compactFaces(faces, keep, faceSlot, faceMaterial);
    edgeIndex = buildEdgeIndex(faces);
  }

  // ② 绕序 —— 异或约束 BFS,翻人数少的那一侧
  if (fixWinding(faces, edgeIndex, faceSlot, uvStore, report)) {
    edgeIndex = buildEdgeIndex(faces);
  }

  // ③ 补洞
  if (
    fillBoundaryLoops(
      faces,
      pos,
      edgeIndex,
      faceSlot,
      uvStore,
      faceMaterial,
      report
    )
  ) {
    edgeIndex = buildEdgeIndex(faces);
  }

  // ④ 出料(被删的面在 ① 里已经剔掉了)
  const outFaces = faces;
  const outSlots = faceSlot;
  const outMaterials = faceMaterial;

  const after = countEdges(edgeIndex);
  report.openEdgesAfter = after.open;
  report.nonManifoldEdgesAfter = after.nonManifold;
  report.closed = after.open === 0 && after.nonManifold === 0;
  report.changed =
    report.droppedDegenerate > 0 ||
    report.droppedDuplicate > 0 ||
    report.droppedNonManifold > 0 ||
    report.splitVertices > 0 ||
    report.flippedFaces > 0 ||
    report.capFaces > 0;

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
    report,
  };
}
