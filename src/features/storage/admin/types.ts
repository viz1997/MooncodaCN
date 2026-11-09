/**
 * 后台文件管理 —— 视图模型
 *
 * ## 为什么不放在 `actions.ts` 里
 *
 * `actions.ts` 是 `"use server"` 文件。**那种文件不许 re-export 类型** ——
 * Turbopack 会把它注册成 server action,运行时引用一个不存在的类型绑定 →
 * `ReferenceError` → 整页 500。
 *
 * 仓库里有专门的单测扫这个(`src/test/repo/pure/use-server-exports.test.ts`)。
 * 所以类型全在这个独立文件里,`actions.ts` 只 import 不 re-export。
 */

/**
 * 一个文件的归属(谁传的)
 *
 * 桶里的对象键不含 userId(打印模型那一支是 sha256 前 16 位),
 * 要显示「谁传的」得反查 —— 见 `lib/owner-map.ts`。
 */
export interface AdminFileOwner {
  id: string;
  name: string;
  email: string;
}

/** 一个子目录 */
export interface AdminFileFolder {
  /** 完整前缀(以 `/` 结尾) */
  prefix: string;
  /** 显示名(最后一段) */
  name: string;
  /** 归属 —— 认得出来才有,认不出来是 null */
  owner: AdminFileOwner | null;
}

/** 一个文件 */
export interface AdminFileObject {
  /** 对象键(完整路径) */
  key: string;
  /** 显示名(最后一段) */
  name: string;
  /** 字节数 */
  size: number;
  /** 最后修改时间(ISO) */
  lastModified: string;
  /** 公开链接(桶里的对象都是公开读的) */
  publicUrl: string;
  /** 扩展名(小写,不带点) */
  ext: string;
  /** 是图片吗 —— 决定摆不摆缩略图 */
  isImage: boolean;
  /** 归属 */
  owner: AdminFileOwner | null;
}

/** 一次列目录的结果 */
export interface AdminFilesListing {
  /** 当前所在的前缀(根是 `""`) */
  prefix: string;
  /** 这一层的子目录 */
  folders: AdminFileFolder[];
  /** 这一层直接放着的文件 */
  files: AdminFileObject[];
  /** 下一页游标;null = 没有下一页 */
  nextContinuationToken: string | null;
  /** 还有没有下一页 */
  isTruncated: boolean;
  /**
   * 公开访问域名配了没
   *
   * 没配的话公开链接在浏览器里打不开 —— 界面就只给「下载」(签名 URL),
   * 不摆缩略图,免得摆一排裂图。
   */
  publicBaseConfigured: boolean;
}

/**
 * 后台文件管理的错误码
 *
 * 全部**通道无关** —— 界面上按码查文案,查不到才退回笼统那句。
 */
export type AdminFilesErrorCode =
  /** R2 没配(`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`) */
  | "R2_NOT_CONFIGURED"
  /** 前缀不合法 */
  | "INVALID_PREFIX"
  /** 对象键不合法 */
  | "INVALID_KEY"
  /** 列目录失败(R2 报错 / 网络) */
  | "LIST_FAILED"
  /** 桶策略锁着对象 —— 删不掉,要去 Cloudflare 后台改桶策略 */
  | "R2_DELETE_BLOCKED"
  /** 对象不存在 */
  | "NOT_FOUND"
  /** 删除失败(其它原因) */
  | "DELETE_FAILED"
  /** 签下载链接失败 */
  | "DOWNLOAD_FAILED";

/** 列目录的结果 */
export type AdminListFilesResult =
  | { ok: true; listing: AdminFilesListing }
  | { ok: false; code: AdminFilesErrorCode };

/** 删除的结果 */
export type AdminDeleteFileResult =
  | { ok: true }
  | { ok: false; code: AdminFilesErrorCode };

/** 取下载链接的结果 */
export type AdminFileDownloadResult =
  | { ok: true; url: string }
  | { ok: false; code: AdminFilesErrorCode };
