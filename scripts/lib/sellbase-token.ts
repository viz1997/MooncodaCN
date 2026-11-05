/**
 * Sellbase admin token 的前缀(2026-11-04)
 *
 * ## 为什么不是 Sellbase 默认的 `sb_live_`
 *
 * Sellbase 的 API token 默认长成 `sb_live_<43 个 base64url 字符>`。
 *
 * 问题出在 **`sb_` 是 Supabase 自己的 API key 命名空间**:
 *
 * | Supabase 的 key | 前缀 |
 * |---|---|
 * | publishable | `sb_publishable_…` |
 * | secret | `sb_secret_…` |
 * | **Sellbase 的 admin token** | **`sb_live_…`** ← 撞了 |
 *
 * Supabase 新版的 Edge Function 网关(Envoy 那一层)在**进函数之前**就会解析
 * `Authorization: Bearer <值>`:
 *
 * - 值长得像 JWT(`xxx.yyy.zzz`)→ 当 JWT 验签
 * - 值以 **`sb_` 开头** → 当 **Supabase API key** 查表
 *
 * 查不到就直接 401 —— **根本轮不到函数里的代码**:
 *
 * ```
 * GET /functions/v1/sellbase-api/v1/store
 * Authorization: Bearer sb_live_xxxx
 * → 401 {"message":"Invalid API key","hint":"Double check your API key."}
 * ```
 *
 * 这个 401 **不是** Sellbase 的错误(Sellbase 的错误形状是
 * `{error:{code,message,hint,details}}`),是网关的 —— 所以它连
 * `resolveActor()` 都进不去。
 *
 * 三个函数实测(都打到了网关):
 *
 * | `Authorization: Bearer …` | 结果 |
 * |---|---|
 * | `sb_live_xxx`(Sellbase 默认前缀) | 401 `Invalid API key`(网关拦掉) |
 * | `sb_xxx`(任意 `sb_` 开头) | 401 `Invalid API key`(网关拦掉) |
 * | `mooncoda_live_xxx` / `abc123` | ✅ 透传给函数,函数自己鉴权 |
 *
 * ## 怎么办:改前缀
 *
 * `BRAND.tokenPrefix` 在 Sellbase 的 bundle 里是**一个字面量**,而它的三处
 * 用途(鉴权闸门 / 生成 token / 错误文案)全都读同一个变量 —— 所以改一个
 * 字符串就全改对了:
 *
 * ```js
 * tokenPrefix: "sb_live_"  →  tokenPrefix: "mooncoda_live_"
 * ```
 *
 * 改完:
 *
 * - 网关看到 `mooncoda_live_…` —— 不以 `sb_` 开头,当普通 Bearer 透传
 * - 函数里 `credential.startsWith("mooncoda_live_")` → 命中,走 token 查表
 * - `POST /tokens` 生成的 token 也自动带新前缀
 *
 * 补丁由 `scripts/fetch-sellbase-assets.ts` 在取回 bundle 时打上(并且
 * 断言每个 bundle 正好改到 1 处,改不到就报错退出)—— 所以每次重新部署都
 * 不会漏。
 *
 * ## 要一起改的地方
 *
 * - `scripts/bootstrap-sellbase-store.ts` —— 铸 token 用同一个前缀
 * - `scripts/fetch-sellbase-assets.ts` —— 打补丁
 * - 本文件 —— 前缀的唯一定义处
 *
 * ⚠️ 换前缀之后**旧的 `sb_live_` token 一律作废**(网关根本不让它过去)。
 * `bootstrap-sellbase-store.ts` 会自动把前缀对不上的旧 token 标成
 * `revoked_at`。
 */

/**
 * admin token 前缀
 *
 * 约束:
 * - **不能以 `sb_` 开头** —— 会撞 Supabase 的 API key 命名空间,被网关拦掉
 * - 建议 ≥ 9 字符 —— `sellbase.api_tokens.prefix` 存的是前 12 个字符,
 *   太短的话「前缀 + 3 个随机字符」显示出来没辨识度
 */
export const SELLBASE_TOKEN_PREFIX = "mooncoda_live_";
