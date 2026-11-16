/**
 * 案例图片的**对象键** —— 纯函数(只 import `nanoid`)
 *
 * ## 为什么要一个单独的键生成器
 *
 * 前台那一侧(`case-image.ts`)会**验前缀**(`showcases/`)—— 不落在这个前缀下
 * 的键,签名跳转路由不认。⇒ **生成**和**校验**必须用同一套前缀,不能各写一份。
 *
 * ## 键的形状
 *
 * ```
 * showcases/<YYYY-MM-DD>/<nanoid>.<ext>
 * ```
 *
 * - **按日期分区** —— 后台文件管理那一页能按日期翻;
 * - **文件名** —— 工作室上传的图原名可能是中文,直接当键会在 URL 里变成
 *   一串百分号编码;用 `nanoid()` 干净且不会撞。
 */

import { nanoid } from "nanoid";

/** 案例图片在桶里的前缀 —— **跟 `case-image.ts` 里的那个必须是同一个字符串** */
export const SHOWCASE_OBJECT_PREFIX = "showcases/";

/** 允许的扩展名 —— 白名单,别的格式不签 */
export const SHOWCASE_ALLOWED_EXTENSIONS = [
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "avif",
] as const;

/** 取扩展名 —— 小写、去掉前面路径(`a/b/c.PNG` → `png`) */
export function extractShowcaseExtension(fileName: string): string {
  const name = (fileName ?? "").split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  // `dot <= 0` —— 点在**开头**说明这是个没有主名的隐藏文件(`.png`),不是扩展名;
  // `dot === name.length - 1` —— 结尾就是点(`c.`),后面什么都没有。
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * 造一个案例图片的对象键
 *
 * `ext` 传**不带点**的小写扩展名。
 */
export function buildShowcaseObjectKey(ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/g, "").toLowerCase() || "bin";
  const day = new Date().toISOString().slice(0, 10);
  return `${SHOWCASE_OBJECT_PREFIX}${day}/${nanoid(12)}.${safeExt}`;
}
