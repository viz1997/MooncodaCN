/**
 * 模型接力 —— 从克重工具(`/tools/weight`)把量好的模型交给报价台(`/quote`)
 *
 * ## 为什么需要这个
 *
 * 工具页是**只算不存**的地方:模型文件在浏览器里,报价台是**能报价能下单**
 * 的地方。要下单就得把模型带过去 —— 带不过去的话,用户得在报价台重新选一遍
 * 同一个文件(文件解析要几秒,大模型更慢)。
 *
 * ## 为什么不是 URL / sessionStorage
 *
 * - **URL 带不了** —— 解析后是几 MB 的 OBJ 文本 + 一堆贴图 blob
 * - **sessionStorage 存不了** —— `ModelFile` 里装的是 `URL.createObjectURL()`
 *   出来的 blob URL,不是字符串,序列化不了;硬存原始字节又会把 5MB 的
 *   sessionStorage 撑爆
 *
 * ## 为什么挂在 globalThis 上,而不是模块级变量
 *
 * 客户端路由跳转**不刷新文档**,同一个 realm 里变量还在 —— 但**模块**未必是
 * 同一个实例:App Router 给每个 route entry 单独打 client bundle,同一个模块
 * 被两个路由各打一份是很正常的事。那种情况下模块级变量就断了 —— 工具页存进
 * 副本 A、报价台从副本 B 读,读到 null,接力**静默失效**(用户看到的就是
 * 「模型没带过来」,但没有任何报错)。
 *
 * `globalThis` 是同一个 realm 里**唯一**确定共享的东西(跟模块打几份无关)。
 *
 * ## 边界(先读这一段再用)
 *
 * - **只在浏览器里有意义** —— 这个模块只被客户端组件 import。写操作发生在
 *   事件回调里(服务端渲染不跑事件回调),所以不存在「服务端多用户共用一个
 *   变量」的问题。
 * - **整页刷新就没了** —— 用户在工具页按一下刷新,接力作废(报价台回到空态,
 *   重新选文件即可)。
 * - **登录跳转也没了** —— `/quote` 在登录墙后面,未登录访问会被 302 到登录页,
 *   那是**整页跳转**,接力作废。所以工具页对未登录用户写明了「回来要重新选
 *   一次模型文件」。
 * - **摆盘结果不接力** —— 接力过去的模型是**初始角度**的支撑克重;要最优
 *   姿态,得在报价台再跑一次智能摆盘(跟直接去报价台选文件的行为一样)。
 */

import type { PricingModelPayload } from "@/features/pricing/components/pricing-calculator-types";

/** 待接力的模型 —— 只有一个槽位 */
type HandoffStore = {
  /**
   * 要接力给报价台的模型 —— 只保留**最新**那一个
   *
   * 用户在工具页换了模型,之前那个就该作废。
   */
  pending: PricingModelPayload | null;
};

/** 挂在 globalThis 上的键名 —— 全局唯一,不会跟别的库撞 */
const GLOBAL_KEY = "__mooncoda_print_model_handoff__";

/**
 * 服务端兜底 —— 模块级
 *
 * 服务端**不会写**这个 store(写操作只发生在事件回调里,服务端渲染不跑),
 * 所以它永远是空的,不会跨请求串数据。这里只是为了让类型完整。
 */
const serverStore: HandoffStore = { pending: null };

/**
 * 浏览器里的那一份 —— 挂在 globalThis 上
 *
 * 同一个 realm 共享一份,跟模块被打成几份无关(见文件头的说明)。
 */
function browserStore(): HandoffStore | null {
  if (typeof window === "undefined") return null;
  const g = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: HandoffStore;
  };
  let store = g[GLOBAL_KEY];
  if (!store) {
    store = { pending: null };
    g[GLOBAL_KEY] = store;
  }
  return store;
}

/** 拿到当前 realm 的接力仓库 */
function store(): HandoffStore {
  return browserStore() ?? serverStore;
}

/**
 * 存起「要接力给报价台」的模型
 *
 * 工具页点「去报价下单」时调用。传 null = 撤掉接力(用户清了模型)。
 */
export function stashPendingModel(payload: PricingModelPayload | null): void {
  store().pending = payload;
}

/**
 * 报价台取走接力过来的模型 —— **取走即清空**
 *
 * 取第二次拿到的是 null:接力是一次性的,报价台刷新一下不会又冒出个模型。
 */
export function takePendingModel(): PricingModelPayload | null {
  const s = store();
  const payload = s.pending;
  s.pending = null;
  return payload;
}
