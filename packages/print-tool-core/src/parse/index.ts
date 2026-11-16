/**
 * 解析 —— OBJ 文本嗅探 / OBJ 顶点与面
 *
 * 「按字节读 + 编码嗅探」那一层:Windows 上很多工具导出的是 **UTF-16**,
 * 按 UTF-8 解出来是一堆带 NUL 的乱码 —— worker 一个顶点都认不出来。
 */

export * from "./obj-parser";
export * from "./obj-text";
