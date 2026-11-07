"use client";

/**
 * 两个工具之间的文件接力 —— **模块级变量**
 *
 * ## 它解决什么
 *
 * 模型检查(`/tools/model-check`)和模型克重(`/tools/weight`)问的是同一个
 * 模型的两个问题:**能不能印** / **要多少料**。以前同一个文件要拖两次、
 * 解压两次、量两遍。
 *
 * 这个模块把 `File` 递给下一个页面 —— 用户不用再找一遍那个文件。
 *
 * ## 只在**客户端路由跳转**里有效(最重要的一条)
 *
 * 模块级变量活在当前这个 JS 上下文里:
 *
 * - 客户端跳转(`@/i18n/routing` 的 `router.push`)不换上下文 → 接力成立
 * - **整页刷新 / 整页跳转就断了**
 *
 * 所以规矩是:
 *
 * - 接力**必须**用 `useRouter().push()` —— 不能用 `window.location.href`
 * - 文件**不能**进 `sessionStorage`(几 MB 的 OBJ / zip 会撑爆配额)
 *
 * 早先打印单那边有一版一模一样的接力(`print-quote/lib/model-handoff.ts`),
 * 2026-11-06 删掉了 —— 它挂在**登录往返**上,而登录完是整页跳转,接力必然断。
 * 这一次只挂在**纯客户端跳转**上,所以能活。
 */

/** 待接力的文件(下一个页面来取) */
let pendingFile: File | null = null;

/**
 * 存一个文件给下一个页面取
 *
 * 只在**客户端跳转之前**调 —— 跳转之后当前页面还在,但接力是一次性的
 * (下一个页面取走就断)。
 */
export function stashModelFile(file: File): void {
  pendingFile = file;
}

/**
 * 取走待接力的文件(取走之后就没了)
 *
 * 只给**目标页面**用:页面挂载时调一次。取到就把接力断掉,免得用户来回
 * 跳的时候反复加载同一个文件。
 */
export function takeModelFile(): File | null {
  const file = pendingFile;
  pendingFile = null;
  return file;
}
