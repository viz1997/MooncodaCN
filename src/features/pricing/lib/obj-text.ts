/**
 * OBJ 文本的**字节级读取 + 编码嗅探**
 *
 * ## 为什么不用 `file.text()`
 *
 * 以前那条路是 `const objText = await file.text();` —— 有两个问题:
 *
 * 1. **它不告诉你文件有多大。** 读出来是空的时候,页面只摆一句
 *    「空 OBJ 文本」,用户看着像**自己的模型坏了** —— 其实浏览器拿到的
 *    就是个 0 字节的文件(从压缩包里直接拖文件、云盘占位符没下载完、
 *    拖的是快捷方式,都是这个)。工作室报的那条「实际不是空的」就是这个:
 *    **文件不是空的,是浏览器读了个空壳。** 话得说清楚。
 * 2. **`File.text()` 永远是按 UTF-8 解。** Windows 上很多工具导出的 OBJ 是
 *    **UTF-16**,按 UTF-8 解出来是一堆带 NUL 的乱码 —— worker 一个顶点都
 *    认不出来(报「未找到顶点数据」),用户完全看不懂哪儿错了。
 *
 * 所以改成:先拿**字节**,自己判编码,再解码。空不空、什么编码、多大,
 * 都摆得清。
 *
 * ## 纯函数,零依赖
 *
 * 不引 `@/db`、不引 `server-only` ⇒ 客户端组件能安全 import,也能进
 * `unit` project 跑单测(`src/test/pricing/pure/obj-text.test.ts`)。
 */

/**
 * OBJ 文本可能的编码
 *
 * 这两个名字是**我们自己的**标签,不是 `TextDecoder` 的标签 ——
 * `TextDecoder` 认的是 `"utf-16le"` / `"utf-16be"`(中间有连字符)。
 * 直接把 `"utf16le"` 丢给 `new TextDecoder()` 会抛
 * `RangeError: The "utf16le" encoding is not supported`。
 */
export type ObjEncoding = "utf8" | "utf16le" | "utf16be";

/** 我们的标签 → `TextDecoder` 的标签 */
const DECODER_LABEL: Record<
  Exclude<ObjEncoding, "utf8">,
  "utf-16le" | "utf-16be"
> = {
  utf16le: "utf-16le",
  utf16be: "utf-16be",
};

/**
 * 判编码 —— 先看 BOM,没有 BOM 就看 NUL 的密度
 *
 * ASCII 文本在 UTF-16 里是「字符 + 0x00」,NUL 会**很密**;正常的 UTF-8
 * OBJ 里 NUL 一个都不该有。所以「前几百字节里 NUL 超过 1/8」基本可以
 * 断定是 UTF-16。
 *
 * UTF-16 的字节序:LE 是「低字节在前」(`v` = `76 00`)—— NUL 落在**奇数**位;
 * BE 是「高字节在前」(`v` = `00 76`)—— NUL 落在**偶数**位。
 * 所以数一下 NUL 落在偶数位多还是奇数位多就知道字节序。
 */
export function sniffObjEncoding(bytes: Uint8Array): ObjEncoding {
  if (bytes.length >= 2) {
    // BOM 最准 —— 有 BOM 就不用猜
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf16le";
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf16be";
  }

  const sample = Math.min(bytes.length, 512);
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < sample; i++) {
    if (bytes[i] !== 0) continue;
    if (i % 2 === 0) evenNul++;
    else oddNul++;
  }
  const nul = evenNul + oddNul;
  if (nul > sample / 8) {
    // NUL 落在**奇数**位 → 低字节在前(UTF-16LE);落在**偶数**位 → 高字节在前(UTF-16BE)
    return oddNul >= evenNul ? "utf16le" : "utf16be";
  }
  return "utf8";
}

/**
 * 把字节解成 OBJ 文本
 *
 * - 空字节 → 空字符串
 * - UTF-8 BOM 去掉(worker 的切词逻辑不认 BOM,留着第一个 `v` 行就废了)
 * - UTF-16 的 BOM 由 `TextDecoder` 自己处理(它会把 BOM 摘掉)
 */
export function decodeObjBytes(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const encoding = sniffObjEncoding(bytes);
  if (encoding === "utf8") {
    const body =
      bytes.length >= 3 &&
      bytes[0] === 0xef &&
      bytes[1] === 0xbb &&
      bytes[2] === 0xbf
        ? bytes.subarray(3)
        : bytes;
    return new TextDecoder("utf-8").decode(body);
  }
  return new TextDecoder(DECODER_LABEL[encoding]).decode(bytes);
}

/**
 * 「读出来是空的」这件事**怎么说人话**
 *
 * 分两种情况 —— 这两种对用户要做的事**完全不一样**:
 *
 * - `size === 0` → 浏览器拿到的就是个空壳(从压缩包里直接拖 / 云盘占位符
 *   没下载完 / 拖的是快捷方式)。**用户的文件没问题**,是传输环节丢了内容。
 * - `size > 0` → 字节在,但解出来是空的 —— 文件的编码不是 UTF-8 也不是
 *   UTF-16(比如 UTF-32、或者根本不是文本)。
 */
export function describeEmptyObjFile(size: number): string {
  if (size === 0) {
    return (
      "浏览器拿到的这个文件是 0 字节(空壳)—— 你的文件多半是好的。" +
      "从压缩包里直接拖文件、或者云盘里的占位文件还没下载完,都会这样:" +
      "先把文件复制到本地(或解压出来),再拖进来。"
    );
  }
  return (
    `文件有 ${size} 字节,但解出来是空的 —— 它的编码既不是 UTF-8 也不是 UTF-16` +
    "(可能是 UTF-32,或者根本不是文本文件)。用别的工具另存一份 UTF-8 的 OBJ 再试。"
  );
}
