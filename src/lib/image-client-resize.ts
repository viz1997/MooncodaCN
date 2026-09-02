"use client";

/**
 * 浏览器端图片降采样工具 —— 唯一可用的 resize 通道（服务端 sharp 被禁用）
 *
 * 为什么必须前端降采样：
 * - Lingting/WellAPI `/v1/images/edits` 上游对 multipart body 有限制（约 8MB），
 *   用户的 9MB 参考图打过去会被上游返 413（用户报告 "Lingting 提交失败：HTTP 413"）。
 * - 服务端 `submitLingtingTask` 跑在 Inngest 上，不能在 server 侧做 resize。
 * - sharp 服务端降采样被部署 hardblock（Vercel libvips native binary 装不稳，
 *   见 memory `thumbnail-route-remove-sharp-vps-deploy`），只能走浏览器 canvas。
 *
 * 使用场景：
 * - V2 生图工作台上传参考图（generate-workbench-view.tsx handleFileSelect）
 * - V1 /p/[token] 上传步骤（upload-step.tsx handleConfirm）
 * - 图库管理页上传（photos-manager-view.tsx uploadFile）
 * - 后续 canvas workbench 上传参考图也可复用
 *
 * 算法：长边缩到 maxLongEdge → canvas.toBlob 二分质量（jpeg → webp）→ 长边再缩；
 * 循环 6 轮兜底，超过抛 RESIZE_FAILED 让调用方按原图上传（≤10MB 时）。
 */

import { logger } from "@/lib/logger";

/** 参考图硬上限：超过此值走浏览器原生 resize，避免 Lingting 上游 413 */
export const MAX_REF_IMAGE_BYTES = 5 * 1024 * 1024;

export interface ResizeOptions {
  /** 目标最大字节数（默认 MAX_REF_IMAGE_BYTES = 5MB） */
  maxBytes?: number;
  /** 目标长边像素上限（默认 2560）。gpt-image-2 内部会再 resize 到训练尺寸 */
  maxLongEdge?: number;
  /** 初始 JPEG 质量（默认 0.9） */
  initialQuality?: number;
  /** 最低 JPEG 质量（默认 0.6），跌破转 webp */
  minQuality?: number;
  /** 最低长边（默认 1024），跌破说明原图本身压缩不到 maxBytes */
  minLongEdge?: number;
  /** 最大迭代轮数（默认 6）。80MB 像素图兜底不卡死 */
  maxIterations?: number;
}

export interface ResizeResult {
  blob: Blob;
  width: number;
  height: number;
  mime: string;
  originalBytes: number;
  finalBytes: number;
  /** 是否实际做过降采样（false = 直接返回原图） */
  resized: boolean;
}

const DEFAULTS = {
  maxBytes: MAX_REF_IMAGE_BYTES,
  maxLongEdge: 2560,
  initialQuality: 0.9,
  minQuality: 0.6,
  minLongEdge: 1024,
  maxIterations: 6,
};

/**
 * 用 HTMLImageElement + canvas 把 File/Blob 压到目标字节数。
 *
 * 关键不变量：
 * - 原图 size ≤ maxBytes：直接返 {blob: 原图, resized: false}，零额外开销。
 * - mime 透传：webp 路径产出 blob.type === "image/webp"，jpeg 路径 === "image/jpeg"，
 *   调用方上传到 R2 时必须同步 contentType，否则 R2 存的文件 MIME 错乱。
 * - 失败 throw：调用方决定降级（按原图上传 或 toast 报错），不静默吞。
 */
export async function resizeImage(
  source: File | Blob,
  opts: ResizeOptions = {}
): Promise<ResizeResult> {
  const cfg = { ...DEFAULTS, ...opts };
  const originalBytes = source.size;

  // 原图已经在目标字节以下：跳过整条链路
  if (originalBytes <= cfg.maxBytes) {
    return {
      blob: source,
      width: 0,
      height: 0,
      mime: source.type || "application/octet-stream",
      originalBytes,
      finalBytes: originalBytes,
      resized: false,
    };
  }

  // 加载 image —— 用 decode() 而不是 onload，Safari 14- 上 onload 不可靠
  const objectUrl = URL.createObjectURL(source);
  let img: HTMLImageElement;
  try {
    img = await loadImage(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  if (srcW === 0 || srcH === 0) {
    throw new Error("RESIZE_FAILED: 图片解码失败");
  }

  // 计算起始长边（按比例缩到 maxLongEdge）
  const startLongEdge = Math.max(srcW, srcH);
  const startScale = Math.min(1, cfg.maxLongEdge / startLongEdge);

  // 状态机：尝试 jpeg → 不够转 webp → 都不够再缩 longEdge
  let curScale = startScale;
  let curQuality = cfg.initialQuality;
  let curMime: "image/jpeg" | "image/webp" = "image/jpeg";
  let curLongEdge = cfg.maxLongEdge;

  for (let iter = 0; iter < cfg.maxIterations; iter++) {
    const w = Math.max(1, Math.round(srcW * curScale));
    const h = Math.max(1, Math.round(srcH * curScale));

    const blob = await encode(img, w, h, curMime, curQuality);

    if (blob.size <= cfg.maxBytes) {
      logger.info(
        {
          originalBytes,
          finalBytes: blob.size,
          width: w,
          height: h,
          mime: curMime,
          quality: curQuality,
          scale: curScale,
          iterations: iter + 1,
        },
        "[resizeImage] 客户端降采样成功"
      );
      return {
        blob,
        width: w,
        height: h,
        mime: curMime,
        originalBytes,
        finalBytes: blob.size,
        resized: true,
      };
    }

    // 不够小 → 决策下一轮调整方向
    // 1. 同 mime 还能降质量
    if (curQuality > cfg.minQuality + 0.05) {
      curQuality = Math.max(cfg.minQuality, curQuality - 0.1);
      continue;
    }
    // 2. 质量已到底 → 换 webp 重试（webp 同质量体积通常更小）
    if (curMime === "image/jpeg") {
      curMime = "image/webp";
      curQuality = cfg.initialQuality;
      continue;
    }
    // 3. webp 也压不到 → 再缩 longEdge（保留原比例 0.85 倍）
    if (curLongEdge > cfg.minLongEdge) {
      curLongEdge = Math.max(cfg.minLongEdge, Math.round(curLongEdge * 0.85));
      curScale = Math.min(1, curLongEdge / startLongEdge);
      curMime = "image/jpeg";
      curQuality = cfg.initialQuality;
      continue;
    }
    // 4. 长边也到底了还是压不到 → 放弃
    break;
  }

  throw new Error(
    `RESIZE_FAILED: 经过 ${cfg.maxIterations} 轮迭代仍无法压到 ${cfg.maxBytes} 字节以下`
  );
}

async function loadImage(objectUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = objectUrl;
  // img.decode() 是 Promise 化方案；老 Safari 不支持时降级到 onload
  if (typeof img.decode === "function") {
    try {
      await img.decode();
      return img;
    } catch {
      // 走 onload 兜底
    }
  }
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("图片加载失败"));
  });
  return img;
}

function encode(
  img: HTMLImageElement,
  width: number,
  height: number,
  mime: "image/jpeg" | "image/webp",
  quality: number
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context 不可用");
  // 显式铺白底：JPEG 不透明，遇到 PNG alpha 时不会变黑
  if (mime === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error(`canvas.toBlob(${mime}) 返回 null`));
          return;
        }
        resolve(blob);
      },
      mime,
      quality
    );
  });
}

/**
 * 把 blob 装成同名 File，方便保留原文件名上传到 R2。
 *
 * 为何不直接传 blob：用户原文件名（如 "IMG_1234.jpg"）丢了会让下载体验混乱，
 * 也让 createPhotoAction 入库的 fileName 与图片实际 MIME 对不上。
 */
export function wrapBlobAsFile(
  blob: Blob,
  originalName: string,
  fallbackMime = "image/jpeg"
): File {
  const mime = blob.type || fallbackMime;
  // 把后缀对齐到新 mime（PNG → webp 之类）
  const ext =
    mime === "image/webp" ? "webp" : mime === "image/png" ? "png" : "jpg";
  const baseName = originalName.replace(/\.[^.]+$/, "");
  return new File([blob], `${baseName}.${ext}`, { type: mime });
}
