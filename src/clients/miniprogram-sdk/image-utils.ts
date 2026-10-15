/**
 * 小程序 SDK —— 客户端图片工具(2026-10-15 v1.4.0)
 *
 * v1.4.0 起 mp 端 SDK 不再做格式归一化(归一化责任后移到 server 端
 * proxyImageInputsToR2.normalizeToSupported,详见
 * architecture-mp-server-side-normalize.md)。本文件只保留一个公共
 * 工具:readTaroFileAsArrayBuffer —— mp 开发者把 Taro tempFilePath
 * 转 ArrayBuffer / Blob 时用。
 *
 * 典型用法(mp 端 SDK 内部使用 + 业务可选使用):
 *   const buf = await readTaroFileAsArrayBuffer(tempFilePath);
 *   const blob = new Blob([buf], { type: "image/jpeg" });
 *   await publicUploadDirect(blob, "image/jpeg");
 *
 * iOS HEIC 处理方案(2026-10-15 决策):
 *   Taro.chooseImage({ sizeType: ['compressed'] }) 时,iOS 微信
 *   会用系统 imageIO 把 HEIC 解码成 JPG,返回的 tempFilePath 直接
 *   是 JPG 字节。本 SDK 不需要任何 client-side 转换代码。
 *   sizeType:['original'] 仍能拿到 HEIC,但 server 端 jimp 解不开
 *   HEIC(装 sharp 违反 CLAUDE.md 约束),会抛 ImageFormatError。
 *   业务侧需要 sizeType:['original'] 时,自行在 mp 端转换 HEIC
 *   (用本文件底下的 readTaroFileAsArrayBuffer 读 HEIC → Blob 再
 *    调 Taro.compressImage / iOS native API 转 JPG)。
 *
 * 不依赖:本文件不 import Taro 类型(本仓库不是 Taro 项目,SDK 是
 * 给外部 Taro 项目用的)。运行时通过 globalThis.Taro 探测。
 */

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
  getFileSystemManager?: () => TaroFileSystemManager;
}

function getTaro(): TaroGlobal | null {
  const t = (globalThis as { Taro?: TaroGlobal }).Taro;
  return t ?? null;
}

/**
 * 把 Taro.chooseImage / Taro.chooseMessageFile 返回的 tempFilePath
 * 读成 ArrayBuffer。兼容 Taro base lib 多个版本:
 *   - <3.17.3:res.data 直接是 ArrayBuffer
 *   - ≥3.17.3:res.data 是 Uint8Array 等 typed array(ArrayBuffer.isView
 *     识别;必须 .slice() 出独立副本,否则 shared underlying buffer
 *     可能在 view 之外被复用时回收 / 写入)
 *   - Taro RN 偶尔返 base64 string(encoding 被外部设过),atob 兜底
 *
 * 非 Taro 环境(纯浏览器 / Node)调用会 throw,业务自行 fallback。
 *
 * @example
 *   const buf = await readTaroFileAsArrayBuffer(tempFilePath);
 *   const blob = new Blob([buf], { type: "image/jpeg" });
 *   await publicUploadDirect(blob, "image/jpeg");
 */
export async function readTaroFileAsArrayBuffer(
  filePath: string
): Promise<ArrayBuffer> {
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
