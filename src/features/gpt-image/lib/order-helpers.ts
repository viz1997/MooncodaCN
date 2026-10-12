/**
 * 订单 JSON 字段解析工具
 *
 * uploadedImages / candidates / selections 都是 JSON 列，
 * 数据库返回 string | null，前端使用前需解析。
 *
 * 字段语义（2026-08 起去 base64 改造后）：
 * - uploadedImages[i]：用户上传的第 i 张原图的 https URL（R2 公开域）
 * - candidates[i][j]：第 i 张原图的第 j 张效果图的 https URL（Lingting 上游 / R2 占位）
 */

/** 解析 candidates JSON：兼容旧 flat 结构与新嵌套数组结构 */
export function parseCandidates(raw: string | null | undefined): string[][] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // 旧 flat 结构：单层字符串数组
    if (arr.length > 0 && typeof arr[0] === "string") {
      return [arr as string[]];
    }
    return arr as string[][];
  } catch {
    return [];
  }
}

/** 解析 uploadedImages：返回 https URL 字符串数组 */
export function parseUploadedImages(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as string[]) : [];
  } catch {
    return [];
  }
}

/** 解析 selections：每张原图的候选索引（未选为 null） */
export function parseSelections(
  raw: string | null | undefined
): (number | null)[] | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.map((v: unknown) => (typeof v === "number" ? v : null));
  } catch {
    return null;
  }
}

/**
 * 计算已生成的候选组数（外层数组里**非空**槽位的数量）。
 *
 * 历史背景：旧版直接 `candidates.length` 返回外层长度。这在「嵌套数组已
 * fillSparseSlots 填到 total 长度」的写入路径下永远是 total，让前端进度
 * 一进入 GENERATING 就 isAllDone=true、displayPercent=100%——但实际上
 * 此时所有 nested[i] 还是 []，一张候选都没出来。
 *
 * 修正语义：candidates 是「稀疏」结构，外层长度是 `uploadedImageCount`
 * 派生的槽位壳，**是否真的生成了**看 inner 数组 length。空 inner = 该图
 * 还没就绪，非空 inner = 已就绪（含一张宫格拼接图）。这样前端可以
 * 用真实完成度驱动 done / realPercent / isAllDone，假进度 RAF 才有跑
 * 的机会（否则永远 isAllDone 短路）。
 */
export function countCandidateGroups(candidates: string[][]): number {
  let n = 0;
  for (const g of candidates) {
    if (Array.isArray(g) && g.length > 0) n++;
  }
  return n;
}

/** 计算上传图片数 */
export function countUploadedImages(uploaded: string[]): number {
  return uploaded.length;
}

/** 计算已选择数量 */
export function countSelections(selections: (number | null)[] | null): number {
  if (!selections) return 0;
  return selections.filter((v) => v !== null).length;
}
