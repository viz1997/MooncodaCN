/**
 * 磁吸孔切割的焊接 —— **「同一个点算出来差一点点」的模型照样能切**
 *
 * ## 为什么单独写一层(2026-11-11)
 *
 * 工作室拿真实模型试的时候,报了:
 *
 * ```
 * 自动修复之后这个模型还是不封闭(还剩 461 条开放边 / 15 条非流形边)
 * ```
 *
 * 看着像「模型太破」,其实**不是模型的问题,是我们的焊接太严**。
 *
 * 仓库那份 `weldAndAnalyzeTopology()` 的焊接容差是:
 *
 * ```ts
 * const tol = Math.max(1e-9, diag * 1e-7);   // 40mm 的模型 = 0.000004mm
 * ```
 *
 * 而 **Blender 的 `remove_doubles` 默认是 0.1mm** —— 粗了**两万五千倍**。
 * 工作室自己的那段 Blender 脚本第一件事就是 `remove_doubles`。
 *
 * 后果:AI 生成的模型(Meshy / Tripo 导出)里,同一个逻辑顶点被不同公式
 * 算出来差个 1e-4mm 是**常事**(float32 舍入、UV 接缝、法线重算……)。
 * 我们那份严到 4e-6mm 的焊接**焊不上** ⇒ 每个这样的点都在网格上留下一
 * 条「开放边」⇒ 一个本来完好的模型被我们看成「几百条破边」。
 *
 * 实测(诊断脚本):
 *
 * | 模型 | 我们焊接前的开放边 |
 * |---|---|
 * | 完好的立方体 | 0 |
 * | 立方体,每个面的顶点各复制一份并扰动 **1e-4mm** | **36** |
 * | 立方体,扰动 **1e-3mm** | **36** |
 *
 * —— 差了 1e-4mm 就被当成「破模型」,这就是 461 的来源。
 *
 * ## 这一层干什么
 *
 * **把「同一个点」焊上,让模型回到它本来的样子** —— 不补洞、不删面、
 * 不改形状。焊完之后模型该封闭就封闭,布尔运算直接就能用。
 *
 * - **量化焊接** —— 跟仓库 `weld.ts` 一个口径(把坐标量化到网格点,
 *   落进同一个格子的算同一个顶点,保留第一个点的坐标)。
 *   但**键的编码换了**:仓库那份把三个轴各占 19 位(共 57 位),**超过
 *   double 的 53 位尾数** —— 值一大就丢低位,顶点会被错误地合并。
 *   这里用**线性键**(`(cx * cellsY + cy) * cellsZ + cz`),并带一条
 *   「格子太多就把容差放大」的兜底。
 * - **阶梯容差** —— 从最严(1e-5 × 包围盒对角线)一路放宽到 Blender 的
 *   0.1mm 级别,**焊到模型封闭就停**。
 *   阶梯本身就是「多试几遍」:同一对顶点被第一档的格子边界劈开,
 *   下一档格子大十倍,基本上就落进同一个格子里了。
 *
 * ## 为什么不直接用仓库那份 `weldAndAnalyzeTopology()`
 *
 * 它的容差写死在函数里(`diag * 1e-7`),而且 `weldVertices` 是模块私有的,
 * 拿不到、也改不了。**不动它**(那个函数整个仓库都在用:工作台的检查、
 * 支撑体积、包围盒……),这里另写一份**只给磁吸孔用**的。
 */
import { weldAndAnalyzeTopology } from "@/features/tools/lib/mesh/weld";

/** 包围盒 */
interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** 算包围盒(顺便丢掉 NaN / 无穷) */
function bboxOf(positions: Float32Array): Box | null {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!,
      y = positions[i + 1]!,
      z = positions[i + 2]!;
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
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/** 包围盒对角线 */
function diagOf(box: Box): number {
  const dx = box.maxX - box.minX;
  const dy = box.maxY - box.minY;
  const dz = box.maxZ - box.minZ;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Number.isFinite(d) && d > 0 ? d : 1;
}

/**
 * 焊接阶梯 —— 从最严到最松(mm)
 *
 * 以**包围盒对角线**为基准(模型多大,容差跟着走),每一档还有一个
 * **绝对上限** —— 最松的一档不超过 **0.1mm**,那正是 Blender
 * `remove_doubles` 的默认值(工作室自己那段脚本第一件事就是它)。
 * 小模型靠绝对上限不会被焊变形,大模型靠相对值不会被焊得太粗。
 *
 * | 档 | 相对 | 绝对上限 | 40mm 的模型 | 抓什么 |
 * |---|---|---|---|---|
 * | 1 | diag × 1e-5 | 0.001mm | 0.0007mm | float32 舍入噪声 |
 * | 2 | diag × 1e-4 | 0.01mm | 0.0069mm | 不同公式算出来的同一个点 |
 * | 3 | diag × 1e-3 | 0.05mm | 0.05mm | 导出器留的缝 |
 * | 4 | diag × 2.5e-3 | **0.1mm** | 0.1mm | **Blender remove_doubles 的默认档** |
 */
export function magnetWeldLadder(diag: number): number[] {
  const d = Number.isFinite(diag) && diag > 0 ? diag : 1;
  const rel = [1e-5, 1e-4, 1e-3, 2.5e-3];
  const cap = [0.001, 0.01, 0.05, 0.1];
  return rel.map((f, i) => Math.max(Math.min(d * f, cap[i]!), 1e-6));
}

/**
 * 一次量化焊接
 *
 * 把坐标量化到边长 `tol` 的网格上,落进**同一个格子**的顶点算同一个
 * 顶点(保留第一个点的坐标 —— 不动几何)。
 *
 * 返回的三角汤**面序不变** —— 调用方靠面序把 UV / 材质对回去。
 *
 * ## 两个计数
 *
 * - `merged` —— 合并掉多少个顶点。**三角汤天生就有重复顶点**(共享一个
 *   角点的两个面各带一份)⇒ 这个数对每个模型都很大,没什么信息量。
 * - `mergedApprox` —— 其中**坐标不完全相同**的那些(真的差了 1e-4mm
 *   之类的)。**这才是有意思的数** —— 它说明「模型里有几个点其实
 *   是同一个点,只是算出来差了一点」。界面上摆的是这个。
 */
export function weldMagnetSoup(
  positions: Float32Array,
  tol: number
): { positions: Float32Array; merged: number; mergedApprox: number } {
  const vertexCount = positions.length / 3;
  if (vertexCount === 0 || !(tol > 0)) {
    return { positions, merged: 0, mergedApprox: 0 };
  }
  const box = bboxOf(positions);
  if (!box) return { positions, merged: 0, mergedApprox: 0 };

  const q = 1 / tol;
  // 格子数 —— 每一维都是「跨度 / 容差 + 1」
  let cellsX = Math.floor((box.maxX - box.minX) * q) + 1;
  let cellsY = Math.floor((box.maxY - box.minY) * q) + 1;
  let cellsZ = Math.floor((box.maxZ - box.minZ) * q) + 1;
  // 线性键要装进 double 的 53 位尾数 ⇒ 格子总数不能太大
  // (格子太多就把容差放大 —— 那说明这一档已经细过头了)
  let guard = 8;
  while (guard-- > 0 && cellsX * cellsY * cellsZ > 4.5e15) {
    tol *= 2;
    const q2 = 1 / tol;
    cellsX = Math.floor((box.maxX - box.minX) * q2) + 1;
    cellsY = Math.floor((box.maxY - box.minY) * q2) + 1;
    cellsZ = Math.floor((box.maxZ - box.minZ) * q2) + 1;
  }

  const map = new Map<number, number>();
  const vertList: number[] = [];
  const remap = new Uint32Array(vertexCount);
  let merged = 0;
  let mergedApprox = 0;

  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3]!,
      y = positions[i * 3 + 1]!,
      z = positions[i * 3 + 2]!;
    const cx = Math.floor((x - box.minX) * q);
    const cy = Math.floor((y - box.minY) * q);
    const cz = Math.floor((z - box.minZ) * q);
    const key = (cx * cellsY + cy) * cellsZ + cz;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = vertList.length / 3;
      map.set(key, idx);
      vertList.push(x, y, z);
    } else {
      merged++;
      // 代表点的坐标跟这个点**不完全一样** ⇒ 近似重复(有意思的那种)
      if (
        vertList[idx * 3] !== x ||
        vertList[idx * 3 + 1] !== y ||
        vertList[idx * 3 + 2] !== z
      ) {
        mergedApprox++;
      }
    }
    remap[i] = idx;
  }

  if (!merged) return { positions, merged: 0, mergedApprox: 0 };

  // 重建三角汤(顶点数没变,只是坐标被换成代表点的)
  const out = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount; i++) {
    const v = remap[i]!;
    out[i * 3] = vertList[v * 3]!;
    out[i * 3 + 1] = vertList[v * 3 + 1]!;
    out[i * 3 + 2] = vertList[v * 3 + 2]!;
  }
  return { positions: out, merged, mergedApprox };
}

/** 焊接的结果 */
export interface MagnetWeldResult {
  /** 焊完之后的三角汤 */
  positions: Float32Array;
  /** 合并掉多少个顶点(含三角汤天生的重复) */
  merged: number;
  /** 其中坐标不完全相同的那些(真的「差了 1e-4mm」的) */
  mergedApprox: number;
  /** 用的容差(mm)—— 0 = 一档都没用上 */
  toleranceMm: number;
  /** 焊完之后封闭了吗 */
  closed: boolean;
  /** 还剩多少条开放边 / 非流形边 */
  openEdges: number;
  nonManifoldEdges: number;
}

/**
 * 焊到封闭为止
 *
 * 阶梯逐档放宽容差,**每一档焊完都查一次拓扑**;封闭了就停。
 *
 * 为什么要阶梯而不是一档到位:一档太严 ⇒ 噪声顶点焊不上(几百条假开放
 * 边);一档太松 ⇒ 会把本来分开的两个点焊到一起(模型变形)。
 * 阶梯从严到宽,**停在刚好够的那一档** ⇒ 该焊的焊上,不该焊的没动。
 */
export function weldMagnetUntilClosed(
  positions: Float32Array
): MagnetWeldResult {
  const box = bboxOf(positions);
  if (!box) {
    return {
      positions,
      merged: 0,
      mergedApprox: 0,
      toleranceMm: 0,
      closed: false,
      openEdges: 0,
      nonManifoldEdges: 0,
    };
  }

  let working = positions;
  let mergedTotal = 0;
  let mergedApproxTotal = 0;
  let toleranceMm = 0;
  let openEdges = 0;
  let nonManifoldEdges = 0;

  for (const tol of magnetWeldLadder(diagOf(box))) {
    const r = weldMagnetSoup(working, tol);
    if (!r.merged) continue; // 这一档没焊上任何东西 ⇒ 换下一档
    working = r.positions;
    mergedTotal += r.merged;
    mergedApproxTotal += r.mergedApprox;
    toleranceMm = tol;

    let topo: ReturnType<typeof weldAndAnalyzeTopology>;
    try {
      topo = weldAndAnalyzeTopology(working);
    } catch {
      continue; // 这一档把模型焊坏了(极端几何)⇒ 换下一档
    }
    openEdges = topo.components.reduce((s, c) => s + c.openEdges, 0);
    nonManifoldEdges = topo.components.reduce(
      (s, c) => s + c.nonManifoldEdges,
      0
    );
    if (openEdges === 0 && nonManifoldEdges === 0) {
      return {
        positions: working,
        merged: mergedTotal,
        mergedApprox: mergedApproxTotal,
        toleranceMm,
        closed: true,
        openEdges: 0,
        nonManifoldEdges: 0,
      };
    }
  }

  // 一档都没能焊上 ⇒ 原样返回(后面的「补洞」那层再想办法)
  return {
    positions: working,
    merged: mergedTotal,
    mergedApprox: mergedApproxTotal,
    toleranceMm,
    closed: false,
    openEdges,
    nonManifoldEdges,
  };
}
