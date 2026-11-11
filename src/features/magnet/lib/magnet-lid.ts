/**
 * 临时盖面(lid)—— 让「不是封闭实体」的模型也能参与布尔运算,
 * 但**不往用户的模型里加东西**
 *
 * ## 为什么要有这一层(2026-11-11)
 *
 * 工作室的原话:**「不需要修复用户的模型,只需要完成磁铁孔」**。
 *
 * 早先的做法是**把洞补上** —— 给每条边界环生成一张盖面,留在模型里。那
 * 等于**往用户的模型里塞了几张本来不存在的面**:导出来的模型上多了一块
 * 几何,工作室一看就知道「你们动过我的模型」。而那条要求跟工作室另一句
 * 话是**同时成立**的:
 *
 * > 「不用装任何东西 —— 但模型不是封闭实体(有开放边 / 非流形边)时会切不了
 * > / 不要因为这个问题切不了」
 *
 * ⇒ **既要把孔切出来,又不能改用户的模型。**
 *
 * ## 现在的做法:盖面是**临时**的
 *
 * ```
 * 1. 找出模型上的边界环(洞 / 裂缝)
 * 2. 给每条环生成一张**临时盖面**(几何跟真盖面一样,法线朝外)
 * 3. 拿「模型 + 临时盖面」去参与布尔运算
 * 4. **切完把盖面从结果里摘掉**
 * ```
 *
 * 用户拿到的还是他自己的模型 —— 只是多了一个磁吸孔,破口**还在那儿**。
 *
 * ## 盖面怎么认出来(切完要精确摘掉)
 *
 * 盖面在网格输入里是**单独一个 run**(单独一个预留 id)⇒ 布尔之后靠
 * **run id** 就能精确地把它认出来摘掉 —— 不靠「位置对不对得上」那种
 * 猜法(布尔会把面拆开、挪顶点,位置对不上)。
 *
 * ## 盖面的方向(实测出来的,别改反)
 *
 * 边界环**顺着相邻面的走向**走一圈,右手定则算出来的法线指向**实体内部**
 * (立方体缺了 -X 面时,环是 0→3→7→4→0,算出来 +X = 朝着实体)⇒
 * **盖面必须用反过来那个环**(0→4→7→3→0,法线 -X = 朝外)。
 *
 * 实测:立方体缺 -X 面 + 反向盖面 ⇒ `volume = 8`(正好是立方体)✓。
 * 用正着的环盖 ⇒ manifold 抛 `Not manifold`。
 *
 * ## 纯函数,不碰 manifold
 *
 * 这一层只跟「顶点 / 面」打交道 —— 布尔运算在下一层(manifold)做。
 * 所以它能进 `unit` project 跑单测,不用起 wasm。
 */

/** 顶点下标编码进边键用的步长(下标 < 2^24 ⇒ 键不会撞) */
export const EDGE_STRIDE = 1 << 24;

/** 边键 —— 无向边 (a,b) */
export function edgeKey(a: number, b: number): number {
  return a < b ? a * EDGE_STRIDE + b : b * EDGE_STRIDE + a;
}

/**
 * 边索引 —— 边键 → 该边上的面
 *
 * 元素编码成 `面号 * 2 + 方向位`:方向位 0 = 顺着 min→max 走,1 = 顺着
 * max→min 走。跟仓库 `weld.ts` 的编码一致。
 */
export function buildEdgeIndex(faces: number[][]): Map<number, number[]> {
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
export function countEdges(edgeIndex: Map<number, number[]>): {
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

/** 边界扫描的结果 */
export interface MagnetBoundaryScan {
  /**
   * 边界环(顶点下标)—— **顺着相邻面的走向**
   *
   * 盖面要用**反过来**的环(见文件头「盖面的方向」)。
   */
  loops: number[][];
  /** 开放边条数(只被一张面用到的边) */
  openEdges: number;
  /** 非流形边条数(三个以上的面共用一条边) */
  nonManifoldEdges: number;
  /** 进了环的边条数 —— 跟 `openEdges` 比就知道有没有封不上的破口 */
  cappedEdges: number;
}

/**
 * 扫边界 —— 找出模型上的洞 / 裂缝
 *
 * 输入是**三角汤的顶点下标**(每 3 个一个三角形)。退化面(顶点重合)
 * 调用方自己先剔掉 —— 这里不判断面积。
 */
export function scanMagnetBoundary(
  faceVertex: Uint32Array | number[]
): MagnetBoundaryScan {
  const faces: number[][] = [];
  const count = faceVertex.length / 3;
  for (let f = 0; f < count; f++) {
    faces.push([
      faceVertex[f * 3]!,
      faceVertex[f * 3 + 1]!,
      faceVertex[f * 3 + 2]!,
    ]);
  }

  const edgeIndex = buildEdgeIndex(faces);
  const { open, nonManifold } = countEdges(edgeIndex);

  // 边界边(只被一个面用到)+ 它的「走向」
  const boundary = new Map<number, { from: number; to: number }>();
  for (const [key, list] of edgeIndex) {
    if (list.length !== 1) continue;
    const e = list[0]!;
    const dir = e & 1;
    const u = Math.floor(key / EDGE_STRIDE);
    const v = key % EDGE_STRIDE;
    // dir 0 = 顺着 min→max 走
    boundary.set(key, dir === 0 ? { from: u, to: v } : { from: v, to: u });
  }

  // 顶点 → 从它出发的边界边
  const outgoing = new Map<number, number[]>();
  for (const [key, info] of boundary) {
    const list = outgoing.get(info.from);
    if (list) list.push(key);
    else outgoing.set(info.from, [key]);
  }

  const used = new Set<number>();
  const loops: number[][] = [];
  let cappedEdges = 0;

  for (const startKey of boundary.keys()) {
    if (used.has(startKey)) continue;
    const start = boundary.get(startKey)!;
    const usedBefore = used.size;
    used.add(startKey);

    // 顺着走向把环 / 链走完
    const seq: number[] = [start.from];
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
        if (seq[seq.length - 1] !== cur) seq.push(cur);
        break;
      }
      used.add(nextKey);
      const info = boundary.get(nextKey)!;
      if (info.to === seq[0]) {
        // 走回第一个顶点 ⇒ 环闭合(`cur` 是环上最后一个顶点)
        seq.push(cur);
        break;
      }
      seq.push(cur);
      cur = info.to;
    }

    if (seq.length < 3) continue; // 一条边都凑不出三角形 —— 没法盖

    // 这个环用掉了几条边界边 —— **闭环的边数 = 顶点数**(不是顶点数 − 1:
    // 那是**开口链**的算法。三角洞是 3 条边,不是 2 条。)
    cappedEdges += used.size - usedBefore;
    loops.push(seq);
  }

  return { loops, openEdges: open, nonManifoldEdges: nonManifold, cappedEdges };
}

/** 临时盖面 */
export interface MagnetLid {
  /** 盖面三角形 —— 三个顶点下标(指向模型自己的顶点表) */
  triangles: number[][];
  /** 补上的边界环数量 */
  cappedLoops: number;
  /** 盖面用了几何三角形 */
  lidFaces: number;
  /** 盖面自己的包围盒 —— 切完摘盖面时用来兜底检查 */
  bbox: {
    min: [number, number, number];
    max: [number, number, number];
  } | null;
}

/**
 * 生成临时盖面
 *
 * `loops` 是**顺着相邻面走向**的边界环( `scanMagnetBoundary` 的输出)——
 * 这里会**反过来**再耳切(法线才朝外,见文件头)。
 *
 * 盖面的顶点**直接用模型自己的顶点**(不新建顶点)⇒ 盖面跟模型的边界
 * 严丝合缝,布尔那一步才认得出它是同一条边。
 */
export function buildMagnetLid(
  vertices: Float32Array,
  loops: number[][]
): MagnetLid {
  const pos = Array.from(vertices);
  const triangles: number[][] = [];
  let cappedLoops = 0;

  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const loop of loops) {
    if (loop.length < 3) continue;
    // 盖面用的是**反过来**那个环(法线朝外)
    const reversed = loop.slice().reverse();
    const tris = triangulateLoop(reversed, pos);
    if (!tris.length) continue;
    for (const tri of tris) {
      const t = [reversed[tri[0]!]!, reversed[tri[1]!]!, reversed[tri[2]!]!];
      triangles.push(t);
      for (const v of t) {
        for (let k = 0; k < 3; k++) {
          const c = pos[v * 3 + k]!;
          if (c < min[k]!) min[k] = c;
          if (c > max[k]!) max[k] = c;
        }
      }
    }
    cappedLoops++;
  }

  return {
    triangles,
    cappedLoops,
    lidFaces: triangles.length,
    bbox: triangles.length
      ? {
          min: [...min] as [number, number, number],
          max: [...max] as [number, number, number],
        }
      : null,
  };
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
