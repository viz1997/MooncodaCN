/**
 * 移植自 wjp-source-code/src/lib/unrar-wasm-loader.ts —— 耗材克重报价计算器（PolyJet 全彩打印）。
 *
 * 算法逻辑与源实现保持一致；移植时仅做类型严格化（noUncheckedIndexedAccess /
 * exactOptionalPropertyTypes）与 Biome 格式化调整，未改变任何数值行为。
 */
/**
 * 预加载 node-unrar-js 的 WASM 二进制文件
 *
 * 方案：将 WASM 二进制以 base64 形式内联到 JS bundle 中（unrar-wasm-b64.ts），
 * 运行时解码即可使用，不依赖运行时 fetch 任何外部文件。
 *
 * 优点：
 *   - 不受 CDN/反向代理路径配置影响
 *   - 不受 basePath 影响
 *   - 首次加载即可用，无网络延迟
 *
 * WASM 文件来源：node_modules/node-unrar-js/esm/js/unrar.wasm（构建时转 base64 内联）
 */

import { UNRAR_WASM_BASE64 } from "./unrar-wasm-b64";

let cachedWasm: ArrayBuffer | null = null;

/**
 * 将 base64 字符串解码为 ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  // 使用 atob + Uint8Array 方式（兼容性最好）
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  // 复制到独立的 ArrayBuffer（避免 Uint8Array 的 buffer 可能共享）
  const buffer = new ArrayBuffer(len);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/**
 * 加载 unrar.wasm 二进制文件
 *
 * 直接从内联的 base64 解码，无需网络请求
 */
export async function loadUnrarWasm(): Promise<ArrayBuffer> {
  if (cachedWasm) return cachedWasm;

  try {
    const buffer = base64ToArrayBuffer(UNRAR_WASM_BASE64);
    // 验证是有效的 WASM 文件（magic number: 0x00 0x61 0x73 0x6d = "\0asm"）
    if (buffer.byteLength > 4) {
      const view = new Uint8Array(buffer);
      if (
        view[0] === 0x00 &&
        view[1] === 0x61 &&
        view[2] === 0x73 &&
        view[3] === 0x6d
      ) {
        cachedWasm = buffer;
        console.info(
          `[unrar] WASM loaded from inline base64 (${buffer.byteLength} bytes)`
        );
        return cachedWasm;
      }
    }
    throw new Error(
      `Invalid WASM magic bytes after base64 decode (size: ${buffer.byteLength})`
    );
  } catch (err) {
    throw new Error(
      `无法解码内联的 unrar.wasm 文件: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
