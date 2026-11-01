/**
 * 移植自 wjp-source-code/src/lib/angle-optimizer.ts —— 耗材克重报价计算器（PolyJet 全彩打印）。
 *
 * 算法逻辑与源实现保持一致；移植时仅做类型严格化（noUncheckedIndexedAccess /
 * exactOptionalPropertyTypes）与 Biome 格式化调整，未改变任何数值行为。
 */
/**
 * 智能摆盘角度优化（PolyJet 多材料喷射全彩打印支撑模型）
 *
 * 核心算法（双体积公式）：
 *   总支撑克重 = (外壳包裹体积 + 底部填充体积) × 填充率 × 材料密度
 *
 *   外壳包裹体积 = Σ(法线朝下或水平的面面积) × 壳厚 (1mm)
 *     —— 仅 nz ≤ 0 的面需要包裹（侧面、悬垂面、朝下面）
 *     —— 平顶朝上的面（nz > 0）不参与
 *
 *   底部填充体积 = max(0, 投影面积 × 包裹顶部Z - 包裹区内模型体积)
 *     —— PolyJet 工艺中，模型内部空腔也会被填充支撑材料，所以直接用投影体积减去模型体积是合理的
 *
 * 智能裁剪逻辑：
 *   - 不再用「Z_max × 50%」这种死板阈值
 *   - 通过法线方向自然确定包裹范围（nz ≤ 0 的所有面参与包裹）
 *   - 包裹顶部 Z = 所有包裹面的最高 Z（动态计算）
 *   - 渲染端用 Shader 传入 uZThreshold，瞬间裁掉上半部分
 *
 * 摆盘策略：
 *   - 代价 = α·支撑克重 + β·彩色面被包裹面积
 *   - 若某角度让彩色面被包裹 → 优先级降至最低（次选最少包裹面积）
 *
 * 性能优化：
 *   - coarseMode = true：栅格 5mm，步长 30°（拖拽中实时预览）
 *   - coarseMode = false：栅格 1mm，步长 15°（松开后精确计算）
 */

export type OptimalAngle = {
  /** 绕 X 轴旋转角度（度） */
  rotX: number;
  /** 绕 Y 轴旋转角度（度） */
  rotY: number;
  /** 本体支撑比例（无单位）：支撑克重 / 模型克重。>1 表示支撑比模型本身还重。 */
  selfSupportRatio: number;
  /** 本体支撑面积 (mm²)：从上方俯视的 XY 投影面积（模型本体在打印平面上的覆盖范围） */
  selfSupportArea: number;
  /** 总支撑比例（无单位）：与 selfSupportRatio 相同（保持兼容性） */
  totalSupportRatio: number;
  /** 总支撑克重 (g)：基于 PolyJet 双体积公式（外壳包裹 + 底部填充） */
  totalSupportWeight: number;
  /** 总表面积 (cm²) */
  totalArea: number;
  /** 旋转后的模型高度 (mm) */
  rotatedHeight: number;
  /** 是否躺平摆放 */
  laidFlat: boolean;
  /** 旋转后悬垂面面积 (mm²)：仅法线朝下且 >45° 的三角面面积之和 */
  overhangArea?: number;
  /** 旋转后被包裹的彩色表面面积 (mm²)：用于评估贴图表面保护效果 */
  coloredDownArea?: number;
  /** 包裹面总面积 (mm²)：所有 nz ≤ 0 的面面积之和（侧面 + 朝下面） */
  wrapArea?: number;
  /** 外壳包裹体积 (mm³) */
  shellVolume?: number;
  /** 底部填充体积 (mm³) */
  fillVolume?: number;
  /** 包裹顶部 Z (mm)：用于 Shader 裁剪阈值 */
  wrapTopZ?: number;
  /** 原始姿态（rotX=0, rotY=0）的支撑克重 (g)：用于对比 */
  originalWeight?: number;
  /** 原始姿态的支撑克重与最优姿态的比值（>1 表示原始姿态支撑更多） */
  originalRatio?: number;
};

/**
 * 旋转一个法线向量（绕 X 轴再绕 Y 轴）
 */
function rotateNormal(
  nx: number,
  ny: number,
  nz: number,
  rotXDeg: number,
  rotYDeg: number
): [number, number, number] {
  const rx = (rotXDeg * Math.PI) / 180;
  const ry = (rotYDeg * Math.PI) / 180;

  const cosX = Math.cos(rx),
    sinX = Math.sin(rx);
  const y1 = ny * cosX - nz * sinX;
  const z1 = ny * sinX + nz * cosX;

  const cosY = Math.cos(ry),
    sinY = Math.sin(ry);
  const x2 = nx * cosY + z1 * sinY;
  const z2 = -nx * sinY + z1 * cosY;

  return [x2, y1, z2];
}

/**
 * 旋转所有顶点：绕 X 轴 → 绕 Y 轴 → 绕 Z 轴
 */
function rotatePositions(
  positions: Float32Array,
  rotXDeg: number,
  rotYDeg: number,
  rotZDeg: number = 0
): Float32Array {
  const totalRotX = (rotXDeg * Math.PI) / 180;
  const cosX = Math.cos(totalRotX),
    sinX = Math.sin(totalRotX);
  const ry = (rotYDeg * Math.PI) / 180;
  const cosY = Math.cos(ry),
    sinY = Math.sin(ry);
  const rz = (rotZDeg * Math.PI) / 180;
  const cosZ = Math.cos(rz),
    sinZ = Math.sin(rz);

  const result = new Float32Array(positions.length);
  const vertCount = positions.length / 3;
  for (let i = 0; i < vertCount; i++) {
    const x0 = positions[i * 3]!;
    const y0 = positions[i * 3 + 1]!;
    const z0 = positions[i * 3 + 2]!;
    const y1 = y0 * cosX - z0 * sinX;
    const z1 = y0 * sinX + z0 * cosX;
    const x2 = x0 * cosY + z1 * sinY;
    const z2 = -x0 * sinY + z1 * cosY;
    let x3 = x2,
      y3 = y1;
    if (rotZDeg !== 0) {
      x3 = x2 * cosZ - y1 * sinZ;
      y3 = x2 * sinZ + y1 * cosZ;
    }
    result[i * 3] = x3;
    result[i * 3 + 1] = y3;
    result[i * 3 + 2] = z2;
  }
  return result;
}

/**
 * 从 positions 数组计算每个三角面的法线和面积
 */
function computeFaceData(positions: Float32Array): {
  normals: Float32Array;
  areas: Float32Array;
} {
  const triCount = positions.length / 9;
  const normals = new Float32Array(triCount * 3);
  const areas = new Float32Array(triCount);

  for (let i = 0; i < triCount; i++) {
    const base = i * 9;
    const ax = positions[base]!,
      ay = positions[base + 1]!,
      az = positions[base + 2]!;
    const bx = positions[base + 3]!,
      by = positions[base + 4]!,
      bz = positions[base + 5]!;
    const cx = positions[base + 6]!,
      cy = positions[base + 7]!,
      cz = positions[base + 8]!;

    const ex = bx - ax,
      ey = by - ay,
      ez = bz - az;
    const fx = cx - ax,
      fy = cy - ay,
      fz = cz - az;

    const nx = ey * fz - ez * fy;
    const ny = ez * fx - ex * fz;
    const nz = ex * fy - ey * fx;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    normals[i * 3] = nx / len;
    normals[i * 3 + 1] = ny / len;
    normals[i * 3 + 2] = nz / len;

    areas[i] = 0.5 * len;
  }

  return { normals, areas };
}

/** 悬垂阈值：法线 z 分量 < -cos(45°) ≈ -0.707 时为悬垂面（>45° 倾斜朝下） */
const OVERHANG_NORMAL_Z_THRESHOLD = -Math.SQRT1_2;

/**
 * PolyJet 多材料喷射全彩打印支撑克重计算（核心算法）
 *
 * 双体积公式（修正版）：
 *   总支撑体积 = 外壳包裹体积 + 底部填充体积
 *
 *   外壳包裹体积 = 下半部分表面积 × 壳厚 (1mm)
 *     —— 下半部分 = Z ≤ wrapTopZ 的所有面（包括朝上的面，不只悬垂面）
 *     —— 跨越 wrapTopZ 的面按高度比例计算
 *
 *   底部填充体积 = max(0, 投影面积 × wrapTopZ - 模型在 [0, wrapTopZ] 区间内的体积)
 *     —— PolyJet 工艺中模型内部空腔也会被填充支撑材料
 *     —— 模型在区间内的体积按比例近似：modelVolume × (wrapTopZ / rotatedHeight)
 *
 *   wrapTopZ = rotatedHeight - 0.2mm（仅留 1-2 层给模型本身的最终封顶层）
 *     —— PolyJet 工艺：支撑逐层与模型同步沉积，打印完成时支撑延伸到接近模型顶部
 *     —— 不存在「顶部 10% 不需要支撑」——只要还有悬垂或侧面需要包裹，支撑就跟着堆
 *     —— 参考实拍图（打印中途）：黄色支撑凝胶从底部堆到当前打印层（约 50% 高度）
 *
 * @param positions 三角化顶点数据
 * @param normals 每个三角面的法线（已归一化）
 * @param areas 每个三角面的面积 (mm²)
 * @param rotXDeg X 轴旋转角度
 * @param rotYDeg Y 轴旋转角度
 * @param rotZDeg Z 轴旋转角度（手动微调）
 * @param gridSizeMM 栅格化精度
 * @param shellThicknessMM 壳层厚度（默认 1mm）
 * @param modelVolumeMM3 模型体积 (mm³)，用于底部填充减去实体部分
 * @param coloredFaceMask 每个三角面的彩色标记（1 = 有贴图/彩色）
 * @returns 外壳体积、填充体积、总克重、包裹面面积、悬垂面面积等
 */
export function computePolyJetSupport(
  positions: Float32Array,
  normals: Float32Array,
  areas: Float32Array,
  rotXDeg: number,
  rotYDeg: number,
  rotZDeg: number = 0,
  gridSizeMM: number = 1.0,
  shellThicknessMM: number = 1.0,
  modelVolumeMM3: number = 0,
  coloredFaceMask?: Uint8Array | null,
  fillRate: number = 0.37,
  densityGCm3: number = 1.15
): {
  shellVolumeMM3: number;
  fillVolumeMM3: number;
  totalVolumeMM3: number;
  totalWeightG: number;
  wrapAreaMM2: number; // 下半部分表面积（Z ≤ wrapTopZ 的面面积之和）
  overhangAreaMM2: number; // 悬垂面面积（nz < -cos(45°)）
  coloredWrapAreaMM2: number; // 下半部分彩色面面积
  coloredDownAreaMM2: number; // 朝下的彩色面面积（用于彩色保护判定）
  projectedAreaMM2: number;
  wrapTopZMM: number; // 包裹顶部 Z（用于 Shader 裁剪阈值）
  rotatedHeightMM: number;
} {
  const rotated = rotatePositions(positions, rotXDeg, rotYDeg, rotZDeg);

  // 计算包围盒
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;
  const vertCount = rotated.length / 3;
  const stride = Math.max(1, Math.floor(vertCount / 8000));
  for (let i = 0; i < vertCount; i += stride) {
    const x = rotated[i * 3]!;
    const y = rotated[i * 3 + 1]!;
    const z = rotated[i * 3 + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const rotatedHeight = maxZ - minZ;
  const zOffset = -minZ; // 使底部贴在 Z=0

  if (
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return {
      shellVolumeMM3: 0,
      fillVolumeMM3: 0,
      totalVolumeMM3: 0,
      totalWeightG: 0,
      wrapAreaMM2: 0,
      overhangAreaMM2: 0,
      coloredWrapAreaMM2: 0,
      coloredDownAreaMM2: 0,
      projectedAreaMM2: 0,
      wrapTopZMM: 0,
      rotatedHeightMM: rotatedHeight,
    };
  }

  // 设置栅格
  const MAX_CELLS = 200_000;
  let actualGridSize = gridSizeMM;
  let gridW = Math.ceil(width / actualGridSize);
  let gridH = Math.ceil(height / actualGridSize);
  if (gridW * gridH > MAX_CELLS) {
    const scale = Math.sqrt((gridW * gridH) / MAX_CELLS);
    actualGridSize = gridSizeMM * scale;
    gridW = Math.ceil(width / actualGridSize);
    gridH = Math.ceil(height / actualGridSize);
  }

  // 初始化栅格：
  // - coveredGrid: 标记单元是否被模型覆盖（用于投影面积）
  // - minZGrid: 该单元内模型最低点的 Z（用于填充高度）
  //   关键：填充体积 = Σ cellArea × minZ[cell]（每个 XY 单元从底板填到模型底面）
  //   这是真正依赖旋转角度的量：
  //     - 平躺时模型底面贴近底板，minZ 接近 0 → 填充体积小
  //     - 侧立时模型大部分悬空，minZ 大 → 填充体积大
  //   注意：旧公式 projectedArea × wrapTopZ - modelVolume 是错的（旋转不变），不能反映姿态差异
  const coveredGrid = new Uint8Array(gridW * gridH);
  const minZGrid = new Float32Array(gridW * gridH); // 模型底面 Z（初始为 Infinity，用 0 表示未覆盖）
  // 用 Float32Array 初始化为大值
  minZGrid.fill(1e9);

  const triCount = positions.length / 9;

  // === 第一遍：扫描所有面，统计悬垂面和朝下的彩色面（用于摆盘策略） ===
  // 注意：wrapTopZ 不再由悬垂面决定，而是接近模型顶部（顶部一小段无需支撑）
  let overhangArea = 0;
  let coloredDownArea = 0;

  for (let t = 0; t < triCount; t++) {
    const nx = normals[t * 3]!;
    const ny = normals[t * 3 + 1]!;
    const nz = normals[t * 3 + 2]!;
    const [, , rotatedNz] = rotateNormal(nx, ny, nz, rotXDeg, rotYDeg);

    const isColored = coloredFaceMask ? coloredFaceMask[t] === 1 : false;

    // 悬垂面检测：nz < -cos(45°)
    // 用于摆盘策略（统计悬垂面积以避免大悬垂角度），不直接决定 wrapTopZ
    if (rotatedNz < OVERHANG_NORMAL_Z_THRESHOLD) {
      overhangArea += areas[t]!;
      if (isColored) {
        coloredDownArea += areas[t]!;
      }
    }
  }

  // === wrapTopZ：接近模型顶部（仅留 1-2 层给模型本身的最终封顶层）===
  // PolyJet 工艺物理现实（用户提供的实拍图验证）：
  //   - 支撑材料逐层与模型同步沉积（边打模型边堆支撑）
  //   - 在打印过程中，支撑高度 = 当前打印层高度
  //   - 在打印完成时，支撑延伸到接近模型顶部（仅留最顶 1-2 层给模型本身的最终封顶层）
  //   - 不存在「顶部 10% 不需要支撑」的情况——只要还有悬垂或侧面需要包裹，支撑就跟着堆
  //
  // 参考实拍图：黄色支撑凝胶从底部一直堆到当前打印层（图中约 50% 高度），打印完成后将延伸到接近顶部
  const TOP_RESERVE_LAYERS = 0.2; // 顶部预留 0.2mm（约 10 层，PolyJet 层厚 16-30μm）
  let wrapTopZ = Math.max(0, rotatedHeight - TOP_RESERVE_LAYERS);
  // 安全限制：wrapTopZ 至少 1mm（避免极矮模型导致 0）
  if (wrapTopZ < 1 && rotatedHeight > 0) wrapTopZ = Math.min(rotatedHeight, 1);

  // === 第二遍：计算下半部分（Z ≤ wrapTopZ）的外壳包裹面积 ===
  // 用户要求：
  //   1) 「模型法线正面只需要沿着表面覆盖，不需要和底下对称覆盖」
  //      → 所有朝下面（nz < 0）都不参与外壳包裹
  //   2) 「不是悬垂薄壳，是一直有支撑下去」
  //      → 悬空朝下面下方的连续支撑由填充柱提供（从 Z=0 填到 minZ[cell]）
  //        不再需要在朝下面外侧加 1mm 薄壳
  let wrapArea = 0; // 下半部分表面积（仅 nz ≥ 0 的面，用于外壳体积）
  let coloredWrapArea = 0; // 下半部分彩色面面积（仅 nz ≥ 0）

  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    const z0 = rotated[base + 2]! + zOffset;
    const z1 = rotated[base + 5]! + zOffset;
    const z2 = rotated[base + 8]! + zOffset;
    const faceMinZ = Math.min(z0, z1, z2);
    const faceMaxZ = Math.max(z0, z1, z2);

    // 完全在 wrapTopZ 上方：不参与包裹
    if (faceMinZ > wrapTopZ) continue;

    // 用户要求：所有朝下面（nz < 0）都不参与外壳包裹
    // 悬空朝下面下方的支撑由填充柱负责
    const nx = normals[t * 3]!;
    const ny = normals[t * 3 + 1]!;
    const nz = normals[t * 3 + 2]!;
    const [, , rotatedNz] = rotateNormal(nx, ny, nz, rotXDeg, rotYDeg);
    if (rotatedNz < -0.01) continue;

    // 完全在 wrapTopZ 下方或恰好等于：整个面参与
    if (faceMaxZ <= wrapTopZ) {
      wrapArea += areas[t]!;
      if (coloredFaceMask && coloredFaceMask[t] === 1) {
        coloredWrapArea += areas[t]!;
      }
    } else {
      // 跨越 wrapTopZ：按高度比例计算下半部分面积
      const ratio = (wrapTopZ - faceMinZ) / (faceMaxZ - faceMinZ);
      wrapArea += areas[t]! * ratio;
      if (coloredFaceMask && coloredFaceMask[t] === 1) {
        coloredWrapArea += areas[t]! * ratio;
      }
    }
  }

  // === 第三遍：栅格化所有面到 XY 投影，记录每个单元的模型最低 Z ===
  // minZ[cell] = 该 XY 单元内模型「向下法线面」的最低 Z（真正的模型底面）
  //
  // 关键修复（用户反馈「不要上下对称，最上面是不平整的」）：
  //   - 仅向下法线面（rotatedNz < 0）参与 minZ 更新
  //   - 朝上面（rotatedNz > 0）的 faceMinZ 不应污染 minZ（否则模型顶面 Z 会拉低 minZ）
  //   - 这样 minZ 真正代表模型在该 cell 的「下方表面」Z
  for (let t = 0; t < triCount; t++) {
    const base = t * 9;
    const ax = rotated[base]! - minX;
    const ay = rotated[base + 1]! - minY;
    const az0 = rotated[base + 2]! + zOffset;
    const bx = rotated[base + 3]! - minX;
    const by = rotated[base + 4]! - minY;
    const bz0 = rotated[base + 5]! + zOffset;
    const cx = rotated[base + 6]! - minX;
    const cy = rotated[base + 7]! - minY;
    const cz0 = rotated[base + 8]! + zOffset;
    const faceMinZ = Math.min(az0, bz0, cz0);

    // 计算该面旋转后的法线 Z 分量
    const nx = normals[t * 3]!;
    const ny = normals[t * 3 + 1]!;
    const nz = normals[t * 3 + 2]!;
    const [, , rotatedNz] = rotateNormal(nx, ny, nz, rotXDeg, rotYDeg);
    const isDownwardFace = rotatedNz < -0.01;

    const txMin = Math.max(
      0,
      Math.floor(Math.min(ax, bx, cx) / actualGridSize)
    );
    const txMax = Math.min(
      gridW - 1,
      Math.floor(Math.max(ax, bx, cx) / actualGridSize)
    );
    const tyMin = Math.max(
      0,
      Math.floor(Math.min(ay, by, cy) / actualGridSize)
    );
    const tyMax = Math.min(
      gridH - 1,
      Math.floor(Math.max(ay, by, cy) / actualGridSize)
    );
    if (txMin > txMax || tyMin > tyMax) continue;

    const eAB = (px: number, py: number) =>
      (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    const eBC = (px: number, py: number) =>
      (cx - bx) * (py - by) - (cy - by) * (px - bx);
    const eCA = (px: number, py: number) =>
      (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
    const areaSign = eAB(cx, cy);
    const sign = areaSign >= 0 ? 1 : -1;

    for (let gy = tyMin; gy <= tyMax; gy++) {
      const py = (gy + 0.5) * actualGridSize;
      for (let gx = txMin; gx <= txMax; gx++) {
        const px = (gx + 0.5) * actualGridSize;
        const w0 = eAB(px, py) * sign;
        const w1 = eBC(px, py) * sign;
        const w2 = eCA(px, py) * sign;
        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
          const cellIdx = gy * gridW + gx;
          coveredGrid[cellIdx] = 1;
          // 仅向下法线面参与 minZ 更新
          if (isDownwardFace && faceMinZ < minZGrid[cellIdx]!) {
            minZGrid[cellIdx] = faceMinZ;
          }
        }
      }
    }
  }

  // === 膨胀覆盖区域：将外轮廓向外扩展多个网格单元 ===
  // PolyJet 工艺中支撑会显著超出模型外轮廓
  // 用户反馈「还是不够」：从 3mm 扩展到 8mm（与可视化对齐）
  const DILATE_RADIUS = 8; // 8 个网格单元（8mm）扩展半径
  const origCovered = new Uint8Array(coveredGrid);
  const dilatedGrid = new Uint8Array(gridW * gridH);
  for (let i = 0; i < coveredGrid.length; i++) dilatedGrid[i] = coveredGrid[i]!;
  for (let iter = 0; iter < DILATE_RADIUS; iter++) {
    const prevGrid = new Uint8Array(dilatedGrid);
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const idx = gy * gridW + gx;
        if (prevGrid[idx]) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = gx + dx,
                ny = gy + dy;
              if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
                dilatedGrid[ny * gridW + nx] = 1;
              }
            }
          }
        }
      }
    }
  }
  // 仅把 dilation 新增的 cell 加入 coveredGrid（不破坏原有 minZ）
  for (let i = 0; i < coveredGrid.length; i++) {
    if (dilatedGrid[i] && !origCovered[i]) {
      coveredGrid[i] = 1;
    }
  }

  // 计算投影面积 + 累计每个 cell 的 minZ（仅用于可视化高度，不影响克重）
  let coveredCells = 0;
  const cellArea = actualGridSize * actualGridSize;
  for (let i = 0; i < coveredGrid.length; i++) {
    if (coveredGrid[i]) coveredCells++;
  }
  const projectedArea = coveredCells * cellArea;

  // 外壳包裹体积 = 下半部分表面积 × 壳厚
  // 下半部分表面积 = wrapArea（仅 nz ≥ 0 的面，朝上和侧面）
  const shellVolume = wrapArea * shellThicknessMM;

  // === 底部填充体积（PolyJet 物理正确公式：column - model）===
  // PolyJet 工艺：水溶性支撑材料填满整个 XY 投影柱体（从底板 Z=0 到模型顶部 wrapTopZ），
  //   然后减去模型材料占据的体积（实际打印时该位置是模型材料，不是支撑）。
  //
  //   fillVolume = projectedArea × wrapTopZ − modelVolume
  //
  // 关键：这与「可视化顶部不平整」不冲突！
  //   - 可视化柱高 = minZ[cell]（顶部跟随模型底面，不平整，仅悬空区域有支撑柱）
  //   - 克重公式 = 投影柱体 - 模型体积（包含贴底区域的支撑填充，物理正确）
  //
  // 用户反馈：「模型躺平时实际支撑 100g，但显示 24g」
  //   原因：之前用 Σ cellArea × minZ[cell]，模型贴底时所有 minZ ≈ 0，fillVolume ≈ 0
  //   但 PolyJet 实际工艺中，模型贴底时仍然有支撑材料填满周围空隙（蜂窝填充）
  //   所以必须用「柱体 - 模型」公式才能匹配真实测量
  //
  // 用户反馈：「不要上下对称，最上面是不平整的」
  //   这是可视化要求 — 顶部不应是平整的 wrapTopZ，而应跟随模型底面
  //   可视化已修复（柱高 = minZ[cell]），但克重计算不应受此影响
  //
  // 0.33 是 PolyJet 支撑材料的稀疏填充率（蜂窝状结构）
  // 0.0012 g/mm³ = 1.2 g/cm³（PolyJet 水溶性支撑材料密度）
  const projectionColumnVolume = projectedArea * wrapTopZ;
  const fillVolume = Math.max(0, projectionColumnVolume - modelVolumeMM3);

  const totalVolume = (shellVolume + fillVolume) * fillRate;
  const totalWeightG = totalVolume * (densityGCm3 * 0.001);

  // 调试：输出关键中间量，便于核对真实克重
  if (
    typeof window !== "undefined" &&
    rotXDeg % 45 === 0 &&
    rotYDeg % 45 === 0
  ) {
    console.log(
      `[computePolyJetSupport] rotX=${rotXDeg}°, rotY=${rotYDeg}°: ` +
        `projArea=${projectedArea.toFixed(0)}mm², wrapTopZ=${wrapTopZ.toFixed(1)}mm, ` +
        `colVol=${projectionColumnVolume.toFixed(0)}mm³, modelVol=${modelVolumeMM3.toFixed(0)}mm³, ` +
        `fillVol=${fillVolume.toFixed(0)}mm³, shellVol=${shellVolume.toFixed(0)}mm³, ` +
        `weight=${totalWeightG.toFixed(2)}g`
    );
  }

  return {
    shellVolumeMM3: shellVolume,
    fillVolumeMM3: fillVolume,
    totalVolumeMM3: totalVolume,
    totalWeightG,
    wrapAreaMM2: wrapArea,
    overhangAreaMM2: overhangArea,
    coloredWrapAreaMM2: coloredWrapArea,
    coloredDownAreaMM2: coloredDownArea,
    projectedAreaMM2: projectedArea,
    wrapTopZMM: wrapTopZ,
    rotatedHeightMM: rotatedHeight,
  };
}

/**
 * 旧版 API 保留：兼容旧调用（返回结构与之前一致，但内部使用新算法）
 */
export function computeExternalSurfaceArea(positions: Float32Array): number {
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;
  const vertCount = positions.length / 3;
  for (let i = 0; i < vertCount; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const dimX = maxX - minX;
  const dimY = maxY - minY;
  const dimZ = maxZ - minZ;
  return 2 * (dimX * dimY + dimX * dimZ + dimY * dimZ);
}

/** @deprecated 保留兼容性 */
export function computeEffectiveExternalSurface(
  positions: Float32Array
): number {
  const triCount = positions.length / 9;
  let totalTriangleArea = 0;
  for (let i = 0; i < triCount; i++) {
    const base = i * 9;
    const ax = positions[base]!,
      ay = positions[base + 1]!,
      az = positions[base + 2]!;
    const bx = positions[base + 3]!,
      by = positions[base + 4]!,
      bz = positions[base + 5]!;
    const cx = positions[base + 6]!,
      cy = positions[base + 7]!,
      cz = positions[base + 8]!;
    const ex = bx - ax,
      ey = by - ay,
      ez = bz - az;
    const fx = cx - ax,
      fy = cy - ay,
      fz = cz - az;
    const crossX = ey * fz - ez * fy;
    const crossY = ez * fx - ex * fz;
    const crossZ = ex * fy - ey * fx;
    const len = Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
    totalTriangleArea += len / 2;
  }
  const bboxArea = computeExternalSurfaceArea(positions);
  return Math.min(totalTriangleArea, bboxArea);
}

/** @deprecated 保留兼容性 */
export function computeRotatedExternalSurface(
  positions: Float32Array,
  _rotXDeg: number,
  _rotYDeg: number,
  _rotZDeg: number = 0
): number {
  return computeEffectiveExternalSurface(positions);
}

/**
 * 计算给定角度下的支撑克重和本体支撑比例（用于手动角度调整时实时重算）
 *
 * @param positions 三角化顶点数据
 * @param rotXDeg X 轴旋转角度
 * @param rotYDeg Y 轴旋转角度
 * @param modelWeightG 模型本体克重（g）
 * @param scaleFactor 自选尺寸缩放因子
 * @param rotZDeg Z 轴旋转角度
 * @param modelVolumeMM3 模型体积 (mm³)
 * @param coloredFaceMask 彩色面标记
 * @returns 支撑克重和本体支撑比例
 */
export function computeSupportAtAngle(
  positions: Float32Array,
  rotXDeg: number,
  rotYDeg: number,
  modelWeightG: number,
  scaleFactor: number = 1,
  rotZDeg: number = 0,
  modelVolumeMM3: number = 0,
  coloredFaceMask?: Uint8Array | null,
  fillRate: number = 0.37,
  shellThicknessMM: number = 1.0,
  densityGCm3: number = 1.15
): { supportWeight: number; supportRatio: number } {
  const { normals, areas } = computeFaceData(positions);
  const r = computePolyJetSupport(
    positions,
    normals,
    areas,
    rotXDeg,
    rotYDeg,
    rotZDeg,
    1.0,
    shellThicknessMM,
    modelVolumeMM3,
    coloredFaceMask,
    fillRate,
    densityGCm3
  );

  // 应用缩放因子：体积按 k³ 缩放，所以克重按 k³ 缩放
  const scaledWeight = r.totalWeightG * scaleFactor * scaleFactor * scaleFactor;
  const supportRatio = modelWeightG > 0 ? scaledWeight / modelWeightG : 0;

  return { supportWeight: scaledWeight, supportRatio };
}

/**
 * 智能搜索最优打印角度（PolyJet 双体积公式 + 彩色面硬保护）
 *
 * 策略：
 * 1. 平面模型（Z ≤ 最短轴×0.5）→ 直接平放
 * 2. 非平面模型 → 在高度最低 30% 候选中，按以下优先级筛选：
 *    a. 首选彩色包裹面积 = 0 的角度（完全不破坏彩色面）
 *    b. 若无零包裹角度，选彩色包裹面积最小的（次优解）
 *    c. 在同组彩色包裹面积下，选支撑克重最小的
 * 3. 若最优角度高度仍 > 原始高度 70% → 强制选最低高度
 *
 * @param positions 三角化顶点数据
 * @param totalSurfaceAreaMM2 总表面积（mm²，仅用于返回 totalArea 字段）
 * @param onProgress 进度回调
 * @param maxHeightMM 高度阈值（保留参数）
 * @param modelWeightG 模型本体克重（g）
 * @param scaleFactor 自选尺寸缩放因子
 * @param modelVolumeMM3 模型体积 (mm³)
 * @param coloredFaceMask 每个三角面的彩色标记
 * @param coarseMode 拖拽中粗算模式：栅格 5mm，步长 30°
 */
export function findOptimalAngle(
  positions: Float32Array,
  totalSurfaceAreaMM2: number,
  onProgress?: (percent: number) => void,
  maxHeightMM: number = 50,
  modelWeightG: number = 0,
  scaleFactor: number = 1,
  modelVolumeMM3: number = 0,
  coloredFaceMask?: Uint8Array | null,
  coarseMode: boolean = false,
  fillRate: number = 0.37,
  shellThicknessMM: number = 1.0,
  densityGCm3: number = 1.15
): OptimalAngle {
  const { normals, areas } = computeFaceData(positions);

  // 候选角度范围：-180° 到 180°（覆盖完整 360° 旋转）
  // 这样可以找到「翻转」角度（如 180° X 翻转，让模型底部朝上）
  // 粗算步长 30°（13×13=169 候选），精算步长 15°（25×25=625 候选）
  const step = coarseMode ? 30 : 15;
  const angles: number[] = [];
  for (let a = -180; a <= 180; a += step) angles.push(a);
  const gridSize = coarseMode ? 5.0 : 1.0;
  const hasColoredMask = coloredFaceMask && coloredFaceMask.length > 0;

  type Candidate = {
    rotX: number;
    rotY: number;
    supportWeight: number;
    projectedArea: number;
    overhangArea: number;
    coloredWrapArea: number;
    wrapArea: number;
    shellVolume: number;
    fillVolume: number;
    wrapTopZ: number;
    rotatedHeight: number;
  };
  const candidates: Candidate[] = [];

  /**
   * 在候选列表中选出指定指标最小的项（列表为空时返回 undefined）
   */
  const pickSmallest = (
    list: Candidate[],
    metric: (c: Candidate) => number
  ): Candidate | undefined => {
    if (list.length === 0) return undefined;
    return list.reduce(
      (min, c) => (metric(c) < metric(min) ? c : min),
      list[0]!
    );
  };

  const totalCombos = angles.length * angles.length;
  let combo = 0;
  const k3 = scaleFactor * scaleFactor * scaleFactor;

  for (const rotX of angles) {
    for (const rotY of angles) {
      const r = computePolyJetSupport(
        positions,
        normals,
        areas,
        rotX,
        rotY,
        0,
        gridSize,
        shellThicknessMM,
        modelVolumeMM3,
        coloredFaceMask,
        fillRate,
        densityGCm3
      );
      candidates.push({
        rotX,
        rotY,
        supportWeight: r.totalWeightG * k3,
        projectedArea: r.projectedAreaMM2 * scaleFactor * scaleFactor,
        overhangArea: r.overhangAreaMM2 * scaleFactor * scaleFactor,
        coloredWrapArea: r.coloredWrapAreaMM2 * scaleFactor * scaleFactor,
        wrapArea: r.wrapAreaMM2 * scaleFactor * scaleFactor,
        shellVolume: r.shellVolumeMM3 * k3,
        fillVolume: r.fillVolumeMM3 * k3,
        wrapTopZ: r.wrapTopZMM * scaleFactor,
        rotatedHeight: r.rotatedHeightMM * scaleFactor,
      });
      combo++;
      onProgress?.(Math.round((combo / totalCombos) * 100));
    }
  }

  // 模型原始包围盒
  let origMinX = Infinity,
    origMaxX = -Infinity;
  let origMinY = Infinity,
    origMaxY = -Infinity;
  let origMinZ = Infinity,
    origMaxZ = -Infinity;
  const vertCount = positions.length / 3;
  const stride = Math.max(1, Math.floor(vertCount / 5000));
  for (let i = 0; i < vertCount; i += stride) {
    const x = positions[i * 3]!,
      y = positions[i * 3 + 1]!,
      z = positions[i * 3 + 2]!;
    if (x < origMinX) origMinX = x;
    if (x > origMaxX) origMaxX = x;
    if (y < origMinY) origMinY = y;
    if (y > origMaxY) origMaxY = y;
    if (z < origMinZ) origMinZ = z;
    if (z > origMaxZ) origMaxZ = z;
  }
  const dimX = origMaxX - origMinX;
  const dimY = origMaxY - origMinY;
  const dimZ = origMaxZ - origMinZ;
  const minDim = Math.min(dimX, dimY, dimZ);
  const isFlatModel = dimZ <= minDim * 0.5;

  let best: Candidate | undefined;

  if (isFlatModel) {
    best =
      candidates.find((c) => c.rotX === 0 && c.rotY === 0) ?? candidates[0]!;
  } else {
    // ───────────────────────────────────────────────────────────────
    // 硬约束：旋转后模型高度不得超过 maxHeightMM（默认 50mm）
    //   原因：用户要求「模型超过 50mm 的都不能立着」
    //         PolyJet 工艺下，立式摆放会让模型在 Z 方向过高，打印时间长、支撑消耗大、且容易失败
    //   实现：先剔除所有 rotatedHeight > maxHeightMM 的候选
    //         若全部候选都超过限制（模型所有方向都 >50mm），则按高度升序取最低的 10% 兜底
    // ───────────────────────────────────────────────────────────────
    let eligibleCandidates = candidates.filter(
      (c) => c.rotatedHeight <= maxHeightMM
    );
    if (eligibleCandidates.length === 0) {
      // 模型所有方向都超过 maxHeightMM → 选最低的姿态（最接近限制）
      console.warn(
        `[findOptimalAngle] All candidates exceed maxHeightMM=${maxHeightMM}mm, ` +
          `falling back to lowest-height candidates`
      );
      const sortedByH = [...candidates].sort(
        (a, b) => a.rotatedHeight - b.rotatedHeight
      );
      const fallbackCount = Math.max(1, Math.floor(sortedByH.length * 0.1));
      eligibleCandidates = sortedByH.slice(0, fallbackCount);

      // 在 fallback 中，优先选择「正交姿态」（rotX、rotY ∈ {-90, 0, 90}）
      //   原因：当所有姿态都超 50mm 时，模型本来就不可能完全平躺。
      //         此时选「正交」（贴在某个完整侧面上）比「略微倾斜」（如 -15°/120°）
      //         更稳定，打印质量也更好——倾斜会让模型底面只有一条线/一个点接触底板。
      const canonical = eligibleCandidates.filter(
        (c) => Math.abs(c.rotX % 90) < 1 && Math.abs(c.rotY % 90) < 1
      );
      if (canonical.length > 0) {
        eligibleCandidates = canonical;
      }
    }

    // 策略修正：先按 fillVolume 排序，再在 fillVolume 接近最小的候选中选 shellVolume 最小的
    // 原因：
    //   - fillVolume（投影柱体体积 - 模型体积）是真正依赖姿态的量：
    //     平躺时投影柱体小（高度低），fillVolume 小
    //     立着时投影柱体大（高度高），fillVolume 大
    //   - shellVolume（外壳包裹）也依赖姿态，但变化幅度小（约 7000-9000 mm³）
    //   - 所以先取 fillVolume 最小的前 10% 候选，再在其中选 shellVolume 最小的
    //     这样能找到「最大底面贴地 + 最少外壳包裹」的最优姿态
    const sortedByFill = [...eligibleCandidates].sort(
      (a, b) => a.fillVolume - b.fillVolume
    );
    const topFillCount = Math.max(1, Math.floor(sortedByFill.length * 0.1));
    const topFill = sortedByFill.slice(0, topFillCount);

    let picked: Candidate | undefined;
    if (hasColoredMask) {
      // 优先选彩色包裹面积为 0 的角度（避免破坏彩色面）
      const zeroColored = topFill.filter((c) => c.coloredWrapArea < 1); // <1 mm² 视为 0
      picked =
        zeroColored.length > 0
          ? // 在零彩色包裹的候选中选 shellVolume 最小的
            pickSmallest(zeroColored, (c) => c.shellVolume)
          : // 次选：彩色包裹面积最小的
            pickSmallest(topFill, (c) => c.coloredWrapArea);
    } else {
      // 无彩色标记：在 fillVolume 最小的前 10% 中选 shellVolume 最小的
      picked = pickSmallest(topFill, (c) => c.shellVolume);
    }

    // 安全兜底
    best = picked ?? sortedByFill[0]!;
  }

  // 兜底：候选集永不为空（angles 至少含 13 个角度）
  const chosen = best!;

  // 注：之前的「强制选最低高度」规则已删除
  // 原因：新策略直接最小化 fillVolume，已经隐含选择最大底面贴地的姿态
  // （fillVolume = 0 当且仅当模型底面完全贴地）

  const selfSupportRatio =
    modelWeightG > 0 ? chosen.supportWeight / modelWeightG : 0;

  // 计算原始姿态（rotX=0, rotY=0）的支撑数据，用于 UI 对比展示
  const originalCandidate = candidates.find(
    (c) => c.rotX === 0 && c.rotY === 0
  );
  const originalWeight = originalCandidate
    ? originalCandidate.supportWeight
    : chosen.supportWeight;
  const originalRatio =
    chosen.supportWeight > 0 ? originalWeight / chosen.supportWeight : 1;

  // 调试：输出 Top 5 候选角度（按 fillVolume 排序）
  const allCandidates = [...candidates].sort(
    (a, b) => a.fillVolume - b.fillVolume
  );
  if (typeof window !== "undefined") {
    console.log(
      "[findOptimalAngle] Top 5 candidates by fillVolume (lower = better):"
    );
    for (const c of allCandidates.slice(0, 5)) {
      console.log(
        `  rotX=${c.rotX}°, rotY=${c.rotY}°: fillVol=${c.fillVolume.toFixed(0)}mm³, height=${c.rotatedHeight.toFixed(1)}mm, totalWeight=${c.supportWeight.toFixed(3)}g`
      );
    }
    console.log(
      `[findOptimalAngle] Selected: rotX=${chosen.rotX}°, rotY=${chosen.rotY}°, fillVol=${chosen.fillVolume.toFixed(0)}mm³, totalWeight=${chosen.supportWeight.toFixed(3)}g, height=${chosen.rotatedHeight.toFixed(1)}mm`
    );
    if (originalCandidate) {
      console.log(
        `[findOptimalAngle] Original pose (0°,0°): totalWeight=${originalWeight.toFixed(3)}g (${originalRatio.toFixed(2)}× of optimal)`
      );
    }
  }

  return {
    rotX: chosen.rotX,
    rotY: chosen.rotY,
    selfSupportRatio,
    selfSupportArea: chosen.projectedArea,
    totalSupportRatio: selfSupportRatio,
    totalSupportWeight: chosen.supportWeight,
    totalArea: totalSurfaceAreaMM2 / 100,
    rotatedHeight: chosen.rotatedHeight,
    laidFlat: true,
    overhangArea: chosen.overhangArea,
    coloredDownArea: chosen.coloredWrapArea,
    wrapArea: chosen.wrapArea,
    shellVolume: chosen.shellVolume,
    fillVolume: chosen.fillVolume,
    wrapTopZ: chosen.wrapTopZ,
    originalWeight: originalWeight * 1,
    originalRatio,
  };
}

/** 生成旋转角度（弧度）用于 three.js Object3D.rotation 设置 */
export function getRotationEuler(
  rotXDeg: number,
  rotYDeg: number
): { x: number; y: number; z: number } {
  return {
    x: (rotXDeg * Math.PI) / 180,
    y: (rotYDeg * Math.PI) / 180,
    z: 0,
  };
}
