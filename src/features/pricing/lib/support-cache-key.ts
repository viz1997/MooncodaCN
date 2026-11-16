/**
 * 支撑计算的**缓存键** —— 尺寸 + 姿态的组合
 *
 * ## 为什么要有这个
 *
 * 支撑克重是「**某一组尺寸 + 某一个姿态**」算出来的结果。改一次尺寸、
 * 转一下模型,那个数就是**另一组**参数的结果了。
 *
 * 以前判「算过没有」靠的是「`poseSupport` 有没有值」—— 那只认**有没有**,
 * 不认**是哪一组参数**算的。改完尺寸直接提交,发上去的是**旧尺寸**的
 * 支撑克重 ⇒ 服务端 `input.supportWeightG ?? 0` **少收支撑费**。
 *
 * 有了这把键:
 *
 * - 缓存判断 = 「当前键 == 这份结果算的时候的键」⇒ 旧尺寸的结果**用不了**
 * - 报价预览 = 「键对不上就不拿旧数当新的用」⇒ 预估价不会偏低
 *
 * ## 2026-11-15:键里多一个「托底高度」
 *
 * 浮雕那档托底 1mm、手办那档 5mm(工作室的原话:「浮雕模型不需要像手办
 * 模型5mm底部支撑,只需要1mm支撑」)。托底**算进支撑体积** ⇒ 换档位就是
 * 换了支撑克重 ⇒ **必须换键**。
 *
 * 少了这一条:用户在「自动 / 浮雕 / 手办」之间切一下,手里那份支撑克重
 * 还是上一档的(5mm 托底算出来的),而托底 1mm 那一档其实应该更轻 ⇒
 * **按旧数收钱**(多收,用户会来问)或者反过来(少收)。所以键里带托底。
 *
 * ## 纯函数,零依赖
 *
 * 不引 `@/db`、不引 `server-only` ⇒ 客户端组件能安全 import,也能进
 * `unit` project 跑单测(`src/test/pricing/pure/support-cache-key.test.ts`)。
 */

/** 打印姿态 —— 三个轴的角度(度) */
export type SupportPose = {
  /** 绕 X 轴 */
  x: number;
  /** 绕 Y 轴 */
  y: number;
  /** 绕 Z 轴 */
  z: number;
};

/**
 * 取整到 3 位小数
 *
 * 角度条拖一下会冒出 `12.000000000000002` 这种尾巴 —— 不取整的话,
 * 同一个姿态的两次键不相等 ⇒ 白白重算一次。
 */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * 尺寸 + 姿态 + 托底的组合键
 *
 * @param pose 打印姿态(`manualRot*`,**不是**相机的 `viewerRot*` ——
 *   转相机不该重算支撑)
 * @param scales 生效中的缩放因子 `[sx, sy, sz]`
 * @param liftMm 生效中的托底高度 mm(浮雕 1 / 手办 5)—— **省略按 0 算**
 *   (老调用方不会带上托底,但那也只是键的一个片段)
 */
export function supportCacheKey(
  pose: SupportPose,
  scales: readonly number[],
  liftMm?: number | undefined
): string {
  const [sx, sy, sz] = scales;
  return [
    `p:${round3(pose.x)},${round3(pose.y)},${round3(pose.z)}`,
    `s:${round3(sx ?? 1)},${round3(sy ?? 1)},${round3(sz ?? 1)}`,
    `l:${round3(liftMm ?? 0)}`,
  ].join("|");
}
