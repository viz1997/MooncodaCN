/**
 * 2026-10-15 输入图格式白名单 —— "supported 直接走,unsupported 转 PNG"
 *
 * 背景:小程序 / 浏览器 / 第三方 client 可能送来 apimart、gpt-image
 * 不接受的图片格式(典型:HEIC iOS 实况图、AVIF、新版浏览器 WebP、
 * 上游签名 URL 服务端 Content-Type 误导等)。早期版本透传,失败后给
 * 用户弹"格式不支持",体验差。
 *
 * 上游支持集合(2026-10-15 与产品确认):
 *   - apimart(gpt-image-2.5-flare / -sunburst):{image/png, image/jpeg, image/webp}
 *   - wellapi gpt-image-2(Lingting):{image/png, image/jpeg, image/webp}
 *   - Gemini(nano_banana2):{image/png, image/jpeg, image/webp, image/heic,
 *     image/heif, image/gif} —— Gemini 接受面更宽,白名单相应放大
 *
 * 设计:
 *   - 永远先 magic-byte sniff(image-type,从 buffer 首 4100 字节解析);
 *     upstream Content-Type 是 hint 但不可信(代理 / 签名 URL / CDN
 *     rewrite 经常误标为 image/octet-stream)。
 *   - 真实 mime ∈ 上游白名单 → 原 buffer 直通,零开销、零视觉损失。
 *   - 真实 mime 是 image/svg+xml(SVG 是 XML 不是光栅,jimp/image-type
 *     都打不开)→ @resvg/resvg-js 光栅化为 PNG 后返回。线上已观察到
 *     mask 模板链路命中这种情况,2026-10-15 加进来。
 *   - 真实 mime ∉ 白名单,且 jimp 能解码(BMP/TIFF/GIF 等) → jimp
 *     转 PNG 后返回。目标固定 PNG:png 是所有上游语言里最不被怀疑
 *     的格式,gpt-image-2 OpenAI 协议严格只接 png。
 *   - 真实 mime ∉ 白名单,且 jimp 无法解码(HEIC/AVIF 等) → 抛
 *     ImageFormatError,带具体格式名,调用方把它串成用户可读错误
 *     ("暂不支持 HEIC 格式,请转为 PNG/JPG/WebP 后重试")。
 *
 * 不在依赖里装 sharp(Vercel libvips native 装不稳),不在 helper
 * 加 @jimp/js-webp(webp 已在白名单内,无需解码转换)。jimp v1 默认
 * 解码器:PNG/JPEG/BMP/TIFF/GIF,编码器同上(已 smoke-test)。
 *
 * 复用约定:
 *   - input-url-proxy.ts:apimart 路径整批转入
 *   - generation-service.ts:gpt-image-2 路径每张参图逐张调用
 *   - adapters.ts:Gemini 路径(走放宽白名单)
 */
import { Resvg } from "@resvg/resvg-js";
import imageType from "image-type";
import { Jimp } from "jimp";

/** 上游(apimart / gpt-image)支持的输入图 mime */
export const DEFAULT_SUPPORTED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** Gemini 放宽版(HEIC/HEIF/GIF 都接) */
export const GEMINI_SUPPORTED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

/** normalize 返回值的 mime 一定是 image/png(转换的唯一目标格式) */
export const NORMALIZED_MIME: "image/png" = "image/png";

/** normalize 结果,buffer 可能在原数据上也可能是 jimp 重编码结果 */
export type NormalizedImage = {
  buffer: Uint8Array;
  mime: string;
  /** 是否被实际转换过;false 即直通,buffer === 原 buffer */
  converted: boolean;
  /** 真实 mime(sniff 结果,可能与 buffer 的 Content-Type 不一致) */
  detectedMime: string | null;
};

/** ImageFormatError:不支持且无法自动转的格式 */
export class ImageFormatError extends Error {
  constructor(
    public readonly detectedMime: string | null,
    message: string
  ) {
    super(message);
    this.name = "ImageFormatError";
  }
}

/**
 * 把 Uint8Array / Buffer 统一规范成 Buffer(image-type 的类型只
 * 接受 Buffer / ArrayBuffer / string,Uint8Array 不被赋值兼容)。
 */
function asBuffer(buffer: Uint8Array | Buffer): Buffer {
  return buffer instanceof Buffer ? buffer : Buffer.from(buffer);
}

/**
 * Magic-byte sniff(基于 buffer 前 ~4100 字节,纯 ESM 同步 IO)。
 *
 * 真实部署里 upstream CDN / 签名 URL / Web 服务器经常给错
 * Content-Type(image/octet-stream 很常见),所以凡涉及要不要转码
 * 都必须以 sniff 结果为准,header 仅作 hint。
 *
 * @returns { ext, mime } 或 null(buffer 太小或不是图片)
 */
export async function sniffImageFormat(
  buffer: Uint8Array | Buffer
): Promise<{ ext: string; mime: string } | null> {
  const result = await imageType(asBuffer(buffer));
  return result ? { ext: result.ext, mime: result.mime } : null;
}

/**
 * 把 buffer 标准化到 `allowedMimes` 之一。语义:
 * - 真实 mime ∈ 白名单 → 直接返回原 buffer,converted=false
 * - 真实 mime ∉ 白名单且 jimp 可解 → 转 PNG,converted=true
 * - 真实 mime ∉ 白名单且 jimp 不可解 → 抛 ImageFormatError
 *
 * 调用方约定:
 * - 调用前 buffer 已被 fetch 完整读到内存(本 helper 不会重新读)。
 * - 失败抛错是预期行为,上游 dispatch 层会把它翻成用户可读提示。
 *
 * @param mimeFromHeader  fetch 的 Content-Type(可空,只是 hint,实际以 sniff 为准)
 * @param allowedMimes    本路径允许通过的 mime 列表
 */
export async function normalizeToSupported(
  buffer: Uint8Array | Buffer,
  allowedMimes: ReadonlyArray<string>,
  mimeFromHeader?: string | null
): Promise<NormalizedImage> {
  const detected = await sniffImageFormat(buffer);
  const detectedMime = detected?.mime ?? null;

  // 1. 真 mime 在白名单 → 直通(原 buffer 不动)
  if (detectedMime && allowedMimes.includes(detectedMime)) {
    return {
      buffer: buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer),
      mime: detectedMime,
      converted: false,
      detectedMime,
    };
  }

  // 2. sniff 没识别(也可能是 header 误导的 image/octet-stream)。
  //    保守:信任 header,如果 header 在白名单,放行并标记 converted=false;
  //    否则走转换路径。
  if (!detectedMime && mimeFromHeader) {
    const normalized = mimeFromHeader.split(";")[0]?.trim().toLowerCase();
    if (normalized && allowedMimes.includes(normalized)) {
      return {
        buffer: buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer),
        mime: normalized,
        converted: false,
        detectedMime: null,
      };
    }
  }

  // 3. 不可直通的格式 → 试图 jimp 转 PNG
  // SVG 走 resvg-js 光栅化(SVG 是 XML 不是光栅,jimp 没法直接
  //    decode)。命中条件:header 明确为 image/svg+xml。
  //    输出固定 image/png。
  const headerLooksSvg =
    typeof mimeFromHeader === "string" &&
    mimeFromHeader.toLowerCase().split(";")[0]?.trim() === "image/svg+xml";
  if (headerLooksSvg) {
    try {
      const resvg = new Resvg(asBuffer(buffer));
      const rendered = resvg.render();
      const pngBuf = rendered.asPng();
      const pngBytes =
        pngBuf instanceof Uint8Array ? pngBuf : new Uint8Array(pngBuf);
      return {
        buffer: pngBytes,
        mime: NORMALIZED_MIME,
        converted: true,
        detectedMime: "image/svg+xml",
      };
    } catch (svgErr) {
      const msg =
        svgErr instanceof Error ? svgErr.message : "未知 SVG 解析错误";
      throw new ImageFormatError("image/svg+xml", `SVG 图片解析失败:${msg}`);
    }
  }

  // 不可直通的格式 → 试图 jimp 转 PNG
  try {
    const jimpImg = await Jimp.read(asBuffer(buffer));
    const pngBuf = await jimpImg.getBuffer(NORMALIZED_MIME);
    const pngBytes =
      pngBuf instanceof Uint8Array ? pngBuf : new Uint8Array(pngBuf);
    return {
      buffer: pngBytes,
      mime: NORMALIZED_MIME,
      converted: true,
      detectedMime,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "未知解码错误";
    // 错误诊断:嗅探结果 / 真实 header / buffer 长度都报出来,
    // 线上排查"明明是 JPG 为什么不支持"这种迷惑场景时有迹可循。
    const normalizedHeader =
      mimeFromHeader?.split(";")[0]?.trim().toLowerCase() ?? null;
    const headerDesc = normalizedHeader ?? mimeFromHeader ?? "未知";
    const detectedDesc = detectedMime ?? "未识别";
    const bytesDesc = `${buffer.byteLength}B`;
    throw new ImageFormatError(
      detectedMime,
      `图片格式不支持(嗅探:${detectedDesc}, header:${headerDesc}, ${bytesDesc})且无法自动转换:${msg}`
    );
  }
}

/**
 * mime → 扩展名。persistCandidateToR2 / submitLingtingTask 都用。
 *
 * 避免反复维护 if/else:normalize 出来的 mime 一定是白名单或 image/png,
 * 都能从这里取到稳定扩展名。
 */
export function mimeToExt(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("heic") || mime.includes("heif")) return "heic";
  return "png";
}
