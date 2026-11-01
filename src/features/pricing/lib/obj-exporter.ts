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
 * matching the visualization rotation used in ObjViewer (Z-up, no base rotation).
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
    if (line.length < 2) {
      out.push(line);
      continue;
    }
    const c = line.charAt(0);
    if (c === "v" && line.charAt(1) === " ") {
      // v x y z [w]
      const parts = line.substring(2).trim().split(/\s+/);
      const x = parseFloat(parts[0] ?? "") || 0;
      const y = parseFloat(parts[1] ?? "") || 0;
      const z = parseFloat(parts[2] ?? "") || 0;
      // 先按 XYZ 缩放（OBJ 原始坐标系）
      const scaledX = x * sx;
      const scaledY = y * sy;
      const scaledZ = z * sz;
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
        out.push(
          `__V__ ${tx} ${ty} ${tz}${parts.length > 3 ? ` ${parts.slice(3).join(" ")}` : ""}`
        );
      } else {
        // 无旋转时：仅缩放，保留原始精度格式
        transformedZ.push(scaledZ);
        out.push(
          `__V__ ${scaledX} ${scaledY} ${scaledZ}${parts.length > 3 ? ` ${parts.slice(3).join(" ")}` : ""}`
        );
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
 * 下载 ZIP 包（含 OBJ + MTL + 纹理），保留原始格式。
 *
 * 动态导入 JSZip（避免首屏加载时打包），把修改后的 OBJ 文本和原始 MTL/纹理打包。
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

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();

  // 添加 OBJ 文件（使用修改后的文本）
  zip.file(objFileName, objText);

  // 添加 MTL 文件（如果有）
  if (mtlText && mtlFileName) {
    zip.file(mtlFileName, mtlText);
  }

  // 添加纹理文件（如果有）
  if (textureBlobs && textureBlobs.length > 0) {
    for (const { name, blob } of textureBlobs) {
      const arrayBuffer = await blob.arrayBuffer();
      zip.file(name, arrayBuffer);
    }
  }

  // 生成 ZIP 并下载
  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
  });
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
