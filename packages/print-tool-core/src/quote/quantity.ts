/**
 * 打印件数 —— 「同一模型打印多件」(2026-11-17)
 *
 * ## 工作室的原话
 *
 * > 同一模型打印多件;后处理按件计,不重复收起步价。
 *
 * ## 件数放大的是**按件的活**,不是**按单的活**
 *
 * | 费用项 | 跟件数的关系 | 理由 |
 * |---|---|---|
 * | 克重费 | **× N** | 料是按件用的 |
 * | 后处理费 | **× N** | 去支撑 / 清洗 / 基础打磨 / 上 uv 光油 / **独立包装** —— 每件都是单独的活 |
 * | 支撑加价 | **× N** | 支撑也是按件长的 |
 * | **运费** | **不乘** | 工作室原话「运费按单收取」—— 多件装一个箱,一个运费 |
 *
 * ## 「不重复收起步价」是什么意思
 *
 * **不是**「后处理费 × N 之后,再额外收一次订单级的起步费」——
 * 也就是**不是** `varnish × N + varnish`。
 *
 * 后处理费本身就是**按件**的:每一件都要单独去支撑、清洗、打磨、上油、
 * 独立包装。把它算成 N 倍就是全部成本;再叠一个订单级的起步费就是
 * **重复收**。
 *
 * ## 取整顺序:**先在「元」上乘件数,再一次性取整到分**
 *
 * ```
 * ✅ ceil(单件克重费(元) × N × 100)      ← 先乘,后取整
 * ❌ ceil(单件克重费(元) × 100) × N      ← 逐件取整,再相乘
 * ```
 *
 * 后者会把**每一件**的取整误差累积起来 ⇒ 系统性地**少收钱**。
 * 仓库的铁律是「我们收的钱,一律向上取整到分」—— 那一次取整就够了。
 *
 * ## 纯函数,零依赖
 */

import { yuanToCentsCeil } from "./rounding";

/** 最少一件 */
export const MIN_QUANTITY = 1;

/**
 * 最多几件
 *
 * 999 是「多件打印」这个场景的上限 —— 再多就不是「同一模型打印多件」了,
 * 而是批量生产(那是另一条业务线,定价口径不一样)。
 *
 * ⚠️ **API 层要**拒绝**越界,不能靠夹取** —— 夹取会**静默少收钱**
 * (用户要 5000 件,服务端夹成 999 件,少收 4/5 的钱)。引擎这一层的夹取
 * 只是**兜底**,防止某个调用方漏了校验。
 */
export const MAX_QUANTITY = 999;

/**
 * 把任意输入收敛成合法件数
 *
 * 认不出来 / 不是整数 / 越界 ⇒ 落到 `fallback`(默认 1)。
 *
 * ⚠️ **这是兜底,不是校验** —— 接口层用 zod 拒绝越界(返 400),引擎这一层
 * 只保证「算价链路拿到的永远是一个合法件数」。
 */
export function normalizeQuantity(
  value: unknown,
  fallback = MIN_QUANTITY
): number {
  const base = Number.isFinite(fallback) ? Math.trunc(fallback) : MIN_QUANTITY;
  const safeBase = Math.min(Math.max(base, MIN_QUANTITY), MAX_QUANTITY);
  if (value === null || value === undefined || value === "") return safeBase;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return safeBase;
  const rounded = Math.trunc(parsed);
  if (rounded < MIN_QUANTITY) return safeBase;
  if (rounded > MAX_QUANTITY) return safeBase;
  return rounded;
}

/**
 * 把一个「单件金额(元)」放大到「整单金额(元)」
 *
 * 放大在**元**上做,取整在**分**上做一次 —— 见文件头的取整顺序。
 */
export function scaleYuan(unitYuan: number, quantity: number): number {
  return unitYuan * quantity;
}

/**
 * 把一个「单件金额(元)」放大到「整单金额(分)」—— **先乘后取整**
 *
 * 这是引擎里**唯一**允许把件数乘进钱的地方。
 *
 * ⚠️ **入参是「元」,出参是「分」** —— 中间那一次 `× 100` 不能少。
 * 少了它就是**按原价的 1% 收款**(10 元算成 10 分)—— 那是最难发现的那种
 * 错:界面上的数看着「便宜得离谱」,但不会报错。
 *
 * ```
 * ceil(单件金额(元) × N × 100)
 * ```
 */
export function scaleYuanToCentsCeil(
  unitYuan: number,
  quantity: number
): number {
  return yuanToCentsCeil(scaleYuan(unitYuan, quantity));
}
