/**
 * 耗材克重 —— **客户端安全**(零成本口径、零依赖)
 *
 * ## 这条公式有多要紧
 *
 * ```
 * 耗材克重 (g) = 体积 (cm³) × 材料密度 (g/cm³)
 * ```
 *
 * 客户端**必须**能算这个 —— 克重工具摆的那三个数(耗材 / 支撑 / 总)里的
 * 「耗材」就是它,得**实时**跟着尺寸变。
 *
 * ## 为什么不在 `pricing-engine.ts` 里算
 *
 * 因为那个文件里有**单价**(¥4.5/g 那一档)—— 客户端一旦 import 它,那个
 * 字面量就进 bundle 了(工作室 2026-11-16:别暴露成本)。
 *
 * ⇒ 密度和克重各归各的文件:
 *
 * | 文件 | 内容 | 谁能 import |
 * |---|---|---|
 * | `material-weight.ts`(这个) | 密度 + 克重 | 客户端 / 服务端 |
 * | `pricing-engine.ts` | 单价 / 分档价 / 钱 | **只有服务端** |
 *
 * 密度本身**不算成本**(1.2 g/cm³ 是材料物性,不是价),但它跟单价住在一起
 * 的时候容易顺手把单价带进客户端 —— 所以拆开。
 */

/**
 * 出厂材料密度 (g/cm³)
 *
 * - **模型**:光敏树脂 ≈ 1.2
 * - **支撑**:水溶性支撑(PVA/BVOH)≈ 1.28 —— 跟模型**不是**一种材料
 *
 * 这两个数**不是**成本口径,可以直接发给浏览器。真正的「材料库」(后台
 * `/admin/print-pricing` 配的那一档)走 `ClientPrintConfig` 发到前端,
 * 这两个只是**兜底默认值**。
 */
export const DEFAULT_MATERIAL_DENSITY = 1.2;
export const DEFAULT_SUPPORT_DENSITY = 1.28;

/**
 * 算耗材克重
 *
 * 返回 `null` 表示这组输入算不出来(体积非正 / 密度非法)—— 调用方要把它
 * 当成「还没有克重」处理,而不是「克重是 0」。
 *
 * 跟服务端 `calculatePrice()` 的守卫**同一个口径**:体积 ≤ 0 或密度 ≤ 0
 * 都算不出来。两边不一致的话,页面上的克重跟工单上的对不上。
 */
export function computeMaterialWeight(
  volumeCM3: number,
  density: number
): number | null {
  if (!Number.isFinite(volumeCM3) || volumeCM3 <= 0) return null;
  if (!Number.isFinite(density) || density <= 0) return null;
  return volumeCM3 * density;
}
