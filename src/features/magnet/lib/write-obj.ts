/**
 * 三角汤 → OBJ 文本
 *
 * ## 为什么只导 OBJ、不导 STL
 *
 * 工作室那段 Blender 脚本原本导的就是 `relief_final.obj` —— 保持一致。
 *
 * ## 为什么不带 `vt` / `vn`
 *
 * **布尔运算不保留 UV / 材质组。** 切完的网格是重新三角化出来的,
 * 原来的顶点顺序、UV 通道、材质分组全没了 —— 硬塞一个旧的 `vt` 进去
 * 只会得到**错的**贴图(坐标跟新顶点对不上)。
 *
 * 所以导出的是**纯色件**。这一点**必须在界面上写明** ——
 * 模型原本有贴图的话,切完贴图没了。
 *
 * ## 顶点去重
 *
 * 输入是三角汤(每个三角形 9 个 float,顶点重复三遍)。OBJ 允许重复顶点,
 * 但文件会大一倍多,而且有些看模软件会把它当成一堆散点。
 * 这里按坐标去重(同一坐标只写一行 `v`)。
 */

/** 三角汤 —— 每个三角形 9 个 float(x,y,z × 3 个角) */
export type TriangleSoup = Float32Array;

export type WriteObjOptions = {
  /** 文件头注释(每一行前面自动加 `# `) */
  header?: string[];
  /** 顶点序号从 1 开始(OBJ 规范) */
  offset?: number;
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
  const lines: string[] = [];

  for (const line of options.header ?? []) {
    lines.push(`# ${line}`);
  }
  if (lines.length > 0) lines.push("");

  // 坐标 → 顶点序号(去重)
  const index = new Map<string, number>();
  const vertices: number[] = [];
  const faces: number[] = [];

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

  for (let i = 0; i < vertices.length; i += 3) {
    lines.push(
      `v ${formatNum(vertices[i]!)} ${formatNum(vertices[i + 1]!)} ${formatNum(vertices[i + 2]!)}`
    );
  }
  for (let i = 0; i < faces.length; i += 3) {
    lines.push(
      `f ${faces[i]! + offset - 1} ${faces[i + 1]! + offset - 1} ${faces[i + 2]! + offset - 1}`
    );
  }

  return `${lines.join("\n")}\n`;
}

/**
 * 数字格式化 —— 小数点后 4 位,去掉多余的 0
 *
 * OBJ 不在乎精度,但「1.2345678901234」这种一长串会让文件白白变大,
 * 而 1e-4 mm(0.1 微米)对 3D 打印来说早就小到没有意义了。
 */
function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 10_000) / 10_000;
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
