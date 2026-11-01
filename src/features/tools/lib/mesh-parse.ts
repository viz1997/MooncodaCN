/**
 * 模型解析 —— 把 OBJ 文本解析成可供「拓扑检查 / 壁厚测量 / 3D 预览」共用的网格结构。
 *
 * ## 为什么不用 features/pricing 的 obj-parser
 *
 * `obj-parser.ts` 只返回聚合量(体积 / 表面积 / 包围盒),顶点与索引在建完
 * 统计后就丢了。模型检查要做的是**逐面 / 逐边**的事:
 *  - 哪几个三角形是退化面、重复面
 *  - 哪条边只被一个面共用(开放边)、哪条边被三个以上面共用(非流形边)
 *  - 哪些顶点在几何上是同一个点(没焊上的重复顶点)
 *
 * 这些都需要索引级的原始数据,所以这里单独解析一份。
 *
 * ## OBJ 面索引
 *
 * `f` 行的顶点索引有三种写法:
 *  - `12`      —— 正数,1-based
 *  - `-3`      —— 负数,相对**当前已读到**的顶点数(OBJ 规范)
 *  - `12/7/3`  —— 带纹理 / 法线索引,本工具只用第一段
 *
 * 负数索引必须**在读到该 face 的那一刻**用当时的顶点数解析,所以这里是
 * 单遍扫描,不能先把所有顶点读完再解析面。
 *
 * 多于 3 个顶点的面按扇形三角化:(v0,v1,v2), (v0,v2,v3), …
 */

/** 解析结果 —— 顶点 + 索引 + 三角形汤 + 包围盒 */
export type MeshData = {
  /** 顶点坐标,x/y/z 扁平存放 */
  vertices: Float64Array;
  vertexCount: number;
  /** 三角形顶点索引,每 3 个一组 */
  indices: Uint32Array;
  triangleCount: number;
  /** 三角形汤 —— 9 float / 三角形,three.js 可直接用 */
  positions: Float32Array;
  /** 包围盒最小角 */
  min: [number, number, number];
  /** 包围盒最大角 */
  max: [number, number, number];
  /** 包围盒尺寸(x/y/z) */
  size: [number, number, number];
  /** 包围盒对角线长度 —— 各类「相对阈值」的基准尺度 */
  diagonal: number;
};

/** 解析 OBJ 文本;失败(没有顶点 / 没有面)时返回 null */
export function parseObjText(objText: string): MeshData | null {
  const vx: number[] = [];
  const vy: number[] = [];
  const vz: number[] = [];
  const idx: number[] = [];

  const lines = objText.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.charCodeAt(0) === 35 /* '#' */) continue;

    // 只看第一个空白前的命令名
    let sp = line.indexOf(" ");
    if (sp < 0) sp = line.indexOf("\t");
    if (sp < 0) continue;
    const cmd = line.slice(0, sp);
    const rest = line.slice(sp + 1).trim();
    if (!rest) continue;

    if (cmd === "v") {
      const p = rest.split(/\s+/);
      const x = Number.parseFloat(p[0] ?? "");
      const y = Number.parseFloat(p[1] ?? "");
      const z = Number.parseFloat(p[2] ?? "");
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        continue;
      }
      vx.push(x);
      vy.push(y);
      vz.push(z);
      continue;
    }

    if (cmd === "f") {
      const tokens = rest.split(/\s+/);
      const face: number[] = [];
      // 读到 face 时的顶点数 —— 负数索引的基准
      const currentVertexCount = vx.length;
      for (const tok of tokens) {
        if (!tok) continue;
        const slash = tok.indexOf("/");
        const head = slash >= 0 ? tok.slice(0, slash) : tok;
        const raw0 = Number.parseInt(head, 10);
        if (!Number.isFinite(raw0) || raw0 === 0) continue;
        const v = raw0 > 0 ? raw0 - 1 : currentVertexCount + raw0;
        if (v < 0 || v >= currentVertexCount) continue;
        face.push(v);
      }
      if (face.length < 3) continue;
      // 扇形三角化
      for (let i = 1; i < face.length - 1; i++) {
        idx.push(face[0] as number, face[i] as number, face[i + 1] as number);
      }
    }
  }

  const vertexCount = vx.length;
  const triangleCount = idx.length / 3;
  if (vertexCount === 0 || triangleCount === 0) return null;

  const vertices = new Float64Array(vertexCount * 3);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const x = vx[i] as number;
    const y = vy[i] as number;
    const z = vz[i] as number;
    vertices[i * 3] = x;
    vertices[i * 3 + 1] = y;
    vertices[i * 3 + 2] = z;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const indices = new Uint32Array(idx);
  const positions = new Float32Array(triangleCount * 9);
  for (let t = 0; t < triangleCount; t++) {
    const a = indices[t * 3] as number;
    const b = indices[t * 3 + 1] as number;
    const c = indices[t * 3 + 2] as number;
    const o = t * 9;
    positions[o] = vertices[a * 3] as number;
    positions[o + 1] = vertices[a * 3 + 1] as number;
    positions[o + 2] = vertices[a * 3 + 2] as number;
    positions[o + 3] = vertices[b * 3] as number;
    positions[o + 4] = vertices[b * 3 + 1] as number;
    positions[o + 5] = vertices[b * 3 + 2] as number;
    positions[o + 6] = vertices[c * 3] as number;
    positions[o + 7] = vertices[c * 3 + 1] as number;
    positions[o + 8] = vertices[c * 3 + 2] as number;
  }

  const size: [number, number, number] = [
    maxX - minX,
    maxY - minY,
    maxZ - minZ,
  ];
  const diagonal = Math.hypot(size[0], size[1], size[2]);

  return {
    vertices,
    vertexCount,
    indices,
    triangleCount,
    positions,
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size,
    diagonal,
  };
}
