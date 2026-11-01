/**
 * 移植自 wjp-source-code/src/lib/obj-parser.ts —— 耗材克重报价计算器（PolyJet 全彩打印）。
 *
 * 算法逻辑与源实现保持一致；移植时仅做类型严格化（noUncheckedIndexedAccess /
 * exactOptionalPropertyTypes）与 Biome 格式化调整，未改变任何数值行为。
 */
/**
 * OBJ model parser - calculates real volume, surface area, bounding box
 * from the geometry data in an OBJ file.
 *
 * Volume uses the signed tetrahedra method:
 *   V = (1/6) * Σ (v1 · (v2 × v3))   for each triangle (v1,v2,v3)
 *   - works for any closed mesh, regardless of orientation
 *   - absolute value is taken because OBJ winding can be inconsistent
 *
 * Surface area uses triangle area sum:
 *   A = (1/2) * |(v2-v1) × (v3-v1)|   for each triangle
 *
 * Bounding box gives the model's true outer dimensions (L x W x H).
 */

export type Vec3 = { x: number; y: number; z: number };

export type ObjParseResult = {
  vertexCount: number;
  faceCount: number;
  triangleCount: number;
  boundingBox: {
    min: Vec3;
    max: Vec3;
    size: Vec3; // dimensions in mm (assuming OBJ is in mm)
  };
  volumeMM3: number; // mm³
  volumeCM3: number; // cm³
  surfaceAreaMM2: number; // mm²
  surfaceAreaCM2: number; // cm²
};

const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

const sub = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

const length = (a: Vec3): number =>
  Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);

// Parse a face vertex token like "1", "1/2", "1/2/3", "1//3"
// OBJ indices are 1-based; negative indices are relative to current vertex count
const parseFaceVertex = (token: string, vertexCount: number): number => {
  const idx = parseInt(token.split("/")[0] || "0", 10);
  if (idx > 0) return idx - 1;
  if (idx < 0) return vertexCount + idx;
  return -1;
};

export function parseObj(objText: string): ObjParseResult {
  const vertices: Vec3[] = [];
  const faces: number[][] = []; // each face is an array of vertex indices

  const lines = objText.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split(/\s+/);
    const cmd = parts[0];

    if (cmd === "v" && parts.length >= 4) {
      vertices.push({
        x: parseFloat(parts[1] ?? "") || 0,
        y: parseFloat(parts[2] ?? "") || 0,
        z: parseFloat(parts[3] ?? "") || 0,
      });
    } else if (cmd === "f" && parts.length >= 4) {
      // Triangulate polygon fan: (v0,v1,v2), (v0,v2,v3), ...
      const idx: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const v = parseFaceVertex(parts[i] ?? "", vertices.length);
        if (v >= 0) idx.push(v);
      }
      if (idx.length >= 3) faces.push(idx);
    }
  }

  // Bounding box
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  }
  if (!Number.isFinite(minX)) {
    minX = minY = minZ = 0;
    maxX = maxY = maxZ = 0;
  }

  const bboxMin = { x: minX, y: minY, z: minZ };
  const bboxMax = { x: maxX, y: maxY, z: maxZ };
  const size = {
    x: Math.abs(maxX - minX),
    y: Math.abs(maxY - minY),
    z: Math.abs(maxZ - minZ),
  };

  // Volume (signed tetrahedra) + surface area (triangle sum)
  let signedVolume = 0;
  let surfaceArea = 0;
  let triangleCount = 0;

  for (const face of faces) {
    for (let i = 1; i < face.length - 1; i++) {
      const v0 = vertices[face[0]!];
      const v1 = vertices[face[i]!];
      const v2 = vertices[face[i + 1]!];
      if (!v0 || !v1 || !v2) continue;

      // Signed volume of tetrahedron (origin, v0, v1, v2)
      signedVolume += dot(v0, cross(v1, v2)) / 6;

      // Triangle area
      const e1 = sub(v1, v0);
      const e2 = sub(v2, v0);
      surfaceArea += length(cross(e1, e2)) / 2;

      triangleCount++;
    }
  }

  const volumeMM3 = Math.abs(signedVolume);
  const volumeCM3 = volumeMM3 / 1000;
  const surfaceAreaMM2 = surfaceArea;
  const surfaceAreaCM2 = surfaceArea / 100;

  return {
    vertexCount: vertices.length,
    faceCount: faces.length,
    triangleCount,
    boundingBox: { min: bboxMin, max: bboxMax, size },
    volumeMM3,
    volumeCM3,
    surfaceAreaMM2,
    surfaceAreaCM2,
  };
}
