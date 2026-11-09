/**
 * 后台文件管理 —— **错误分类**(纯函数)
 *
 * ## 为什么要分得这么细
 *
 * 「删除失败」对用户是两件完全不同的事:
 *
 * - **桶策略锁着对象** → 重试**没用**,要去 Cloudflare 后台改桶策略
 * - **这次调用挂了** → 重试**有用**,点一下再来
 *
 * 界面上必须说不一样的话。所以先把 R2 抛回来的东西分类成稳定的码,
 * 界面再按码查文案。
 *
 * ## 为什么不能靠「匹配错误消息」
 *
 * 错误消息是人写的,会变。AWS SDK 的错误对象上有几个稳定的字段:
 *
 * - `name` —— 未知错误码时 SDK 直接拿错误码当 name(`ObjectLockedByBucketPolicy`)
 * - `$metadata.httpStatusCode` —— HTTP 状态码
 *
 * 下面把「错误码字符串」和「状态码」两条路都走一遍,哪条中就返回哪个码。
 * 消息文本只作为**兜底**(R2 偶尔把错误码塞在 message 里)。
 */

import type { AdminFilesErrorCode } from "@/features/storage/admin/types";

/** 从一个「什么都可能是」的对象里读字符串字段 */
function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 把错误对象里所有能当身份看的东西拼成一串
 *
 * `name` / `Code` / `code` / `message` 全都算上 —— 不同 SDK 版本、
 * 不同 R2 版本放的字段不一样,多看几个字段不会错。
 */
function errorHaystack(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const e = err as Record<string, unknown>;
  return [
    readString(e.name),
    readString(e.Code),
    readString(e.code),
    readString(e.message),
  ].join(" ");
}

/** HTTP 状态码 —— 拿不到就是 null */
function errorStatus(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as Record<string, unknown>;
  const meta = e.$metadata;
  if (typeof meta !== "object" || meta === null) return null;
  const status = (meta as Record<string, unknown>).httpStatusCode;
  return typeof status === "number" ? status : null;
}

/** 桶策略锁着对象的特征串 */
const LOCKED_MARKERS = ["ObjectLockedByBucketPolicy", "ObjectLockedByBucket"];

/**
 * 删除失败 → 稳定的码
 *
 * - `R2_DELETE_BLOCKED` —— 桶策略锁着。**重试没用**
 * - `NOT_FOUND` —— 对象已经不在了
 * - `DELETE_FAILED` —— 其它(网络 / 权限 / 未知)
 */
export function classifyDeleteError(err: unknown): AdminFilesErrorCode {
  const haystack = errorHaystack(err);
  const status = errorStatus(err);

  if (LOCKED_MARKERS.some((m) => haystack.includes(m))) {
    return "R2_DELETE_BLOCKED";
  }
  // R2 锁对象的回包是 409 Conflict —— 错误码没带出来时靠状态码兜
  if (status === 409) return "R2_DELETE_BLOCKED";
  if (haystack.includes("NoSuchKey") || status === 404) return "NOT_FOUND";

  return "DELETE_FAILED";
}

/**
 * 签下载链接失败 → 稳定的码
 *
 * - `NOT_FOUND` —— 对象不在了
 * - `DOWNLOAD_FAILED` —— 其它
 */
export function classifyDownloadError(err: unknown): AdminFilesErrorCode {
  const haystack = errorHaystack(err);
  const status = errorStatus(err);

  if (haystack.includes("NoSuchKey") || status === 404) return "NOT_FOUND";

  return "DOWNLOAD_FAILED";
}
