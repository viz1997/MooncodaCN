/**
 * 脚本守卫 —— 没有 `DATABASE_URL` 就**在 `@/db` 被求值之前**退出
 *
 * ## 为什么需要这一个文件
 *
 * `src/db/index.ts` 在**模块顶层**就检查 `DATABASE_URL`:
 *
 * ```ts
 * if (!process.env.DATABASE_URL) {
 *   throw new Error("DATABASE_URL 环境变量未设置,请在 .env 文件中配置数据库连接");
 * }
 * ```
 *
 * 静态 import 会在**模块体执行之前**把被 import 的模块求值完 ⇒
 * `import { db } from "@/db"` 一到,那个 throw 就炸了 —— **脚本自己的代码
 * 一行都还没跑**,用户看到的是一坨栈,不是一句人话。
 *
 * ⇒ 把守卫做成一个**只有副作用的模块**,并且排在 import 列表的**第二个**
 * (第一个是 `./lib/load-env`,它负责把 `.env.local` 读进来):
 *
 * ```
 * import "./lib/load-env";            // ← 读 .env.local
 * import "./lib/require-database-url"; // ← 守卫(缺 DATABASE_URL 就地退出)
 * import { db } from "@/db";           // ← 轮不到它抛
 * ```
 *
 * 顺序反了照样炸 —— 所以这两个 import **别往中间挪**。
 */

/**
 * 没有 `DATABASE_URL` ⇒ 说人话,然后退出
 *
 * 只在**真的缺**的时候退出 —— 有值就什么都不做(不覆盖、不改写)。
 */
if (!process.env.DATABASE_URL) {
  console.error(
    "❌ 没有 DATABASE_URL —— 这个脚本要读后台那份支付设置(沙箱凭据住在 DB 里)"
  );
  console.error(
    "   在 .env.local 里配好 DATABASE_URL 再跑(值只进环境变量,别进仓库文件)。"
  );
  process.exit(1);
}
