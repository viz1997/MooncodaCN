/**
 * 2026-10-14 输入图代理到 R2 —— 纯函数 + fetch helper
 *
 * 背景:apimart.ai 等上游生图模型需要服务端可达的 URL 来 fetch 输入
 * 参考图。如果 mp / 浏览器 / 第三方 client 直接传外部存储 URL
 * (典型带 `?sign=...&t=...` 的临时签名 URL,如腾讯 CloudBase
 * `*.tcb.qcloud.la`),apimart fetch 会因:
 *   - 签名过期(几天到几小时)
 *   - 跨服务商网络隔离(apimart.ai → tcb.qcloud.la 不通)
 *   - IP / Referer 白名单
 * 而 403。本文件提供把外部 URL 一次性转存到自有 R2 的能力,R2 永久
 * 公开 + 全网可达,上游一定能拿到。
 *
 * 2026-10-15 加 normalize:小程序 / 第三方 client 可能传 HEIC / TIFF
 * / BMP / GIF 等 apimart / gpt-image 不接受的格式;白名单内(png /
 * jpeg / webp)直接透传,白名单外 jimp 转 PNG,避免用户被"格式不支
 * 持"卡住。HEIC/AVIF 等 jimp 解不开的格式抛 ImageFormatError 给外层
 * 翻译成可读提示。
 *
 * 设计:
 *   - 已 R2 的 URL 直接跳过(幂等,多次调用不会重复下载)
 *   - data: URL → base64 解码 → normalize → 落 R2(必须:apimart 只
 *     接 https URL,data: 无法直传)
 *   - 其它 http(s) URL → fetch + normalize + 落 R2
 *   - 其它协议(ws/file 等) → 抛错
 *
 * 复用约定:persistCandidateToR2(generation-service.ts)是给"上游已
 * 生成的图片 URL 转存 R2"用的(输出侧,模型产物格式已天然合规);
 * 本文件是给"客户端原始输入"用的(输入侧,可能含乱七八糟的格式),
 * 因此各自走不同 helper,不混用。
 *
 * dedup 语义:同一 URL 多次调用安全(已 R2 跳过)。不同 URL 并行下载,
 * wall-clock ≈ 单张 + ε。
 */
import { randomBytes } from "node:crypto";

import {
  getR2PublicHosts,
  isR2Configured,
  putObject,
} from "@/features/image-gen/lib/r2";
import {
  DEFAULT_SUPPORTED_MIMES,
  ImageFormatError,
  mimeToExt,
  normalizeToSupported,
} from "./image-normalize";

const INPUT_PROXY_TIMEOUT_MS = 60_000;

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
  return hosts.some((h) => parsed.host.toLowerCase() === h.toLowerCase());
}

/**
 * 把 http(s) URL 的图片下载 → 白名单校验/转换 → 持久化 R2,返回
 * 永久 R2 URL。
 *
 * 失败抛错:
 *   - 网络/HTTP 错误 → 上层走网络错误分支
 *   - decode 失败(ImageFormatError)→ 上层转成"请转 PNG/JPG/WebP"提示
 */
async function persistHttpInputToR2(
  url: string,
  traceHint: string,
  idx: number
): Promise<string> {
  if (!isR2Configured()) {
    throw new Error("R2 未配置:输入图无法持久化");
  }
  const res = await fetch(url, {
    signal: AbortSignal.timeout(INPUT_PROXY_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`下载参考图失败:HTTP ${res.status} ${res.statusText}`);
  }
  const mimeFromHeader = res.headers.get("content-type");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error("参考图为空");
  }
  const normalized = await normalizeToSupported(
    bytes,
    DEFAULT_SUPPORTED_MIMES,
    mimeFromHeader
  );
  const ext = mimeToExt(normalized.mime);
  const objectKey = `image-gen/input/${traceHint}/${idx}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  return putObject({
    objectKey,
    body: normalized.buffer,
    contentType: normalized.mime,
  });
}

/**
 * 把 data: URL(base64)解码 → 白名单校验/转换 → 持久化 R2。
 *
 * 为什么不能直接透传 data: 给 apimart:apimart 只接 https URL,data:
 * 会 400。Gemini 走 inline_data 也不在本 helper 处理(Gemini 的
 * inline_data 逻辑在 adapters 内自己读 mime,本 helper 不拦)。
 *
 * 这里 normalize 出的 buffer/mime 直接落 R2,gpt-image 也复用这条
 * 路径(它最终也从 R2 URL 拉 bytes 进 multipart,见
 * generation-service.ts)。
 */
async function persistDataUrlInputToR2(
  rawDataUrl: string,
  traceHint: string,
  idx: number
): Promise<string> {
  if (!isR2Configured()) {
    throw new Error("R2 未配置:输入图无法持久化");
  }
  const m = rawDataUrl.match(/^data:([^;,]+);base64,(.+)$/i);
  if (!m) {
    throw new Error("proxyImageInputsToR2: data URL 格式非法");
  }
  const sourceMime = (m[1] ?? "").trim().toLowerCase();
  const sourceB64 = m[2] ?? "";
  const bytes = new Uint8Array(Buffer.from(sourceB64, "base64"));
  if (bytes.byteLength === 0) {
    throw new Error("data URL 内容为空");
  }
  const normalized = await normalizeToSupported(
    bytes,
    DEFAULT_SUPPORTED_MIMES,
    sourceMime
  );
  const ext = mimeToExt(normalized.mime);
  const objectKey = `image-gen/input/${traceHint}/${idx}-${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
  return putObject({
    objectKey,
    body: normalized.buffer,
    contentType: normalized.mime,
  });
}

/**
 * 把一组 URL 代理到 R2,保留原顺序与长度(undefined / null 元素保留)。
 *
 * 规则:
 *   - undefined / null / 空串 → 保留(原样返回)
 *   - data: URL → base64 解码 + normalize + 落 R2
 *   - 已是 R2 URL(host 匹配)→ 保留(去重 + 幂等)
 *   - 其它 http(s) URL → fetch + normalize + 落 R2
 *   - 其它协议(ws/file 等) → 抛错
 *
 * 每张图片的格式会在落地前被 normalize 到
 * DEFAULT_SUPPORTED_MIMES(png / jpeg / webp)。白名单内直接透传,
 * 白名单外(jimp 支持的)自动转 PNG,jimp 解不开的(HEIC / AVIF 等)
 * 抛 ImageFormatError。
 *
 * @param urls     输入 URL 列表
 * @param traceHint  传作 objectKey 命名空间;通常用 model + requestId
 *                  或 imageJob.id。
 * @returns 与 urls 同序、同长度的列表
 */
export async function proxyImageInputsToR2(
  urls: ReadonlyArray<string | null | undefined>,
  traceHint: string
): Promise<Array<string | null | undefined>> {
  const result: Array<string | null | undefined> = new Array(urls.length);
  await Promise.all(
    urls.map(async (raw, idx) => {
      if (!raw) {
        result[idx] = raw;
        return;
      }
      if (raw.startsWith("data:")) {
        result[idx] = await persistDataUrlInputToR2(raw, traceHint, idx);
        return;
      }
      if (isR2Url(raw)) {
        result[idx] = raw;
        return;
      }
      if (!/^https?:\/\//i.test(raw)) {
        throw new Error(
          `proxyImageInputsToR2: 不支持的协议 (${raw.slice(0, 32)})`
        );
      }
      result[idx] = await persistHttpInputToR2(raw, traceHint, idx);
    })
  );
  return result;
}

// 重导出方便调用方做错误分级(adapter 转可读提示用)
export { DEFAULT_SUPPORTED_MIMES, ImageFormatError };
