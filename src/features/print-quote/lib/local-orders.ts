/**
 * 本地订单索引 —— localStorage
 *
 * ## 为什么存本地而不是让用户注册
 *
 * 打印服务的报价单和商城不一样:商城是「浏览 → 加购 → 结算」,用户天然会
 * 有账号;打印服务是「上传模型 → 拿个价 → 决定要不要做」,很多人在报价
 * 阶段就走掉了,逼他们先注册会把人挡在门外。
 *
 * 所以下单是匿名的,查状态靠 **订单号 + 查询令牌** 双因子。令牌存在本地
 * —— 换浏览器就查不到自己的订单,这是匿名方案的固有代价,认了。
 *
 * ## 存什么
 *
 * 只存「订单号 + 令牌 + 下单时间」三样,不给模型文件、联系方式留副本。
 * 报价明细和状态每次现查服务端。
 */

export type LocalOrder = {
  orderNo: string;
  /** 匿名查询令牌 */
  token: string;
  /** ISO 时间串 */
  createdAt: string;
};

const STORAGE_KEY = "mooncoda.print_orders";
const MAX_KEPT = 20;

/** 读本地订单(浏览器外返回空数组) */
export function listLocalOrders(): LocalOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LocalOrder =>
        !!item &&
        typeof item === "object" &&
        typeof (item as LocalOrder).orderNo === "string" &&
        typeof (item as LocalOrder).token === "string"
    );
  } catch {
    // localStorage 被隐私模式禁掉 / 数据坏了 —— 都不能让整页崩
    return [];
  }
}

/** 记一笔(最新的排前面,最多留 MAX_KEPT 条) */
export function saveLocalOrder(order: LocalOrder): void {
  if (typeof window === "undefined") return;
  try {
    const next = [
      order,
      ...listLocalOrders().filter((o) => o.orderNo !== order.orderNo),
    ].slice(0, MAX_KEPT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 写不进去(配额满 / 隐私模式)—— 不影响下单本身
  }
}

/** 删一笔(用户不想在本地留着了) */
export function removeLocalOrder(orderNo: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = listLocalOrders().filter((o) => o.orderNo !== orderNo);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 同上
  }
}
