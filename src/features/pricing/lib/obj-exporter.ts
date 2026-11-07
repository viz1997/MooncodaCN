/**
 * 移植自 wjp-source-code/src/lib/obj-exporter.ts —— 耗材克重报价计算器（PolyJet 全彩打印）。
 *
 * 算法逻辑与源实现保持一致；移植时仅做类型严格化（noUncheckedIndexedAccess /
 * exactOptionalPropertyTypes）与 Biome 格式化调整，未改变任何数值行为。
 */
/**
 * OBJ Exporter
 *
 * Applies the optimal print angle (rotation around X and Y axes) to all
 * vertices of an OBJ file, then translates the model so its bottom snaps
 * to Y=0 (print bed). The result is exported as a new OBJ file ready for
 * slicing.
 *
 * Pipeline:
 *   1. Parse all `v` lines, build a vertex array.
 *   2. Apply rotation matrix R = R_x(base + rotX) * R_y(rotY)
 *      where base = -90° (Z-up print → Y-up three.js convention).
 *   3. Translate Y so min(Y) = 0 (snap to print bed).
 *   4. Re-emit the OBJ with transformed `v` lines and unchanged `f` lines.
 *
 * This runs on the main thread (OBJ files are usually <5 MB and the
 * transformation is O(n) — well under 100ms even for 100k vertices).
 */

import {
  baseName,
  rewriteMtllib,
  rewriteMtlTextureRefs,
} from "@/features/pricing/lib/obj-materials";

export type ExportRotation = {
  /** Degrees around X axis (in addition to the implicit -90° Z-up→Y-up) */
  rotX: number;
  /** Degrees around Y axis */
  rotY: number;
  /** Degrees around Z axis (manual fine-tuning) */
  rotZ?: number;
};

export type ExportOptions = {
  /** Optional uniform scale (e.g. user-applied custom scale factor). Used when scaleX/Y/Z are not provided. */
  scale?: number;
  /** Optional per-axis scale (overrides `scale` if provided). Applied in OBJ's original coordinate system (before rotation). */
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  /** Optional comment header to embed at the top of the OBJ */
  comment?: string;
};

/**
 * Rotate a single vertex (x, y, z) by base -90° X + rotX° X + rotY° Y + rotZ° Z,
 * matching the visualization rotation used in the 3D viewport (Z-up, no base rotation).
 *
 * Returns the transformed [x', y', z'] in Z-up space (same as OBJ original).
 */
function rotateVertex(
  x: number,
  y: number,
  z: number,
  rotXDeg: number,
  rotYDeg: number,
  rotZDeg: number = 0
): [number, number, number] {
  // 1. Rotate around X by rotX (no base rotation — scene is Z-up)
  const totalRotX = (rotXDeg * Math.PI) / 180;
  const cosX = Math.cos(totalRotX);
  const sinX = Math.sin(totalRotX);
  // (x, y, z) -> (x, y*cosX - z*sinX, y*sinX + z*cosX)
  const y1 = y * cosX - z * sinX;
  const z1 = y * sinX + z * cosX;

  // 2. Rotate around Y by rotY
  const ry = (rotYDeg * Math.PI) / 180;
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  // (x, y1, z1) -> (x*cosY + z1*sinY, y1, -x*sinY + z1*cosY)
  const x2 = x * cosY + z1 * sinY;
  const z2 = -x * sinY + z1 * cosY;

  // 3. Rotate around Z by rotZ (applied last, after X and Y)
  if (rotZDeg !== 0) {
    const rz = (rotZDeg * Math.PI) / 180;
    const cosZ = Math.cos(rz);
    const sinZ = Math.sin(rz);
    // (x2, y1, z2) -> (x2*cosZ - y1*sinZ, x2*sinZ + y1*cosZ, z2)
    const x3 = x2 * cosZ - y1 * sinZ;
    const y3 = x2 * sinZ + y1 * cosZ;
    return [x3, y3, z2];
  }

  return [x2, y1, z2];
}

/**
 * Apply rotation + floor-snap to an OBJ text and return the new OBJ text.
 *
 * The output preserves:
 *   - All `v` lines (transformed; original indices preserved)
 *   - All `vt`, `vn`, `f`, `g`, `o`, `usemtl`, `mtllib`, `s` lines (untouched)
 *   - All comments starting with `#`
 *
 * Faces are NOT touched — since vertices are reordered in-place, all
 * face vertex indices remain valid.
 */
export function exportRotatedObj(
  objText: string,
  rotation: ExportRotation,
  options: ExportOptions = {}
): string {
  const { rotX, rotY, rotZ = 0 } = rotation;
  // 解析缩放因子：优先使用独立 XYZ，否则使用统一 scale
  const sx = options.scaleX ?? options.scale ?? 1;
  const sy = options.scaleY ?? options.scale ?? 1;
  const sz = options.scaleZ ?? options.scale ?? 1;
  const hasRotation = rotX !== 0 || rotY !== 0 || rotZ !== 0;
  const hasScale =
    Math.abs(sx - 1) > 0.0001 ||
    Math.abs(sy - 1) > 0.0001 ||
    Math.abs(sz - 1) > 0.0001;

  // 如果没有旋转、没有缩放、没有注释 → 直接返回原始 OBJ 文本（保持原格式）
  if (!hasRotation && !hasScale && !options.comment) {
    return objText;
  }

  const lines = objText.split(/\r?\n/);
  const out: string[] = [];

  if (options.comment) {
    out.push(`# ${options.comment}`);
    const scaleStr =
      sx === sy && sy === sz ? `${sx}` : `X=${sx} Y=${sy} Z=${sz}`;
    out.push(`# Rotated: X=${rotX}° Y=${rotY}° Z=${rotZ}° scale=${scaleStr}`);
  }

  // Pass 1: 处理所有顶点行
  // Z-up 坐标系：Z 是高度方向，贴底用 Z
  const transformedZ: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // 顶点行的判定必须跟 obj-parser.ts 的切词方式一致：
    // 去空白后按空白切，第一个 token 正好是 "v"。
    //
    // 之前只认「行首是 `v `」（v 后面必须是一个空格），漏掉了缩进过的
    // 和用制表符分隔的顶点行 —— 那种模型量出来是缩放后的尺寸（报价按
    // 缩放算），导出的文件却没缩放，工作室拿到的模型跟报价单对不上。
    const trimmed = line.trim();
    const parts = trimmed.length > 0 ? trimmed.split(/\s+/) : [];
    if (parts[0] === "v" && parts.length >= 4) {
      // v x y z [w]
      const x = parseFloat(parts[1] ?? "") || 0;
      const y = parseFloat(parts[2] ?? "") || 0;
      const z = parseFloat(parts[3] ?? "") || 0;
      // 先按 XYZ 缩放（OBJ 原始坐标系）
      const scaledX = x * sx;
      const scaledY = y * sy;
      const scaledZ = z * sz;
      // 第 5 个 token 是可选的 w 分量，原样带过去
      const extra = parts.length > 4 ? ` ${parts.slice(4).join(" ")}` : "";
      if (hasRotation) {
        // 有旋转时：旋转顶点
        const [tx, ty, tz] = rotateVertex(
          scaledX,
          scaledY,
          scaledZ,
          rotX,
          rotY,
          rotZ
        );
        transformedZ.push(tz);
        out.push(`__V__ ${tx} ${ty} ${tz}${extra}`);
      } else {
        // 无旋转时：仅缩放，保留原始精度格式
        transformedZ.push(scaledZ);
        out.push(`__V__ ${scaledX} ${scaledY} ${scaledZ}${extra}`);
      }
    } else {
      out.push(line);
    }
  }

  // Pass 2: 计算最小 Z（贴底到 Z=0），替换 __V__ 占位符
  let minZ = Infinity;
  for (const z of transformedZ) {
    if (z < minZ) minZ = z;
  }
  if (!Number.isFinite(minZ)) minZ = 0;
  // 只有有旋转时才贴底（避免缩放时模型位置不必要的偏移）
  const shouldFloorSnap = hasRotation;

  for (let i = 0; i < out.length; i++) {
    const line = out[i]!;
    if (line.startsWith("__V__ ")) {
      const parts = line.substring(6).trim().split(/\s+/);
      const x = parseFloat(parts[0] ?? "") || 0;
      const y = parseFloat(parts[1] ?? "") || 0;
      const z =
        (parseFloat(parts[2] ?? "") || 0) - (shouldFloorSnap ? minZ : 0);
      const rest = parts.slice(3).join(" ");
      out[i] = `v ${x} ${y} ${z}${rest ? ` ${rest}` : ""}`;
    }
  }

  return out.join("\n");
}

/**
 * Trigger a browser download of the given OBJ text as a .obj file.
 *
 * Falls back gracefully if `document` is unavailable (SSR).
 */
export function downloadObjFile(objText: string, filename: string): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([objText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".obj") ? filename : `${filename}.obj`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke after a short delay so the download has time to start
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * zip 里 OBJ 条目的文件名 —— 去掉 3D 扩展名,统一成 `.obj`。
 *
 * 上传的可能是 `.stl` / `.glb`(这两种格式是我们自己合成的 OBJ 文本),
 * 合并模型的 OBJ 名则是「3 个 OBJ 合并」这种没有扩展名的显示名 ——
 * 直接当 zip entry 名写进去,工作室那边双击打不开。
 */
function objEntryName(fileName: string): string {
  const base = baseName(fileName).trim();
  if (!base) return "model.obj";
  if (base.toLowerCase().endsWith(".obj")) return base;
  const stem = base.replace(/\.(stl|glb|gltf|ply)$/i, "");
  return `${stem || base}.obj`;
}

/**
 * zip 里 MTL 条目的文件名 —— 统一成 `.mtl`。
 */
function mtlEntryName(fileName: string | undefined, fallback: string): string {
  const base = baseName((fileName ?? "").trim()) || baseName(fallback);
  if (!base) return "model.mtl";
  if (base.toLowerCase().endsWith(".mtl")) return base;
  const stem = base.replace(/\.[^.]+$/, "");
  return `${stem || base}.mtl`;
}

/**
 * 把纹理按 basename 平铺,重名的加序号后缀。
 *
 * 返回「包内原始路径 → 平铺后的名字」。
 */
function buildFlatTextureNames(
  textureBlobs: { name: string; blob: Blob }[]
): Map<string, string> {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const tb of textureBlobs) {
    let flat = baseName(tb.name).trim();
    if (!flat) flat = "texture";
    if (used.has(flat.toLowerCase())) {
      const dot = flat.lastIndexOf(".");
      const stem = dot > 0 ? flat.slice(0, dot) : flat;
      const suffix = dot > 0 ? flat.slice(dot) : "";
      let n = 1;
      let candidate = `${stem}_${n}${suffix}`;
      while (used.has(candidate.toLowerCase())) {
        n += 1;
        candidate = `${stem}_${n}${suffix}`;
      }
      flat = candidate;
    }
    used.add(flat.toLowerCase());
    map.set(tb.name, flat);
  }
  return map;
}

/**
 * 做「MTL 里写的贴图名 → 包内实际文件」的解析器。
 *
 * 规则跟 `matchMaterialTextures` 一致:先按完整路径(忽略大小写)精确匹配,
 * 再退到 basename 匹配。匹配不上返回 undefined —— **绝不乱指到别的图**。
 */
function makeTextureResolver(
  textureBlobs: { name: string; blob: Blob }[],
  flatNames: Map<string, string>
): (ref: string) => string | undefined {
  const byFullPath = new Map<string, string>();
  const byBaseName = new Map<string, string>();
  for (const tb of textureBlobs) {
    const flat = flatNames.get(tb.name);
    if (!flat) continue;
    const full = tb.name.replace(/\\/g, "/").toLowerCase();
    if (!byFullPath.has(full)) byFullPath.set(full, flat);
    const base = baseName(tb.name).toLowerCase();
    if (!byBaseName.has(base)) byBaseName.set(base, flat);
  }
  return (ref) => {
    const full = ref.replace(/\\/g, "/").toLowerCase();
    const exact = byFullPath.get(full);
    if (exact) return exact;
    return byBaseName.get(baseName(ref).toLowerCase());
  };
}

/**
 * 打包 ZIP Blob（含 OBJ + MTL + 纹理），保留原始格式。
 *
 * 只打包、不下载 —— 打印服务下单时要把模型文件直传到 R2,得先有字节。
 * JSZip 动态导入（避免首屏加载时把压缩库打进 bundle）。
 *
 * ## 包内结构
 *
 * OBJ / MTL / 纹理**全部平铺到 zip 根目录**:
 * MTL 里的 `map_Kd` 是相对路径,纹理一旦待在子目录(`textures/wood.png`),
 * 而 MTL 写的是 `wood.png`,解压出来引用就断了 —— 这正是「导出的模型贴图丢失」
 * 的原因。所以纹理按 basename 平铺,并同步改写 MTL 里的贴图引用。
 */
export async function buildModelZipBlob(
  objText: string,
  mtlText: string | undefined,
  textureBlobs: { name: string; blob: Blob }[] | undefined,
  objFileName: string,
  mtlFileName: string | undefined
): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  const textures = textureBlobs ?? [];
  const objEntry = objEntryName(objFileName);
  const mtlEntry =
    mtlText !== undefined ? mtlEntryName(mtlFileName, objEntry) : undefined;

  // 纹理按 basename 平铺,重名加序号
  const flatNames = buildFlatTextureNames(textures);

  // MTL 里的贴图引用改成平铺后的名字(option token 原样保留)
  const outMtlText =
    mtlText !== undefined
      ? rewriteMtlTextureRefs(mtlText, makeTextureResolver(textures, flatNames))
      : undefined;

  // OBJ 里的 mtllib 指向 zip 里 MTL 的实际名字
  const outObjText = mtlEntry ? rewriteMtllib(objText, mtlEntry) : objText;

  // 添加 OBJ 文件（使用修改后的文本）
  zip.file(objEntry, outObjText);

  // 添加 MTL 文件（如果有）
  if (outMtlText !== undefined && mtlEntry) {
    zip.file(mtlEntry, outMtlText);
  }

  // 添加纹理文件（如果有）—— 一律写平铺后的名字
  for (const tb of textures) {
    const flat = flatNames.get(tb.name);
    if (!flat) continue;
    const arrayBuffer = await tb.blob.arrayBuffer();
    zip.file(flat, arrayBuffer);
  }

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  });
}

/**
 * 下载 ZIP 包（含 OBJ + MTL + 纹理），保留原始格式。
 */
export async function downloadModelZip(
  objText: string,
  mtlText: string | undefined,
  textureBlobs: { name: string; blob: Blob }[] | undefined,
  objFileName: string,
  mtlFileName: string | undefined,
  zipFilename: string
): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const zipBlob = await buildModelZipBlob(
    objText,
    mtlText,
    textureBlobs,
    objFileName,
    mtlFileName
  );

  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipFilename.endsWith(".zip")
    ? zipFilename
    : `${zipFilename}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
