/**
 * DB 报错的形状 —— 把「表还在不在」这件事认出来
 *
 * ## 为什么值得单独一个文件
 *
 * Drizzle 抛出来的 `DrizzleQueryError` 的 `message` 是**拼接的 SQL**:
 *
 * ```
 * Failed query: select "id", … from "print_pricing_config" where …
 * params: default,1
 * ```
 *
 * 真正的原因在 `cause` 里(PG 的原始错误,比如
 * `relation "print_pricing_config" does not exist`)。只打 `error.message`
 * 的话,日志里就是一坨 SQL —— 看不出是「迁移脚本没跑」。
 *
 * 2026-11-06 线上真踩过:工作室点「保存计价设置」报「保存失败,看服务端
 * 日志」,日志里只有上面那坨 SQL。真正要说的是「表还没建,先跑一次迁移
 * 脚本」。
 *
 * ## 用法
 *
 * ```ts
 * const info = describeDbError(error);
 * if (info.missingRelation) {
 *   // → 回一句能照着做的提示
 * }
 * console.error(info.message); // 带上 cause 的完整信息
 * ```
 *
 * 纯函数,不碰 DB —— 能进 unit project 跑单测。
 */

/** PG 的「对象不存在」错误码 */
const UNDEFINED_TABLE = "42P01";
const UNDEFINED_COLUMN = "42703";

/**
 * 「relation/column/table "x" does not exist」
 *
 * 只认这三种说法 —— 免得别的「does not exist」(比如某个扩展没装)被误判成
 * 「迁移脚本没跑」。
 */
const MISSING_OBJECT_RE =
  /\b(?:relation|column|table)\s+"[^"]+"\s+does not exist/i;

export interface DbErrorInfo {
  /**
   * 表 / 列不存在
   *
   * 绝大多数情况是**迁移脚本还没跑**(打印定价那套表是 2026-11-06 才加的)。
   */
  missingRelation: boolean;
  /** 人话版的错误信息 —— 带了 cause 链上的原始信息 */
  message: string;
}

/**
 * 把 Drizzle 包的错误拆开
 *
 * 顺着 `cause` 链往下走(Drizzle → PG 错误),把每层的 `message` 收进来,
 * 把 PG 的 `code` 也收进来。
 */
export function describeDbError(error: unknown): DbErrorInfo {
  const messages: string[] = [];
  const codes: string[] = [];
  const seen = new Set<unknown>();

  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (!current || typeof current !== "object" || seen.has(current)) break;
    seen.add(current);

    const record = current as {
      message?: unknown;
      code?: unknown;
      cause?: unknown;
    };
    if (typeof record.message === "string" && record.message) {
      messages.push(record.message);
    }
    if (typeof record.code === "string" && record.code) {
      codes.push(record.code);
    }
    current = record.cause;
  }

  const missingRelation =
    codes.includes(UNDEFINED_TABLE) ||
    codes.includes(UNDEFINED_COLUMN) ||
    messages.some((message) => MISSING_OBJECT_RE.test(message));

  return {
    missingRelation,
    // cause 链上的信息在后面 —— 前面那坨 SQL 是噪音,后面那句才是原因
    message: messages.join(" | "),
  };
}

/**
 * 打印定价那两张表还在不在
 *
 * 迁移脚本没跑的时候,后台每一个写操作都会撞同一个错。与其让工作室看
 * 「保存失败,看服务端日志」,不如直接告诉他跑哪条命令。
 */
export function isMissingPrintPricingTable(error: unknown): boolean {
  return describeDbError(error).missingRelation;
}
