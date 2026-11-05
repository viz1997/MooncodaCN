/**
 * 加载环境变量(给脚本用)
 *
 * ## 为什么单独一个文件
 *
 * 脚本顶上的这几行:
 *
 * ```ts
 * dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
 * ```
 *
 * 写在**模块体**里 —— 而 ESM / CJS 的静态 import 会在模块体执行**之前**
 * 就把被 import 的模块求值完。于是:
 *
 * ```
 * import { db } from "@/db";        // ← 这里就把 src/db/index.ts 求值了
 * dotenvConfig({ path: ".env.local" }); // ← 还没跑到,env 还是空的
 * ```
 *
 * `src/db/index.ts` 在模块顶层就检查 `process.env.DATABASE_URL`,拿不到就
 * 直接抛错 —— 脚本还没来得及加载 `.env.local` 就炸了。
 *
 * 把 dotenv 挪进一个**只有副作用的模块**,并且把它放在 import 列表的
 * **第一个**,求值顺序就对了(ESM 的求值顺序按 import 声明的先后,深度优先)。
 *
 * ```ts
 * import "./lib/load-env"; // ← 必须排第一
 * import { db } from "@/db";
 * ```
 *
 * 顺序反了照样炸 —— 所以这个 import 别往中间挪。
 */

import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { expand as dotenvExpand } from "dotenv-expand";

dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env.local") }));
dotenvExpand(dotenvConfig({ path: resolve(process.cwd(), ".env") }));
