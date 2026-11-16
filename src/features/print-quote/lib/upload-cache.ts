/**
 * 模型上传的**结果缓存** —— 判定层(纯函数)
 *
 * ## 要防的是哪一件事
 *
 * 建单幂等(服务端那层)挡住了「建出两张工单」,但**上传**那一步在它**前面**:
 *
 * ```
 * 点提交 → ① 打包模型 → ② 直传 R2 → ③ POST /api/print-orders
 * ```
 *
 * ② 每次都会产生**一个新的 R2 对象**(服务端签发的 `objectKey` 带时间戳 +
 * nanoid)。⇒ 用户重复提交(网络卡了重试 / 手抖双击)会**上传好几次**,
 * 前几次传上去的对象**留在桶里没人管**。
 *
 * ## 为什么删不掉 —— 所以要**尽量不产生**
 *
 * 工作室的 R2 桶**锁着对象**(`ObjectLockedByBucketPolicy`,HTTP 409)⇒
 * `DeleteObject` 会被拒 ⇒ **孤儿文件永久留在桶里**,占空间、还多一份「用户
 * 传过的文件」。
 *
 * ⇒ 缓存是**唯一**能少产生孤儿的办法:**同一个模型 + 同一组缩放 ⇒ 复用
 * 上一次的上传结果**,不再传第二遍。
 *
 * ## 为什么缓存**安全**
 *
 * 预签名 PUT URL **10 分钟过期**,但缓存里存的是**上传结果**
 * (`publicUrl` / `objectKey` / `size` / `fileName`),不是那个签名 URL ——
 * `publicUrl` 是**永久**地址 ⇒ 缓存不会因为签名过期而失效。
 *
 * ## 键怎么算
 *
 * 键 = 「**这份 zip 的内容**」的指纹:
 *
 * | 放 | 为什么 |
 * |---|---|
 * | 模型名 / 原 obj 文件名 | 换了模型就是另一份 zip |
 * | obj 文本的**长度** | 几何变了(换了模型 / 重新导入)长度就变 |
 * | 三档缩放 | **尺寸变了 ⇒ zip 里的坐标变了** ⇒ 必须换键 |
 *
 * **不放**的:姿态(打包**不旋转**,姿态不进 zip)、材质贴图(同一个模型不变)、
 * 文件名里的随机成分(`uploadModelFile` 里那个 `fileName` 是 `${name}.zip`,
 * 没有随机成分)。
 *
 * ## 这一层是**纯函数**
 *
 * 不碰 DB、不碰网络、不碰 React ⇒ 能进 vitest `unit` project 直接测。
 * (判定层先例:`providers/alipay/reconcile-rules.ts` /
 * `payments/lib/amount-guard.ts` / `print-quote/lib/idempotency.ts`。)
 */

import type { PricingModelPayload } from "@/features/pricing/components/pricing-calculator-types";

/**
 * 算一份模型的「上传缓存键」
 *
 * 同一个键 ⇒ 上传出来的字节**完全一样** ⇒ 可以复用上一次的上传结果。
 *
 * @param payload 计算器给的模型载荷(模型 + 当前生效的缩放)
 */
export function computeModelUploadCacheKey(
  payload: PricingModelPayload
): string {
  const { model, scales } = payload;
  return [
    "model-upload-v1",
    model.name,
    model.objFileName,
    // obj 文本的长度 —— 几何变了它就变(换模型 / 重新导入)
    model.objText.length,
    // 尺寸:三档缩放必须**逐档**进键 —— 只进一个整体缩放会漏掉「只改了
    // X 那一档」的情况
    scales[0],
    scales[1],
    scales[2],
  ].join("|");
}
