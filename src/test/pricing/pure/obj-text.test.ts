import { describe, expect, it } from "vitest";
import {
  decodeObjBytes,
  describeEmptyObjFile,
  sniffObjEncoding,
} from "@/features/pricing/lib/obj-text";

/**
 * OBJ 文本的字节级读取 + 编码嗅探(2026-11-10)
 *
 * 工作室报的那条:**「OBJ 解析失败:空 OBJ 文本,实际不是空的」**。
 *
 * ## 根因
 *
 * 按规范,`File.text()` 对一个**非空**文件**不可能**返回空串 —— UTF-8 解码
 * 遇到不认识的字节会产出 U+FFFD,不会把字节丢掉。所以「解出来是空的」只
 * 可能是:浏览器拿到的**真的就是 0 字节**。
 *
 * 那 0 字节从哪儿来?工作室最常见的三种:
 *
 * - 从**压缩包里直接拖**文件(拖的是压缩包里的那一项,不是一个真文件)
 * - 云盘里的**占位文件**还没下载完(拖进来的是个 0 字节的壳)
 * - 拖的是**快捷方式**
 *
 * 用户看着一句「空 OBJ 文本」,只会觉得「我的模型坏了」。话得说清楚。
 *
 * ## 另一个坑:UTF-16
 *
 * `File.text()` 永远按 UTF-8 解。Windows 上不少工具导出的 OBJ 是 UTF-16
 * —— 按 UTF-8 解出来是一堆带 NUL 的乱码,worker 一个顶点都认不出来,
 * 用户完全看不懂哪儿错了(报的是「未找到顶点数据」)。
 *
 * 所以改成:先拿字节,自己判编码,再解码。
 */

const OBJ_SAMPLE = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";

/** UTF-8 字节 */
function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("编码嗅探", () => {
  it("普通 ASCII 的 OBJ 是 UTF-8", () => {
    expect(sniffObjEncoding(utf8(OBJ_SAMPLE))).toBe("utf8");
  });

  it("UTF-8 的 BOM 认得出来", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(OBJ_SAMPLE)]);
    expect(sniffObjEncoding(bytes)).toBe("utf8");
  });

  it("UTF-16LE 的 BOM 认得出来", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x76, 0x00]);
    expect(sniffObjEncoding(bytes)).toBe("utf16le");
  });

  it("UTF-16BE 的 BOM 认得出来", () => {
    const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x76]);
    expect(sniffObjEncoding(bytes)).toBe("utf16be");
  });

  it("没有 BOM 的 UTF-16LE 靠 NUL 的位置认出来", () => {
    // "v 0 0 0" 的 UTF-16LE 字节:NUL 落在**奇数**位
    const bytes = new Uint8Array([0x76, 0x00, 0x20, 0x00, 0x30, 0x00]);
    expect(sniffObjEncoding(bytes)).toBe("utf16le");
  });

  it("没有 BOM 的 UTF-16BE 靠 NUL 的位置认出来", () => {
    // "v 0 0 0" 的 UTF-16BE 字节:NUL 落在**偶数**位
    const bytes = new Uint8Array([0x00, 0x76, 0x00, 0x20, 0x00, 0x30]);
    expect(sniffObjEncoding(bytes)).toBe("utf16be");
  });
});

describe("解码", () => {
  it("0 字节 ⇒ 空字符串", () => {
    expect(decodeObjBytes(new Uint8Array(0))).toBe("");
  });

  it("UTF-8 的 OBJ 原样解出来", () => {
    expect(decodeObjBytes(utf8(OBJ_SAMPLE))).toBe(OBJ_SAMPLE);
  });

  it("UTF-8 的 BOM **被摘掉** —— 留着第一个 `v` 行就废了", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(OBJ_SAMPLE)]);
    const text = decodeObjBytes(bytes);

    expect(text.startsWith("v 0 0 0")).toBe(true);
    expect(text.charCodeAt(0)).toBe("v".charCodeAt(0));
  });

  it("UTF-16LE 的 OBJ 也能解出来(Windows 上不少工具导出的就是它)", () => {
    const bytes = new Uint8Array([
      0xff,
      0xfe, // BOM
      0x76,
      0x00,
      0x20,
      0x00,
      0x30,
      0x00,
      0x20,
      0x00,
      0x30,
      0x00,
      0x20,
      0x00,
      0x30,
      0x00,
      0x0a,
      0x00,
    ]);
    expect(decodeObjBytes(bytes)).toBe("v 0 0 0\n");
  });

  it("UTF-16BE 的 OBJ 也能解出来", () => {
    const bytes = new Uint8Array([
      0xfe,
      0xff, // BOM
      0x00,
      0x76,
      0x00,
      0x20,
      0x00,
      0x30,
      0x00,
      0x20,
      0x00,
      0x30,
      0x00,
      0x20,
      0x00,
      0x30,
      0x00,
      0x0a,
    ]);
    expect(decodeObjBytes(bytes)).toBe("v 0 0 0\n");
  });

  it("无 BOM 的 UTF-16LE 也能解出来(靠嗅探)", () => {
    const bytes = new Uint8Array([
      0x76, 0x00, 0x20, 0x00, 0x30, 0x00, 0x20, 0x00, 0x30, 0x00, 0x20, 0x00,
      0x30, 0x00, 0x0a, 0x00,
    ]);
    expect(decodeObjBytes(bytes)).toBe("v 0 0 0\n");
  });
});

describe("「读出来是空的」这句话怎么说人话", () => {
  it("0 字节 ⇒ 告诉用户「你的文件多半是好的」,并给出怎么办", () => {
    const msg = describeEmptyObjFile(0);

    // 说清「文件没坏,是传输环节丢了内容」
    expect(msg).toContain("0 字节");
    expect(msg).toContain("你的文件多半是好的");
    // 给出**能做的事** —— 不许只摆一句「请稍后重试」
    expect(msg).toContain("复制到本地");
  });

  it("有字节但解出来是空的 ⇒ 那是编码不对,不是空壳", () => {
    const msg = describeEmptyObjFile(1024);

    expect(msg).toContain("1024");
    expect(msg).toContain("编码");
    // 这一条**不该**说「你的文件多半是好的」—— 那是不对的
    expect(msg).not.toContain("你的文件多半是好的");
  });
});
