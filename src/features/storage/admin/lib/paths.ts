/**
 * 后台文件管理 —— 对象键 / 前缀的**纯函数**
 *
 * ## 为什么这些必须是纯函数
 *
 * 前缀和对象键都是**客户端传来的路径**。它们最终会变成 R2 的 `Prefix` 参数 ——
 * 形状不校验,理论上能拿 `../` 之类的东西去试。
 *
 * 好在 R2 的 key 空间是扁平的(`a/b/c` 就是三段,没有「上一级」这种概念),
 * 路径穿越在 S3 这套协议里**本来就不成立**。但仍要校验,理由有两个:
 *
 * 1. **别把奇怪的东西传下去** —— 出了错要能一眼看出是「参数不合法」还是
 *    「R2 报错了」
 * 2. **键里能藏控制字符** —— 键会进日志、进界面、进复制链接
 *
 * ## 形状
 *
 * 桶里现存的 1089 个对象,每一段都长成 `[\w.-]+`(已核对过,零例外),
 * 也没有任何一个键含 `..`。所以规则就是照着这个定的:
 *
 *   前缀 = `""`(根) 或 `段(/段)*` 再加结尾的斜杠 —— 那个斜杠是**目录**的意思
 *   对象键 = `段(/段)*` —— 结尾没有斜杠
 */

/** 合法的一段:字母数字下划线连字符点 */
const SEGMENT_RE = /^[\w.-]+$/;

/** 图片扩展名 —— 决定界面上摆不摆缩略图 */
const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "avif",
  "bmp",
  "svg",
]);

/**
 * 把客户端传来的前缀归一化 —— 不合法就返回 null
 *
 * 归一化做的三件事:去掉开头的 `/`、补上结尾的 `/`、拒绝空段。
 *
 * ```ts
 * normalizePrefix("")            // → ""
 * normalizePrefix("/")            // → ""
 * normalizePrefix("print-orders") // → "print-orders/"
 * normalizePrefix("print-orders/")// → "print-orders/"
 * normalizePrefix("a//b")        // → null(空段)
 * normalizePrefix("../etc")       // → null
 * normalizePrefix("a\\b")        // → null(反斜杠)
 * ```
 */
export function normalizePrefix(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "/") return "";

  // 反斜杠 —— Windows 路径分隔符,一律拒
  if (trimmed.includes("\\")) return null;
  // `..` —— 任何位置都拒(桶里没有含 `..` 的键)
  if (trimmed.includes("..")) return null;

  const parts = trimmed.replace(/^\/+/, "").split("/");
  // 结尾那个空段是「目录」的正常写法,去掉
  if (parts[parts.length - 1] === "") parts.pop();
  if (parts.length === 0) return "";
  // 中间还有空段 = `a//b` —— 不合法
  if (parts.some((p) => p === "")) return null;
  if (!parts.every((p) => SEGMENT_RE.test(p))) return null;

  return `${parts.join("/")}/`;
}

/**
 * 把客户端传来的对象键归一化 —— 不合法就返回 null
 *
 * 跟前缀的区别:对象键**不能**以 `/` 结尾(那是目录标记,不是对象)。
 */
export function normalizeObjectKey(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.includes("\\")) return null;
  if (trimmed.includes("..")) return null;
  if (trimmed.startsWith("/") || trimmed.endsWith("/")) return null;

  const parts = trimmed.split("/");
  if (parts.some((p) => p === "")) return null;
  if (!parts.every((p) => SEGMENT_RE.test(p))) return null;

  return parts.join("/");
}

/** 一个前缀的最后一段 —— 「print-orders/a08b/2026-11-08/」→「2026-11-08」 */
export function folderName(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, "");
  if (trimmed === "") return "";
  const parts = trimmed.split("/");
  return parts[parts.length - 1] ?? "";
}

/** 上一级前缀 —— 「a/b/」→「a/」,「a/」→「」 */
export function parentPrefix(prefix: string): string {
  const trimmed = prefix.replace(/\/+$/, "");
  if (trimmed === "") return "";
  const parts = trimmed.split("/");
  parts.pop();
  return parts.length === 0 ? "" : `${parts.join("/")}/`;
}

/** 面包屑的一节 */
export interface BreadcrumbCrumb {
  /** 显示名 */
  label: string;
  /** 点它跳到哪 */
  prefix: string;
}

/**
 * 面包屑 —— 从根到当前层
 *
 * ```ts
 * buildBreadcrumb("print-orders/a08b/2026-11-08/")
 * // → [{label:"print-orders", prefix:"print-orders/"},
 * //    {label:"a08b", prefix:"print-orders/a08b/"},
 * //    {label:"2026-11-08", prefix:"print-orders/a08b/2026-11-08/"}]
 * ```
 */
export function buildBreadcrumb(prefix: string): BreadcrumbCrumb[] {
  const trimmed = prefix.replace(/\/+$/, "");
  if (trimmed === "") return [];
  const parts = trimmed.split("/");
  const crumbs: BreadcrumbCrumb[] = [];
  let acc = "";
  for (const part of parts) {
    acc = acc === "" ? `${part}/` : `${acc}${part}/`;
    crumbs.push({ label: part, prefix: acc });
  }
  return crumbs;
}

/** 对象键的最后一段 —— 文件名 */
export function fileName(key: string): string {
  const trimmed = key.replace(/\/+$/, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] ?? trimmed;
}

/** 扩展名(小写,不带点) —— 「a/b/c.PNG」→「png」 */
export function fileExt(key: string): string {
  const name = fileName(key);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** 是不是图片 —— 决定摆不摆缩略图 */
export function isImageKey(key: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExt(key));
}

/**
 * 文件种类 —— 界面上那一列显示什么
 *
 * 返回的是**稳定的英文 key**,界面再拿它去查 i18n 文案。
 * 别在这里返回中文 —— 界面有 en 这一侧。
 */
export type AdminFileKind =
  | "image"
  | "model"
  | "archive"
  | "document"
  | "other";

/** 3D 模型 —— 工作室真正要拿去生产的那一类 */
const MODEL_EXTENSIONS = new Set([
  "obj",
  "stl",
  "ply",
  "glb",
  "gltf",
  "3mf",
  "fbx",
  "dae",
  "step",
  "stp",
  "3ds",
]);

/** 压缩包 —— 打印模型是打包成 zip 的 */
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz", "bz2"]);

/** 文档 */
const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "txt",
  "md",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
]);

/** 这个文件是哪一类 */
export function fileKind(key: string): AdminFileKind {
  const ext = fileExt(key);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (MODEL_EXTENSIONS.has(ext)) return "model";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
  return "other";
}

/**
 * 打印模型那一支的分区哈希
 *
 * 键的形状是 `print-orders/<scope>/<日期>/<时间戳>-<nanoid>.<ext>`,
 * `<scope>` = `sha256(userId)` 的前 16 位 —— 见 `print-quote/lib/upload-key.ts`。
 *
 * 注意:2026-11-01 之前的老键是 `print-orders/<日期>/…`,**没有分区** ——
 * 那一支认不出归属,返回 null 是对的。
 */
export function printOrderScopeFromKey(key: string): string | null {
  const parts = key.split("/");
  if (parts[0] !== "print-orders") return null;
  const scope = parts[1];
  if (!scope) return null;
  // 老键:第二段是日期(`2026-11-01`) —— 那不是 scope
  if (/^\d{4}-\d{2}-\d{2}$/.test(scope)) return null;
  return scope;
}

/**
 * 键里那一支的**裸 userId**
 *
 * `user-uploads/<userId>/…` 和 `canvas/results/<userId>/…` 用的是**没哈希的**
 * userId(跟打印模型那一支不一样)。认得出来就直接对上用户。
 */
export function rawUserIdFromKey(key: string): string | null {
  const parts = key.split("/");
  if (parts[0] === "user-uploads") return parts[1] ?? null;
  if (parts[0] === "canvas" && parts[1] === "results") return parts[2] ?? null;
  return null;
}
