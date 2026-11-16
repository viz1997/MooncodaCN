/**
 * tawk.to 在线客服的**纯逻辑** —— 零 import(能进 vitest `unit` project)
 *
 * ## 为什么单独一个文件
 *
 * 这一层**不碰数据库、不碰 React、不碰 `window`** ⇒ 单测直接喂手写的数据。
 * 跟仓库里 `catalog-apply.ts` / `coupon-calc.ts` / `case-apply.ts` 一个路子。
 *
 * ## 两个 ID 是**一套配置**
 *
 * tawk.to 的 embed 地址是:
 *
 * ```
 * https://embed.tawk.to/{propertyId}/{widgetId}
 * ```
 *
 * 两个 ID **少一个都不成** —— 只填 property id 会得到一个 404 的脚本地址。
 * ⇒ 这一层把「两个 ID 凑成一条 embed 地址」当成**一个原子**处理。
 *
 * ## 为什么 ID 要严校验
 *
 * 这两个 ID 会被**拼进脚本地址**。它们来自后台输入框 ⇒ 有人在里面塞
 * `../../evil` 或者带 `?` 的东西,就会变成另一个地址。
 * ⇒ 只认 `字母 / 数字 / 下划线 / 短横线`,长度 1~64(tawk 后台真实 ID 的形状)。
 *
 * ## 回退链(跟站内其它设置一个口径)
 *
 * ```
 * DB 那一行(存了 ⇒ 赢,哪怕存的是空串 = 明确关掉)
 *   → 环境变量 NEXT_PUBLIC_TAWK_PROPERTY_ID / NEXT_PUBLIC_TAWK_WIDGET_ID
 *   → 没配(页面上就没有客服小窗)
 * ```
 *
 * ⚠️ **DB 空串 ≠ 没存** —— 空串是「明确关掉」,跟「从来没存过」是两件事
 * (跟 `site-setting.ts` 的 `resolveSiteUrl()` 一个口径)。
 */

/* -------------------------------------------------------------------------- */
/*  ID 的形状                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * tawk 的 property id / widget id 长什么样
 *
 * 真实的 tawk ID 是十六进制 / base64 风格的短串(例如 `5f9a8b7c6d`),
 * **不含** `/ ? # & = .` ⇒ 白名单卡死这几种字符就够了。
 */
export const TAWK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** embed 脚本的地址前缀 —— 官方 embed 代码里那一条 */
export const TAWK_EMBED_BASE = "https://embed.tawk.to";

/** ID 的最大长度 —— 跟 `TAWK_ID_PATTERN` 一致 */
export const TAWK_ID_MAX_LENGTH = 64;

/* -------------------------------------------------------------------------- */
/*  归一化 + 校验                                                              */
/* -------------------------------------------------------------------------- */

/**
 * 归一化一个 ID
 *
 * 只做 `trim` —— **不改大小写**(tawk 的 ID 大小写敏感),
 * 也不做别的「顺手清理」(工作室粘进来带个换行是常事,trim 掉就行)。
 */
export function normalizeTawkId(raw: string | null | undefined): string {
  return (raw ?? "").trim();
}

/** 这个 ID 是不是合法的 tawk ID */
export function isValidTawkId(raw: string | null | undefined): boolean {
  const id = normalizeTawkId(raw);
  if (!id) return false;
  if (id.length > TAWK_ID_MAX_LENGTH) return false;
  return TAWK_ID_PATTERN.test(id);
}

/* -------------------------------------------------------------------------- */
/*  embed 地址                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * 两个 ID → embed 脚本地址
 *
 * **任何一个不合法 ⇒ 返 `null`** —— 宁可不装,也不要装一个地址不对的脚本
 * (那会让页面上多一个 404 的请求,还查不出原因)。
 */
export function buildTawkEmbedUrl(
  propertyId: string | null | undefined,
  widgetId: string | null | undefined
): string | null {
  if (!isValidTawkId(propertyId)) return null;
  if (!isValidTawkId(widgetId)) return null;
  return `${TAWK_EMBED_BASE}/${normalizeTawkId(propertyId)}/${normalizeTawkId(widgetId)}`;
}

/* -------------------------------------------------------------------------- */
/*  生效值                                                                    */
/* -------------------------------------------------------------------------- */

/** 这一项的值是从哪儿来的 */
export type TawkConfigSource = "db" | "env" | "none";

/** tawk 的生效配置 */
export interface ResolvedTawkConfig {
  /** 生效的 property id(没配 ⇒ 空串) */
  propertyId: string;
  /** 生效的 widget id(没配 ⇒ 空串) */
  widgetId: string;
  /** 两个 ID 都合法 ⇒ 真的能装 */
  configured: boolean;
  /** 配了但**不像** ID(工作室贴错了 / 只填了一半) */
  invalid: boolean;
  /** 值是从哪儿来的 */
  source: TawkConfigSource;
  /** 生效的 embed 地址(没配 ⇒ 空串) */
  embedUrl: string;
}

/**
 * 解析 tawk 的生效配置
 *
 * ## 逐项回退
 *
 * 两个 ID **各走各的**回退链 —— DB 里只存了 property id 的话,widget id 仍
 * 从环境变量来。这样工作室可以只改其中一个而另一个不动。
 *
 * ## `invalid` 是给「贴错了」看的
 *
 * - `configured` = 两个 ID 都合法 ⇒ 装得上;
 * - `invalid` = **没配成,但也不是「什么都没填」** ⇒ 工作室填了东西,填错了
 *   (或者只填了一半)⇒ 后台要摆一条**说人话**的提示,别让它静悄悄地不出现。
 */
export function resolveTawkConfig(input: {
  dbPropertyId: string | null | undefined;
  dbWidgetId: string | null | undefined;
  envPropertyId: string | null | undefined;
  envWidgetId: string | null | undefined;
}): ResolvedTawkConfig {
  const dbProperty = input.dbPropertyId ?? null;
  const dbWidget = input.dbWidgetId ?? null;
  const envProperty = normalizeTawkId(input.envPropertyId);
  const envWidget = normalizeTawkId(input.envWidgetId);

  // DB 存了 ⇒ 赢(哪怕存的是空串 = 明确关掉);DB 没存 ⇒ 看环境变量
  const propertyId =
    dbProperty !== null ? normalizeTawkId(dbProperty) : envProperty;
  const widgetId = dbWidget !== null ? normalizeTawkId(dbWidget) : envWidget;

  const fromDb = dbProperty !== null || dbWidget !== null;
  const fromEnv = envProperty !== "" || envWidget !== "";
  const source: TawkConfigSource = fromDb ? "db" : fromEnv ? "env" : "none";

  const configured = isValidTawkId(propertyId) && isValidTawkId(widgetId);
  // 「什么都没填」不是「贴错了」—— 后台要分开说
  const invalid = !configured && (propertyId !== "" || widgetId !== "");

  return {
    propertyId,
    widgetId,
    configured,
    invalid,
    source,
    embedUrl: buildTawkEmbedUrl(propertyId, widgetId) ?? "",
  };
}

/* -------------------------------------------------------------------------- */
/*  浏览器那一侧的形状                                                         */
/* -------------------------------------------------------------------------- */

/**
 * tawk 的访客身份 —— 只摆我们真有的两个字段
 *
 * ⚠️ **显式写 `| undefined`** —— 仓库开了 `exactOptionalPropertyTypes`:
 * `name?: string` **不接受**显式的 `undefined`,而我们正是「查不到就是
 * undefined」(`user.name ?? undefined`)⇒ 必须写 `string | undefined`。
 */
export interface TawkVisitor {
  name?: string | undefined;
  email?: string | undefined;
}

/**
 * `window.Tawk_API` 的形状
 *
 * ⚠️ **它一开始是空的** —— 官方那段 embed 代码做的是
 * `var Tawk_API = Tawk_API || {}`,然后把**方法**装上去。所以:
 *
 * - **方法只有在 widget 起来之后才存在** ⇒ 调用前必须判 `typeof === "function"`;
 * - `visitor` / `onLoad` 是**我们自己写进去的配置**,随时可以设。
 */
export interface TawkApiConfig {
  visitor?: TawkVisitor | undefined;
  onLoad?: () => void;
  onBeforeLoad?: () => void;
  setAttributes?: (
    attributes: Record<string, unknown>,
    callback?: (ok: boolean) => void
  ) => void;
  minimize?: () => void;
  maximize?: () => void;
  hideWidget?: () => void;
  showWidget?: () => void;
  toggle?: () => void;
}

/** `window` 上多了 `Tawk_API` 之后的样子 */
export type TawkWindow = Window & { Tawk_API?: TawkApiConfig };
