/**
 * 站点设置后台的**视图模型**
 *
 * ## 为什么单独一个文件
 *
 * 类型**不能**放在 `"use server"` 文件里 —— Turbopack 会把那个文件里的
 * 每一个 export 都注册成 server action,类型 re-export 会注册出一个不存在
 * 的 action,运行时 `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。
 *
 * 所以 `actions.ts` 只导出 async 函数,类型全在这个纯文件里。
 */

/**
 * 后台写操作的错误码
 *
 * **不 throw** —— throw 会被 next-safe-action 糊成「服务器错误」,工作室
 * 根本不知道是哪儿错了(地址写错了?表还没建?)。
 */
export type AdminSiteSettingErrorCode =
  /** 不是一个 URL */
  | "INVALID_URL"
  /** 是 URL,但不是 http(s) —— `javascript:` 那种 */
  | "NOT_HTTP"
  /** 表还不存在 —— 迁移脚本没跑 */
  | "MIGRATION_MISSING"
  /** 其它失败 */
  | "SAVE_FAILED";

/** 写操作的统一返回 */
export type AdminSiteSettingWriteResult =
  | { ok: true }
  | { ok: false; code: AdminSiteSettingErrorCode };

/**
 * 后台看到的那一份现状
 *
 * `source` 告诉工作室「现在生效的这个值是从哪儿来的」——
 * **后台没存过**(`env` / `none`)时,顶上一条横幅提示「还在走环境变量兜底」。
 */
export interface AdminSiteSettingsView {
  /** 现在生效的地址 —— 空 = 入口不出现 */
  effectiveUrl: string;
  /** 生效值从哪儿来 */
  source: "db" | "env" | "none";
  /** 存着的值不合法 —— 渲染时已经忽略了 */
  invalid: boolean;
  /** DB 里那一行的原始值 —— `null` = 没存过 */
  dbValue: string | null;
  /** 环境变量里的那个值(空 = 没配) */
  envValue: string;
  /** 读挂了 —— 人话 */
  readError: string | null;
  /** 表还没建(迁移脚本没跑) */
  missingRelation: boolean;
}
