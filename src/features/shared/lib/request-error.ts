/**
 * 前端请求失败 —— **带机器可读的 code**
 *
 * ## 为什么要有这个
 *
 * 「加入购物袋」失败过一次,界面上只摆一句「加入打印单失败,请稍后重试」——
 * 真实原因(数据库少一列 / R2 没配 / 模型文件没找到)全被吞进 console。
 * 那一次是靠「翻 R2 看有没有留下对象」才定位到是**加行**那步炸的,
 * 而不是上传那步 —— 不该这么查。
 *
 * 服务端每个失败都带一个稳定的 `code`(`R2_NOT_CONFIGURED` /
 * `MODEL_NOT_FOUND` / `AUTH_REQUIRED` …)。界面拿 code 去查文案表,
 * 查不到再退回笼统那句。
 *
 * ## 放这儿的原因
 *
 * 打印服务那条路横跨两个 feature:
 *
 * - 上传走 `print-quote/lib/upload-model.ts`
 * - 加行走 `storefront/hooks/use-cart.ts`
 *
 * 两边都要抛同一种错误,所以这个类型放在 `shared/` —— 谁都能引,
 * 不产生 feature 之间的循环依赖。
 */

/** code 的形状 —— 大写字母 / 数字 / 下划线 */
const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * 请求失败
 *
 * `code` 是服务端给的机器可读码(没有就是 null);`message` 是给人看的
 * 那句话(可能是服务端的中文原文,也可能只是一句 `HTTP 500`)。
 */
export class RequestError extends Error {
  /** 服务端给的机器可读码 */
  readonly code: string | null;
  /** HTTP 状态码 */
  readonly status: number;

  constructor(message: string, status: number, code?: string | null) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.code = code ?? null;
  }
}

/**
 * 从响应体里挑出 code
 *
 * **两个路由的约定不一样**:
 *
 * - `/api/print-orders/upload-url` → `{ error: "R2 未配置", code: "R2_NOT_CONFIGURED" }`
 *   —— `error` 是人话,`code` 才是码
 * - `/api/store/carts/[id]/line-items` → `{ error: "MODEL_NOT_FOUND", message: "…" }`
 *   —— `error` 直接就是码
 *
 * 所以两个都看,并且**只认 code 形状的字符串** —— 免得把「R2 未配置」
 * 当成码拿去找文案表。
 */
export function extractErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of ["code", "error"] as const) {
    const raw = record[key];
    if (typeof raw === "string" && CODE_PATTERN.test(raw)) return raw;
  }
  return null;
}

/**
 * 从响应体里挑出人话
 *
 * `message` 优先;其次是「不是码形状」的 `error`(比如「R2 未配置」);
 * 都没有就退回 `HTTP <状态码>`。
 */
export function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message = record.message;
    if (typeof message === "string" && message.trim()) return message;
    const error = record.error;
    if (
      typeof error === "string" &&
      error.trim() &&
      !CODE_PATTERN.test(error)
    ) {
      return error;
    }
  }
  return `HTTP ${status}`;
}

/**
 * 把失败响应变成 `RequestError`
 *
 * 客户端两个 fetch 助手(`upload-model.ts` / `use-cart.ts`)都用它 ——
 * 两边各写一遍解析,迟早漂移。
 */
export function toRequestError(body: unknown, status: number): RequestError {
  return new RequestError(
    extractErrorMessage(body, status),
    status,
    extractErrorCode(body)
  );
}
