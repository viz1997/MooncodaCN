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
 *   → **内置默认**(工作室自己那套 tawk 账号,2026-11-16)
 *   → 没配(页面上就没有客服小窗)
 * ```
 *
 * ⚠️ **DB 空串 ≠ 没存** —— 空串是「明确关掉」,跟「从来没存过」是两件事
 * (跟 `site-setting.ts` 的 `resolveSiteUrl()` 一个口径)。
 *
 * ## 为什么有「内置默认」这一档(2026-11-16)
 *
 * 工作室 2026-11-16 把官方那段 embed 代码贴过来了 ⇒ 这两个 ID 是**明文**
 * 写在页面源码里的(谁打开「查看网页源代码」都能看到)⇒ **它们不是密钥**,
 * 放进仓库没有泄漏风险。
 *
 * 而「**部署上去就有小窗**」比「先去后台点一次保存」省事得多 ⇒ 把工作室
 * 自己那对 ID 预置成**最后一档兜底**。
 *
 * 想换自己的一对 ⇒ 在 `/admin/site-settings` 存一次(DB 赢)。
 * 想**彻底关掉** ⇒ 两个框里**都留空**保存(存空串 = 明确关掉)。
 * ⚠️ 点「删掉后台这两行」是**退回内置默认** —— 不是关掉。
 *
 * ## 小窗**永远是匿名**的(2026-11-16)
 *
 * 工作室 2026-11-16 拍板:**不要**把登录访客的姓名 / 邮箱发给 tawk.to。
 *
 * 登录访客的**姓名 / 邮箱**是个人信息,tawk.to 是**第三方**(境外)服务 ⇒
 * 这条数据外发**整条路都不做**:没有开关、没有环境变量、代码里也没有那条
 * 通路。客服在 tawk 后台只看得见「有人来咨询」,具体身份靠聊天内容问。
 *
 * ⚠️ **以后谁要加这个,先问工作室** —— 猜错的方向是「把个人信息发给
 * 第三方」。
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
/*  内置默认(工作室自己那套账号)                                                */
/* -------------------------------------------------------------------------- */

/**
 * 工作室自己那套 tawk.to 账号 —— **内置默认**(2026-11-16)
 *
 * 工作室 2026-11-16 把官方那段 embed 代码贴过来了:
 *
 * ```
 * https://embed.tawk.to/6afb1e688e6f59d4de4958a2/1k7ietiul
 * ```
 *
 * ⇒ 把这两个 ID 预置成回退链的**最后一档**:部署上去小窗就在,不用先去后台
 * 点一次保存。
 *
 * ⚠️ **这两个 ID 不是密钥** —— 官方 embed 代码就明文写在页面源码里,任何访客
 * 看一眼源码就能拿到 ⇒ 放进仓库没有泄漏风险(跟 `NEXT_PUBLIC_*` 一个性质)。
 *
 * 想换自己的一对 ⇒ 在 `/admin/site-settings` 存一次(DB 赢过这一档)。
 * 想**彻底关掉** ⇒ 两个框里都留空保存(存空串 = 明确关掉)。
 */
export const TAWK_DEFAULT_PROPERTY_ID = "6afb1e688e6f59d4de4958a2";
export const TAWK_DEFAULT_WIDGET_ID = "1k7ietiul";

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
export type TawkConfigSource = "db" | "env" | "default" | "none";

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
 * ```
 * DB(存了 ⇒ 赢,哪怕存的是空串 = 明确关掉)
 *   → 环境变量(配了 ⇒ 赢)
 *   → 内置默认(工作室自己那套账号)
 *   → 空串(没配 ⇒ 页面上没有小窗)
 * ```
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
  /**
   * 内置默认(工作室自己那套 tawk 账号)—— **最后一档兜底**(2026-11-16)
   *
   * 没传 ⇒ 这一档不存在(等价于传空串)。
   */
  defaultPropertyId?: string | null | undefined;
  defaultWidgetId?: string | null | undefined;
}): ResolvedTawkConfig {
  const dbProperty = input.dbPropertyId ?? null;
  const dbWidget = input.dbWidgetId ?? null;
  const envProperty = normalizeTawkId(input.envPropertyId);
  const envWidget = normalizeTawkId(input.envWidgetId);
  const defaultProperty = normalizeTawkId(input.defaultPropertyId);
  const defaultWidget = normalizeTawkId(input.defaultWidgetId);

  // DB 存了 ⇒ 赢(哪怕存的是空串 = 明确关掉);DB 没存 ⇒ 看环境变量;
  // 环境变量没配 ⇒ 看内置默认
  const propertyId =
    dbProperty !== null
      ? normalizeTawkId(dbProperty)
      : envProperty !== ""
        ? envProperty
        : defaultProperty;
  const widgetId =
    dbWidget !== null
      ? normalizeTawkId(dbWidget)
      : envWidget !== ""
        ? envWidget
        : defaultWidget;

  const fromDb = dbProperty !== null || dbWidget !== null;
  const fromEnv = !fromDb && (envProperty !== "" || envWidget !== "");
  const fromDefault =
    !fromDb && !fromEnv && (defaultProperty !== "" || defaultWidget !== "");
  const source: TawkConfigSource = fromDb
    ? "db"
    : fromEnv
      ? "env"
      : fromDefault
        ? "default"
        : "none";

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
 * `window.Tawk_API` 的形状
 *
 * ⚠️ **它一开始是空的** —— 官方那段 embed 代码做的是
 * `var Tawk_API = Tawk_API || {}`,然后把**方法**装上去。所以:
 *
 * - **方法只有在 widget 起来之后才存在** ⇒ 调用前必须判 `typeof === "function"`;
 * - `onLoad` 是**我们自己写进去的配置**,随时可以设。
 *
 * ⚠️ **没有 `visitor`** —— 小窗**永远是匿名**的(工作室 2026-11-16 拍板):
 * 访客的姓名 / 邮箱一律不发出去。
 */
export interface TawkApiConfig {
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
