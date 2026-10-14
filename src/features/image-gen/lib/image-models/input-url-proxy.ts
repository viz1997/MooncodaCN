/**
 * 2026-10-14 输入图代理到 R2 —— 纯函数 + fetch helper
 *
 * 背景：apimart.ai 等上游生图模型需要服务端可达的 URL 来 fetch 输入
 * 参考图。如果 mp / 浏览器 / 第三方 client 直接传外部存储 URL
 * (典型带 `?sign=...&t=...` 的临时签名 URL,如腾讯 CloudBase
 * `*.tcb.qcloud.la`),apimart fetch 会因:
 *   - 签名过期(几天到几小时)
 *   - 跨服务商网络隔离(apimart.ai → tcb.qcloud.la 不通)
 *   - IP / Referer 白名单
 * 而 403。本文件提供把外部 URL 一次性转存到自有 R2 的能力,R2 永久
 * 公开 + 全网可达,上游一定能拿到。
 *
 * 复用 gpt-image/lib/generation-service 已有的 persistCandidateToR2
 * (wellapi URL TTL 教训下的产物)。失败抛错,不静默透传(避免上游
 * 拿到会过期的 URL 后几天整批图破)。
 *
 * 设计:
 *   - 已 R2 的 URL 直接跳过(幂等,多次调用不会重复下载)
 *   - data: URL 不动(base64 已在请求体里)
 *   - 其它 http(s) URL 走 persistCandidateToR2,失败抛错
 *
 * dedup 语义:同一 URL 多次调用安全(已 R2 跳过)。不同 URL 并行下载,
 * wall-clock ≈ 单张 + ε。
 */
import { persistCandidateToR2 } from "@/features/gpt-image/lib/generation-service";
import { getR2PublicHosts } from "@/features/image-gen/lib/r2";

/**
 * 是否已是 R2 公开域 URL(host 在 R2_PUBLIC_BASE_URL / *.r2.cloudflarestorage.com 之内)。
 * 用 host 比对(忽略 path / query / 大小写),避免 https://host/ 与 https://host:443/ 误判。
 */
export function isR2Url(url: string | null | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const hosts = getR2PublicHosts();
  return hosts.some(
    (h) => parsed.host.toLowerCase() === h.toLowerCase(),
  );
}

/**
 * 把一组 URL 代理到 R2,保留原顺序与长度(undefined / null 元素保留)。
 *
 * 规则:
 *   - undefined / null / 空串 → 保留(原样返回)
 *   - data: URL → 保留(已是 inline 内容)
 *   - 已是 R2 URL(host 匹配)→ 保留(去重 + 幂等)
 *   - 其它 http(s) URL → persistCandidateToR2,失败抛错
 *   - 其它协议(ws/file 等) → 抛错
 *
 * @param urls 输入 URL 列表
 * @param traceHint 传给 persistCandidateToR2 作 objectKey 命名空间;
 *   通常用 model + requestId 或 imageJob.id。
 * @returns 与 urls 同序、同长度的列表
 */
export async function proxyImageInputsToR2(
  urls: ReadonlyArray<string | null | undefined>,
  traceHint: string,
): Promise<Array<string | null | undefined>> {
  const result: Array<string | null | undefined> = new Array(urls.length);
  await Promise.all(
    urls.map(async (raw, idx) => {
      if (!raw) {
        result[idx] = raw;
        return;
      }
      if (raw.startsWith("data:")) {
        result[idx] = raw;
        return;
      }
      if (isR2Url(raw)) {
        result[idx] = raw;
        return;
      }
      if (!/^https?:\/\//i.test(raw)) {
        throw new Error(
          `proxyImageInputsToR2: 不支持的协议 (${raw.slice(0, 32)})`,
        );
      }
      const persisted = await persistCandidateToR2(raw, traceHint, idx);
      result[idx] = persisted;
    }),
  );
  return result;
}