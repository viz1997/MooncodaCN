/**
 * 查单对账的**节流** —— 别把支付宝打爆
 *
 * ## 为什么需要节流
 *
 * 付款成功页在轮询订单状态(3 秒一轮),打印工单那侧也在轮询。如果每一轮
 * 轮询都去问一次支付宝「这单付了没」,一笔订单在用户停留的那两分钟里会
 * 打 40 次查单 —— 支付宝有接口频率限制,打满了会限流,而**限流正好发生在
 * 我们最需要查单的时候**。
 *
 * ⇒ 同一个订单在**一段时间内只查一次**。
 *
 * ## 为什么是**进程内**的
 *
 * 这不是「严格限流」,是「别浪费调用」。即便多实例各查一次,也只是多几次
 * 调用 —— 落库那一层是幂等的(`transitions.ts` 里「已经是 `paid` 就 skip」),
 * **不会重复记账**。
 *
 * 真要严格限流得写进 DB(多一个 `last_reconciled_at` 列 + 一次 UPDATE)——
 * 那要改表结构、要跑迁移,为「少打几次查单」不值当。
 *
 * ## 状态会过期
 *
 * `Map` 是进程内内存,理论上会一直涨 ⇒ 记的条目超过阈值就把**过期**的那些
 * 扔掉(只扔超过间隔的,正在冷却期内的留着)。
 */

/** 同一个订单两次查单之间的最小间隔(毫秒) */
export const RECONCILE_THROTTLE_MS = 20_000;

/** 节流器的状态 —— 可以自己造一份(测试用) */
export interface ReconcileThrottleState {
  /** 订单号 → 上一次**放行**的时刻 */
  lastClaimAt: Map<string, number>;
}

/** 造一份空的节流器状态 */
export function createReconcileThrottleState(): ReconcileThrottleState {
  return { lastClaimAt: new Map<string, number>() };
}

/** 默认那份(进程内共用) */
const defaultState: ReconcileThrottleState = createReconcileThrottleState();

/** 状态里最多留多少条 —— 超过就开始清过期的 */
const MAX_ENTRIES = 500;

/**
 * 能不能查这一次单
 *
 * @param orderNo 订单号
 * @param now 现在(毫秒时间戳)—— 传进来是为了可测
 * @param intervalMs 两次之间的最小间隔
 * @param state 节流器状态(默认用进程内那一份)
 * @returns true = 放行(并记下这一刻);false = 离上次太近,跳过
 */
export function claimReconcileSlot(
  orderNo: string,
  now: number,
  intervalMs: number = RECONCILE_THROTTLE_MS,
  state: ReconcileThrottleState = defaultState
): boolean {
  const last = state.lastClaimAt.get(orderNo);
  if (last !== undefined && now - last < intervalMs) {
    return false;
  }

  // 顺手清过期条目 —— 别让 Map 一直涨
  if (state.lastClaimAt.size > MAX_ENTRIES) {
    for (const [key, at] of state.lastClaimAt) {
      if (now - at >= intervalMs) {
        state.lastClaimAt.delete(key);
      }
    }
  }

  state.lastClaimAt.set(orderNo, now);
  return true;
}

/** 把默认那份节流器清空(测试用) */
export function resetReconcileThrottle(): void {
  defaultState.lastClaimAt.clear();
}
