/**
 * 淘宝「**直接下单**」链接 —— 纯函数,零 import
 *
 * ## 为什么需要这一份
 *
 * 工作室报的是:**「用户跳到淘宝后没有自动创建订单」**。
 *
 * 根因不在本站 —— 本站**确实**建了单(`checkout.ts` 里 `storefront_order`
 * 落库**早于**建支付会话),缺的是**淘宝那边的那一单**。
 *
 * 以前跳过去的是**商品详情页**(`item.taobao.com/item.htm?id=…`)—— 买家到了
 * 淘宝,还得自己:挑规格 → 点「立即购买」→ 填地址 → 提交。看起来就是「没自动
 * 创建订单」。
 *
 * ⇒ 改成跳淘宝的**下单确认页**(`buyParam` 带商品 + 数量 + 规格):
 *
 * ```
 * https://h5.m.taobao.com/cart/order.html?buyParam={商品id}_{数量}[_{skuId}]
 * ```
 *
 * 买家一落地就在**确认订单**那一步,商品、件数、规格都替他选好了,只差填
 * 地址和付款。
 *
 * ## 两条兜底(永远有一条路能走通)
 *
 * 这个地址是淘宝的**内部 H5 接口**(没公开文档)⇒ 万一形状变了、淘宝改了规则、
 * 某个商品不支持 ⇒ **不许把这条路走死**。所以:
 *
 * 1. **直连下单关掉了**(`directOrder = false`)⇒ 跳普通商品页(老行为)
 * 2. **拼不出地址**(商品 id 认不出来 / 数量不对 / 一单里两种尺寸)⇒ 跳普通
 *    商品页(老行为)
 *
 * ⇒ **老行为永远留着**,后台每一条链接都有那颗开关能一键切回去。
 *
 * ## 一单只能一件设计 —— 这是老规矩,这里不重复实现
 *
 * 「一单里有好几件不同的设计 ⇒ 淘宝下单没法做」那道闸在 `checkout.ts` 里
 * (`TAOBAO_MULTIPLE_DESIGNS`)⇒ 走到这个 provider 的,一定是一件设计。
 *
 * 但**同一个设计的两个尺寸**(比如 4cm 和 6cm)可以是两行 —— 那淘宝那边
 * **一个 skuId 装不下** ⇒ 退回普通商品页(买家自己挑)。**不猜**。
 *
 * ## 尺寸怎么翻译成淘宝的 skuId
 *
 * 淘宝那边卖的是**具体规格**(skuId),本站卖的是**尺寸**(4cm / 6cm / …)——
 * 两边不是一套编号 ⇒ 后台要配一张「本站尺寸 id → 淘宝 skuId」的表
 * (`product_taobao_link.sku_map`)。
 *
 * 没配 ⇒ 直连地址里**不带 skuId** ⇒ 买家落到确认页,淘宝让他自己挑一下规格
 * (比跳商品详情页从头来强)。
 *
 * ## 怎么拿到淘宝的 skuId
 *
 * 在淘宝那个商品的页面上把**规格都选一遍**,地址栏里会出现 `skuid=…` —— 那
 * 一串数字就是。**普通商品链接**(不是淘宝客)⇒ 没有佣金、没有 PID。
 */

/**
 * 淘宝的下单确认页
 *
 * 带 `buyParam` 的那个地址。⚠️ 这是淘宝的**内部 H5 接口**,没公开文档 ——
 * 形状变了就得改这里(后台那颗开关能一键退回商品页)。
 */
export const TAOBAO_ORDER_URL = "https://h5.m.taobao.com/cart/order.html";

/**
 * 「本站尺寸 id → 淘宝 skuId」的映射
 *
 * 例:`{ "size_R_4": "4512805343789", "size_R_6": "4512805343790" }`
 */
export type TaobaoSkuMap = Record<string, string>;

/** 淘宝的商品 id —— 纯数字 */
const ITEM_ID_PATTERN = /^\d+$/;

/** 淘宝的 skuId —— 也是纯数字 */
const SKU_ID_PATTERN = /^\d+$/;

/** 商品 id 是不是像样 */
export function isValidTaobaoItemId(value: unknown): value is string {
  return typeof value === "string" && ITEM_ID_PATTERN.test(value.trim());
}

/** skuId 是不是像样 */
export function isValidTaobaoSkuId(value: unknown): value is string {
  return typeof value === "string" && SKU_ID_PATTERN.test(value.trim());
}

/**
 * 拼淘宝的**下单确认页**地址
 *
 * `buyParam` 的形状是 `{商品id}_{数量}[_{skuId}]` —— 三段都有就带上 skuId,
 * 没有就只带前两段(淘宝会让买家自己挑规格)。
 *
 * ⚠️ **不许有任何空格** —— 参数里有空格淘宝会回「系统繁忙」。
 */
export function buildTaobaoOrderUrl(input: {
  /** 淘宝商品 id(纯数字) */
  itemId: string;
  /** 买几件 */
  quantity: number;
  /** 淘宝的 skuId —— 有就带上 */
  skuId?: string | null;
}): string {
  const buyParam = input.skuId
    ? `${input.itemId}_${input.quantity}_${input.skuId}`
    : `${input.itemId}_${input.quantity}`;
  return `${TAOBAO_ORDER_URL}?buyParam=${buyParam}`;
}

/**
 * 从映射表里查这个尺寸对应哪个淘宝 skuId
 *
 * 查不到 ⇒ `null`(直连地址里就不带 skuId)—— **不猜**。
 */
export function resolveTaobaoSkuId(
  skuMap: TaobaoSkuMap | null | undefined,
  sizeId: string | null | undefined
): string | null {
  if (!skuMap || !sizeId) return null;
  const skuId = skuMap[sizeId];
  if (!isValidTaobaoSkuId(skuId)) return null;
  return skuId.trim();
}

/**
 * 「本站尺寸 id → 淘宝 skuId」的映射 —— **收一下**
 *
 * - 键:本站的尺寸 id(非空)
 * - 值:淘宝的 skuId(纯数字)
 * - 值是空串 ⇒ **这一条不配**(不是错)⇒ 直接丢掉
 *
 * 认不出来 ⇒ `INVALID_SKU_ID` —— **不猜**。一个猜出来的 skuId 会把买家带到
 * **错的规格**上去(工作室那边对不上货)。
 */
export function checkTaobaoSkuMap(
  input: unknown
): { ok: true; map: TaobaoSkuMap } | { ok: false; problem: "INVALID_SKU_ID" } {
  if (input === null || input === undefined) return { ok: true, map: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, problem: "INVALID_SKU_ID" };
  }

  const map: TaobaoSkuMap = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const sizeId = key.trim();
    if (!sizeId) return { ok: false, problem: "INVALID_SKU_ID" };
    if (typeof value !== "string")
      return { ok: false, problem: "INVALID_SKU_ID" };
    const skuId = value.trim();
    // 空 = 这一条不配 —— 留着没关系,前端那个输入框空着就行
    if (!skuId) continue;
    if (!SKU_ID_PATTERN.test(skuId))
      return { ok: false, problem: "INVALID_SKU_ID" };
    map[sizeId] = skuId;
  }
  return { ok: true, map };
}

/**
 * 没用上直连下单时,**为什么**没用
 *
 * 服务端记一条日志用的 —— 界面不摆这些(买家不需要知道).
 */
export type TaobaoDirectOrderFallback =
  /** 后台那颗开关关着 */
  | "DIRECT_ORDER_DISABLED"
  /** 抠不出淘宝的商品 id */
  | "NO_ITEM_ID"
  /** 数量不对(0 / 负数 / 不是数) */
  | "INVALID_QUANTITY"
  /** 一单里两种尺寸 —— 一个 skuId 装不下 */
  | "MULTIPLE_SIZES";

/** 直连下单的结果 */
export interface TaobaoCheckoutUrlResult {
  /** 给浏览器的地址 */
  url: string;
  /** `direct` = 淘宝的下单确认页 / `product` = 普通商品页 */
  mode: "direct" | "product";
  /** 没用上直连的原因 —— `null` = 走了直连 */
  fallback: TaobaoDirectOrderFallback | null;
  /** 用上的淘宝 skuId —— 没用到是 null */
  skuId: string | null;
}

/**
 * 算这一单该跳到哪个淘宝地址
 *
 * **永远有一条路能走通** —— 拼不出直连地址就退回后台配的那个普通商品页。
 *
 * @param input.url      后台配的淘宝链接 —— **兜底永远是它**
 * @param input.itemId   淘宝商品 id(抠不出来是 null)
 * @param input.skuMap   「本站尺寸 id → 淘宝 skuId」
 * @param input.directOrder 后台那颗「直接下单」开关
 * @param input.quantity 这一单总共几件
 * @param input.sizeIds  这一单用到的尺寸 id(可以有几个,会去重)
 */
export function buildTaobaoCheckoutUrl(input: {
  url: string;
  itemId: string | null;
  skuMap?: TaobaoSkuMap | null;
  directOrder: boolean;
  quantity: number;
  sizeIds?: readonly (string | null | undefined)[];
}): TaobaoCheckoutUrlResult {
  /** 兜底 —— 普通商品页(老行为) */
  const productPage = (
    fallback: TaobaoDirectOrderFallback
  ): TaobaoCheckoutUrlResult => ({
    url: input.url,
    mode: "product",
    fallback,
    skuId: null,
  });

  if (!input.directOrder) return productPage("DIRECT_ORDER_DISABLED");

  const itemId = input.itemId?.trim() ?? "";
  if (!ITEM_ID_PATTERN.test(itemId)) return productPage("NO_ITEM_ID");

  const quantity = Math.floor(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) {
    return productPage("INVALID_QUANTITY");
  }

  // 这一单用到的尺寸(去重)—— 两个尺寸 ⇒ 一个 skuId 装不下
  const sizeIds = [
    ...new Set(
      (input.sizeIds ?? []).filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0
      )
    ),
  ];
  if (sizeIds.length > 1) return productPage("MULTIPLE_SIZES");

  const skuId =
    sizeIds.length === 1 ? resolveTaobaoSkuId(input.skuMap, sizeIds[0]) : null;

  return {
    url: buildTaobaoOrderUrl({ itemId, quantity, skuId }),
    mode: "direct",
    fallback: null,
    skuId,
  };
}
