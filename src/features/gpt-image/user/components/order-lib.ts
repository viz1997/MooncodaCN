/**
 * 订单页公用辅助函数
 *
 * 之前散落在 status-screens.tsx / mock-data.ts 等地方，这里集中到一处。
 */

export { sanitizeErrorMessage } from "@/features/gpt-image/lib/sanitize-error-message";

/**
 * 把 ISO 时间格式化为 "刚刚 / X 分钟前 / X 小时前 / X 天前 / YYYY-MM-DD"
 * 默认值用 Date.now()，便于测试时注入固定时间。
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, now - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

/**
 * 完整时间戳（用于 title tooltip 等次要展示）
 */
export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 把秒数格式化为"约 X 秒" / "约 X 分 Y 秒" */
export function formatEta(sec: number): string {
  if (sec <= 0) return "即将完成";
  if (sec < 60) return `约 ${sec} 秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `约 ${m} 分钟` : `约 ${m} 分 ${s} 秒`;
}

/**
 * 根据候选数计算宫格的 (cols, rows)。
 * candidateCount=1 → (1,1)，=2 → (2,1)，=4 → (2,2)，>=9 → (3,3)。
 */
export function quadrantLayout(candidateCount: number): {
  cols: number;
  rows: number;
} {
  if (candidateCount === 1) return { cols: 1, rows: 1 };
  if (candidateCount === 2) return { cols: 2, rows: 1 };
  if (candidateCount === 4) return { cols: 2, rows: 2 };
  return { cols: 3, rows: 3 };
}
