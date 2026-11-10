/**
 * 三角汤 → OBJ 文本
 *
 * ## 为什么只导 OBJ、不导 STL
 *
 * 工作室那段 Blender 脚本原本导的就是 `relief_final.obj` —— 保持一致。
 *
 * ## 贴图保住了(2026-11-11)
 *
 * 以前这里**只写 `v` 和 `f`** —— 注释里写着「布尔运算不保留 UV / 材质组」,
 * 所以导出的是纯色件,界面上还得专门提醒用户「切完贴图没了」。
 *
 * 那条结论**是错的**:Manifold3D 支持**属性通道**(`numProp = 5` = xyz + uv),
 * 材质走 `reserveIDs()` + 逐三角形 run。布尔之后 UV 与材质分组**都还在**
 * (见 `magnet-cutter-handler.ts` 的 `buildTexturedMeshInput`)。
 *
 * 所以这里现在会写:
 *
 * ```
 * mtllib relief_final.mtl     ← 有材质时
 * v ...
 * vt ...                      ← 有 UV 时
 * usemtl <材质名>             ← 每个材质组前面一行
 * f v/vt v/vt v/vt            ← 有 UV 时带贴图下标
 * ```
 *
 * ## 顶点去重
 *
 * 输入是三角汤(每个三角形 9 个 float,顶点重复三遍)。OBJ 允许重复顶点,
 * 但文件会大一倍多,而且有些看模软件会把它当成一堆散点。
 * 这里按坐标去重(同一坐标只写一行 `v`);UV 也按 (u,v) 去重。
 *
 * ## 面按材质分组
 *
 * `usemtl` 是**状态**指令 —— 它对**后面**的所有面生效。所以面必须按材质
 * 排好组,否则一个 `usemtl` 会把后面别的材质的面也改了。
 */

/** 三角汤 —— 每个三角形 9 个 float(x,y,z × 3 个角) */
export type TriangleSoup = Float32Array;

export type WriteObjOptions = {
  /** 文件头注释(每一行前面自动加 `# `) */
  header?: string[];
  /** 顶点序号从 1 开始(OBJ 规范) */
  offset?: number;
  /**
   * 每三角形 6 个 float(u0,v0,u1,v1,u2,v2)—— 没有贴图时是 null
   *
   * 跟 `soup` **逐三角形对齐**。
   */
  uvs?: Float32Array | null;
  /** 每三角形一个材质下标 —— 没有材质时是 null */
  materialIndex?: Uint16Array | null;
  /** 材质名(下标指进这个数组) */
  materialNames?: string[] | null;
  /** MTL 文件名 —— 给了就写 `mtllib` 行 */
  mtlFileName?: string | null;
};

/**
 * 把三角汤写成 OBJ 文本
 *
 * @param soup 三角汤(长度必须是 9 的倍数)
 */
export function writeObjFromSoup(
  soup: TriangleSoup,
  options: WriteObjOptions = {}
): string {
  const offset = options.offset ?? 1;
  const uvs = options.uvs ?? null;
  const materialIndex = options.materialIndex ?? null;
  const materialNames = options.materialNames ?? null;
  const lines: string[] = [];

  for (const line of options.header ?? []) {
    lines.push(`# ${line}`);
  }
  if (lines.length > 0) lines.push("");

  if (options.mtlFileName) {
    lines.push(`mtllib ${options.mtlFileName}`);
    lines.push("");
  }

  // 坐标 → 顶点序号(去重)
  const index = new Map<string, number>();
  const vertices: number[] = [];
  const faces: number[] = [];
  // (u,v) → 贴图下标(1-based)
  const uvIndex = new Map<string, number>();
  const uvsOut: number[] = [];

  for (let i = 0; i + 2 < soup.length; i += 3) {
    const x = soup[i]!;
    const y = soup[i + 1]!;
    const z = soup[i + 2]!;
    // float32 → number → string 是**无损**的往返:同一个 float32 永远得到
    // 同一个字符串,所以去重键是稳定的。
    const key = `${x},${y},${z}`;
    let id = index.get(key);
    if (id === undefined) {
      vertices.push(x, y, z);
      id = vertices.length / 3; // 1-based
      index.set(key, id);
    }
    faces.push(id);
  }

  // UV —— 每个三角形 6 个 float
  const faceUvs: number[] = [];
  if (uvs) {
    for (let t = 0; t * 6 + 5 < uvs.length; t++) {
      for (let k = 0; k < 3; k++) {
        const u = uvs[t * 6 + k * 2] ?? 0;
        const v = uvs[t * 6 + k * 2 + 1] ?? 0;
        const uvKey = `${formatObjNumber(u, 6)},${formatObjNumber(v, 6)}`;
        let uvId = uvIndex.get(uvKey);
        if (uvId === undefined) {
          uvsOut.push(u, v);
          uvId = uvsOut.length / 2; // 1-based
          uvIndex.set(uvKey, uvId);
        }
        faceUvs.push(uvId);
      }
    }
  }

  const triCount = faces.length / 3;

  // --- 顶点 ---
  for (let i = 0; i < vertices.length; i += 3) {
    lines.push(
      `v ${formatObjNumber(vertices[i]!)} ${formatObjNumber(vertices[i + 1]!)} ${formatObjNumber(vertices[i + 2]!)}`
    );
  }

  // --- 贴图坐标 ---
  if (uvs) {
    for (let i = 0; i < uvsOut.length; i += 2) {
      lines.push(
        `vt ${formatObjNumber(uvsOut[i]!, 6)} ${formatObjNumber(uvsOut[i + 1]!, 6)}`
      );
    }
  }

  // --- 面(按材质分组)---
  const groups = groupTrianglesByMaterial(
    triCount,
    materialIndex,
    materialNames
  );

  for (const group of groups) {
    if (group.materialName) lines.push(`usemtl ${group.materialName}`);
    for (const t of group.triangles) {
      const a = faces[t * 3]! + offset - 1;
      const b = faces[t * 3 + 1]! + offset - 1;
      const c = faces[t * 3 + 2]! + offset - 1;
      if (uvs) {
        const ua = faceUvs[t * 3]! + offset - 1;
        const ub = faceUvs[t * 3 + 1]! + offset - 1;
        const uc = faceUvs[t * 3 + 2]! + offset - 1;
        lines.push(`f ${a}/${ua} ${b}/${ub} ${c}/${uc}`);
      } else {
        lines.push(`f ${a} ${b} ${c}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

/** 一个材质组 */
type MaterialGroup = {
  /** 材质名 —— null = 不写 `usemtl`(没有材质信息) */
  materialName: string | null;
  /** 三角形下标 */
  triangles: number[];
};

/**
 * 按材质把三角形分组
 *
 * **组内保持原来的相对顺序**,组之间按「第一次出现」的顺序排 —— 这样
 * 同一个材质的面是连续的,`usemtl` 才是对的。
 */
function groupTrianglesByMaterial(
  triCount: number,
  materialIndex: Uint16Array | null,
  materialNames: string[] | null
): MaterialGroup[] {
  if (!materialIndex || !materialNames) {
    const all: number[] = [];
    for (let t = 0; t < triCount; t++) all.push(t);
    return [{ materialName: null, triangles: all }];
  }

  const groups: MaterialGroup[] = [];
  const byIndex = new Map<number, MaterialGroup>();
  for (let t = 0; t < triCount; t++) {
    const raw = materialIndex[t];
    const idx =
      raw === undefined || !Number.isFinite(raw)
        ? 0
        : Math.min(materialNames.length - 1, Math.max(0, raw));
    let group = byIndex.get(idx);
    if (!group) {
      group = {
        materialName: sanitizeMaterialName(materialNames[idx], idx),
        triangles: [],
      };
      byIndex.set(idx, group);
      groups.push(group);
    }
    group.triangles.push(t);
  }
  return groups;
}

/**
 * 材质名 → 能写进 OBJ 的名字
 *
 * **原样保留** —— 只清掉控制字符(换行会把一行写成两行)。
 *
 * 早先想过把空格换成下划线,但那是**错的**:材质名要跟 MTL 里的 `newmtl`
 * 对得上,不然贴图查不到(仓库的 `resolveMaterialName` 只放宽大小写和
 * 尾部的副本序号,不改空格)。原样写 = 跟原文件的配对关系一模一样 ——
 * 导出来的 ZIP 解析出来的材质跟原模型是同一套。
 */
export function sanitizeMaterialName(
  name: string | undefined,
  index: number
): string {
  const cleaned = (name ?? "").replace(/[\r\n\t]+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : `material_${index}`;
}

/**
 * 数字格式化 —— 小数点后 4 位,去掉多余的 0
 *
 * OBJ 不在乎精度,但「1.2345678901234」这种一长串会让文件白白变大,
 * 而 1e-4 mm(0.1 微米)对 3D 打印来说早就小到没有意义了。
 *
 * UV 用 6 位 —— 1024px 的贴图上 1e-6 的 UV = 0.001 像素,再少也没意义;
 * 但 4 位就不够了(1e-4 UV = 0.1 像素,大图上看得见台阶)。
 */
function formatObjNumber(n: number, decimals = 4): string {
  if (!Number.isFinite(n)) return "0";
  const factor = 10 ** decimals;
  const rounded = Math.round(n * factor) / factor;
  if (Object.is(rounded, -0)) return "0";
  return String(rounded);
}

/**
 * 三角汤 → 文件名安全的 OBJ blob
 */
export function objBlobFromSoup(
  soup: TriangleSoup,
  options: WriteObjOptions = {}
): Blob {
  return new Blob([writeObjFromSoup(soup, options)], {
    type: "text/plain;charset=utf-8",
  });
}
