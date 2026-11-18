/**
 * 淘宝链接的**纯规则** —— 校验 / 抠商品号 / 决定「这一单跳哪个链接」
 *
 * ## 为什么单独一个文件
 *
 * 这份规则有三条铁律,每一条都会**直接决定钱怎么收**,所以必须能进
 * vitest 的 `unit` project 单独测(不碰数据库、不碰网络):
 *
 * 1. **链接的域名必须是 taobao / tmall** —— 链接要摆给买家看,后台录错了
 *    就是把人往别处引(钓鱼风险)
 * 2. **链接必须指向一个具体的商品**(`id=`)—— 一个店铺首页没法表达
 *    「这一单是这件设计」
 * 3. **一单只能有一个跳转目标** —— 车里放了两件不同的设计时,淘宝那边
 *    没有一个链接能同时对应两件货
 *
 * ⇒ 零 import(只有 `import type`),能进 `unit` project。
 *
 * ## 跟「淘宝客」没关系
 *
 * 普通淘宝商品链接(`item.taobao.com/item.htm?id=…`)**不是淘宝客** ——
 * 没有佣金、没有归因期,不受《推广者管理规范》约束 ⇒ 不需要推广位 / PID。
 *
 * 反过来说:**淘宝那边那条商品页里不许摆微信号 / 二维码**(那是《诱导第三方》)
 * —— 本站这边摆链接没问题,链接过去之后别再把人导回微信。
 */

/** 链接有问题的时候,稳定的原因码 —— 界面按码查文案 */
export type TaobaoUrlProblem =
  /** 没填 */
  | "EMPTY"
  /** 不是个网址 */
  | "INVALID_URL"
  /** 域名不是 taobao / tmall */
  | "NOT_TAOBAO"
  /** 是淘宝的网址,但指不到一个具体商品(店铺首页 / 短链) */
  | "NO_ITEM_ID";

/** 校验结果 */
export type TaobaoUrlCheck =
  | {
      ok: true;
      /** 归一化之后的地址 */
      url: string;
      /** 抠出来的淘宝商品 id(抠不出来是 null) */
      itemId: string | null;
    }
  | { ok: false; problem: TaobaoUrlProblem };

/**
 * 允许的域名后缀
 *
 * 只收这两个根域(连同它们的子域)。`item.taobao.com` / `detail.tmall.com` /
 * `shop12345.taobao.com` 都过;`taobao.com.evil.com` 不过(那不是子域)。
 */
export const TAOBAO_ALLOWED_HOST_SUFFIXES = [
  "taobao.com",
  "tmall.com",
] as const;

/**
 * 这个 host 是不是淘宝 / 天猫
 *
 * **必须是「本身」或者「以 `.` + 根域结尾」** —— `not-taobao.com` 那种
 * 结尾看着像的不过(它在 `taobao.com` 前面多了一段)。
 */
export function isTaobaoHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  if (!normalized) return false;
  return TAOBAO_ALLOWED_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`)
  );
}

/**
 * 归一化后台粘进来的链接
 *
 * 人从淘宝后台复制链接,粘进来的经常带着这些:
 *
 * - 首尾空格 / 换行
 * - 中文引号 `""` / `''`
 * - `<>`(有的编辑器会加)
 *
 * ⇒ 先把这些摘掉,再交给 `URL` 解析。**不改地址本身**(不补协议、不改路径)
 * —— 改了就可能变成另一个页面。
 */
export function normalizeTaobaoUrl(raw: string): string {
  return raw
    .trim()
    .replace(/^["'“”‘’<]+/, "")
    .replace(/["'“”‘’>]+$/, "")
    .trim();
}

/**
 * 抠淘宝商品 id
 *
 * 两种形状:
 *
 * - `https://item.taobao.com/item.htm?id=123456789` ⇒ 查 `id` 查询参数
 * - `https://item.taobao.com/i123456789.htm`(老形状)⇒ 路径里抠
 *
 * 抠不出来返回 null —— **不猜**。宁可让后台说「这个链接指不到具体商品」,
 * 也不要塞一个错的商品号进去(工作室照着它核货会核错)。
 */
export function extractTaobaoItemId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const fromQuery = parsed.searchParams.get("id");
  if (fromQuery && /^\d+$/.test(fromQuery)) return fromQuery;

  // 老形状:`/i123456789.htm`
  const legacy = /\/i(\d+)\.htm(?:\/|$)/.exec(parsed.pathname);
  if (legacy?.[1]) return legacy[1];

  return null;
}

/**
 * 校验一条淘宝链接
 *
 * **五道闸,顺序不能改**(短路,第一个不通过就返回):
 *
 * 1. 空 ⇒ `EMPTY`
 * 2. 不是个网址 ⇒ `INVALID_URL`
 * 3. 协议不是 http / https ⇒ `INVALID_URL`
 * 4. 域名不是 taobao / tmall ⇒ `NOT_TAOBAO`
 * 5. 抠不出商品 id ⇒ `NO_ITEM_ID`
 */
export function checkTaobaoUrl(raw: string): TaobaoUrlCheck {
  const url = normalizeTaobaoUrl(raw);
  if (!url) return { ok: false, problem: "EMPTY" };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, problem: "INVALID_URL" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, problem: "INVALID_URL" };
  }

  if (!isTaobaoHost(parsed.hostname)) {
    return { ok: false, problem: "NOT_TAOBAO" };
  }

  const itemId = extractTaobaoItemId(url);
  if (!itemId) return { ok: false, problem: "NO_ITEM_ID" };

  return { ok: true, url, itemId };
}

/* -------------------------------------------------------------------------- */
/*  「这一单跳哪个链接」                                                          */
/* -------------------------------------------------------------------------- */

/** 挑跳转目标时的问题码 */
export type TaobaoTargetProblem =
  /** 车里一件货都没有 */
  | "NO_ITEM"
  /**
   * 车里有多件**不同的设计**
   *
   * 一个淘宝链接只能对应一个设计 ⇒ 两件设计时没有能同时表达两件货的链接。
   * ⇒ 让买家分开下单(不是「随便挑一个」—— 那样会买错货)。
   */
  | "MULTIPLE_DESIGNS";

export type TaobaoTarget =
  | { ok: true; handle: string }
  | { ok: false; problem: TaobaoTargetProblem };

/**
 * 从这一单的行里挑出「该跳哪个淘宝链接」
 *
 * @param handles 这一单里出现的**设计 handle**(去重之后)
 *
 * ⚠️ **判据是「不同的设计」,不是「几件货」** —— 同一件设计买 3 件,淘宝那边
 * 拍 3 件就行,链接是同一个 ⇒ 只算一个设计。
 */
export function pickTaobaoTarget(handles: string[]): TaobaoTarget {
  const unique = [...new Set(handles.filter((handle) => handle.length > 0))];
  const [only] = unique;
  if (!only) return { ok: false, problem: "NO_ITEM" };
  if (unique.length > 1) return { ok: false, problem: "MULTIPLE_DESIGNS" };
  return { ok: true, handle: only };
}
