/**
 * 小程序 SDK —— 客户端图片工具(2026-10-15 v1.3.1)
 *
 * 背景:v1.3.0 publicUploadDirect() 让 mp 直传 R2 跳 BFF,链路里
 * 没有任何服务端 normalize 步骤(server 端 proxyImageInputsToR2
 * 看到 R2 URL 直接跳过)。iOS 微信用户选原图(sizeType: 'original')
 * 会拿到 HEIC,直接 PUT R2 之后 apimart 不接受 HEIC,会报错。
 *
 * 本文件给 mp 端提供客户端格式归一化:用 Taro.compressImage 把
 * HEIC / BMP / TIFF / PNG / 任何 format 压成标准 JPG,后续
 * publicUploadDirect 拿 JPG 走直传,链路 0 风险。
 *
 * 兼容性:
 *   - Taro 编译的 WeChat mp:iOS 微信内置 HEIC→JPG 解码器
 *     (底层走 system imageIO),Android 微信走系统解码器,覆盖
 *     95%+ 场景
 *   - Taro H5 / RN:Taro.compressImage 同样可用,底层走 canvas /
 *     native
 *   - 纯浏览器/Node 测试环境:无 Taro,调用本文件的函数会 throw
 *     "Taro.compressImage 不可用",业务自行 fallback
 *
 * 不依赖:本文件不 import Taro 类型(本仓库不是 Taro 项目,SDK 是
 * 给外部 Taro 项目用的)。运行时通过 globalThis.Taro 探测。
 */

interface TaroCompressImageOptions {
  src: string;
  /** 0-100,默认 90 —— iOS HEIC 用 90+ 视觉无差,体积小一半 */
  quality: number;
  compressedFormat?: "jpg" | "png" | "webp";
  success?: (res: { tempFilePath: string }) => void;
  fail?: (err: unknown) => void;
}

interface TaroFileSystemManager {
  readFile: (opts: {
    filePath: string;
    /** 不传 → ArrayBuffer / Uint8Array(视 base lib 版本);传 'base64' → base64 字符串 */
    encoding?: "" | "base64";
    success?: (res: { data: ArrayBuffer | ArrayBufferView | string }) => void;
    fail?: (err: unknown) => void;
  }) => void;
}

interface TaroGlobal {
  compressImage?: (opts: TaroCompressImageOptions) => void;
  getFileSystemManager?: () => TaroFileSystemManager;
}

function getTaro(): TaroGlobal | null {
  const t = (globalThis as { Taro?: TaroGlobal }).Taro;
  return t ?? null;
}

function taroCompressImage(src: string, quality: number): Promise<string> {
  const taro = getTaro();
  if (!taro?.compressImage) {
    return Promise.reject(
      new Error(
        "Taro.compressImage 不可用 —— 仅在 Taro 编译的 mp/H5/RN 环境生效;非 Taro 环境请用 publicUploadDirect(file) 直接传 File/Blob"
      )
    );
  }
  return new Promise<string>((resolve, reject) => {
    taro.compressImage!({
      src,
      quality,
      compressedFormat: "jpg",
      success: (res) => resolve(res.tempFilePath),
      fail: (err) =>
        reject(
          err instanceof Error
            ? err
            : new Error(typeof err === "string" ? err : "compressImage fail")
        ),
    });
  });
}

function taroReadFileAsArrayBuffer(filePath: string): Promise<ArrayBuffer> {
  const taro = getTaro();
  if (!taro?.getFileSystemManager) {
    return Promise.reject(new Error("Taro.getFileSystemManager 不可用"));
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const fsm = taro.getFileSystemManager!();
    fsm.readFile({
      filePath,
      success: (res) => {
        // 1. 老版本 Taro base lib(<3.17.3):res.data 直接是 ArrayBuffer
        if (res.data instanceof ArrayBuffer) {
          resolve(res.data);
          return;
        }
        // 2. 新版本 Taro base lib(≥3.17.3):res.data 是 Uint8Array 等
        //    typed array。ArrayBuffer.isView 同时识别 Uint8Array / Int8Array
        //    / DataView 等。必须 .slice() 出独立副本,否则 shared underlying
        //    buffer 可能被 view 之外的代码复用时回收 / 写入。
        if (ArrayBuffer.isView(res.data)) {
          const view = res.data;
          resolve(
            view.buffer.slice(
              view.byteOffset,
              view.byteOffset + view.byteLength,
            ) as ArrayBuffer
          );
          return;
        }
        // 3. Taro RN 偶尔返 base64 字符串(encoding 被外部设过),兜底解码
        if (typeof res.data === "string") {
          try {
            const bin = atob(res.data);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            resolve(arr.buffer);
          } catch (e) {
            reject(
              e instanceof Error ? e : new Error("base64 → ArrayBuffer 失败")
            );
          }
          return;
        }
        reject(
          new Error("readFile 返回类型非 ArrayBuffer/ArrayBufferView/string")
        );
      },
      fail: (err) =>
        reject(
          err instanceof Error
            ? err
            : new Error(typeof err === "string" ? err : "readFile fail")
        ),
    });
  });
}

/**
 * mp 端把任意格式的 filePath 归一化成可上传的 JPG Blob(2026-10-15 v1.3.1)
 *
 * 内部步骤:
 *   1. Taro.compressImage(src, quality, 'jpg') —— 覆盖 HEIC/BMP/TIFF/PNG/...
 *   2. Taro.getFileSystemManager().readFile() → ArrayBuffer
 *   3. 包成 Blob({ type: 'image/jpeg' })
 *
 * @param filePath Taro.chooseImage / Taro.chooseMessageFile 返回的 tempFilePath
 * @param options.quality 0-100,默认 90
 * @returns 标准化后的 Blob,直接喂给 publicUploadDirect(blob, 'image/jpeg')
 *
 * 失败语义:
 *   - 非 Taro 环境 → throw "Taro.compressImage 不可用"
 *   - Taro 拒绝 compressImage(格式太怪 / 文件被删)→ throw
 *     compressImage 错误,业务 catch 后 fallback 到 publicUpload(file) 走 BFF
 */
export async function prepareMpFileForUpload(
  filePath: string,
  options?: { quality?: number }
): Promise<Blob> {
  const quality = options?.quality ?? 90;
  const compressedPath = await taroCompressImage(filePath, quality);
  const buf = await taroReadFileAsArrayBuffer(compressedPath);
  return new Blob([buf], { type: "image/jpeg" });
}
