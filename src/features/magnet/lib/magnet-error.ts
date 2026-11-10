/**
 * 磁吸孔切割失败 —— code 翻译成人话
 *
 * ## 为什么不给用户看「请稍后重试」
 *
 * 切割失败的原因**每一件都是用户能自己解决的**:
 *
 * - 模型不是封闭流形 ⇒ 去「打印前工作台 → 检查」修
 * - 面太薄 ⇒ 换个面,或者把模型做厚一点
 * - 孔切到边上 ⇒ 换个更大的面
 *
 * 一句笼统的「切割失败」把这些全盖住了 —— 用户只能反复点那颗按钮。
 *
 * ## 纯函数,不碰 React
 *
 * 这里只做「code → i18n key」的映射,翻译交给调用方的 `t()`。所以这个
 * 文件能进 `unit` project 跑单测 —— 映射表改错了会被测出来。
 */

import type { MagnetErrorCode } from "./magnet-cutter-protocol";

/**
 * code → 文案表里的 key(相对 `Magnet` 命名空间)
 *
 * 摆出来的每一条都要**告诉用户下一步做什么**。
 */
export const MAGNET_ERROR_KEYS: Record<MagnetErrorCode, string> = {
  NOT_MANIFOLD: "errors.codes.notManifold",
  INVERTED_WINDING: "errors.codes.invertedWinding",
  EMPTY_MODEL: "errors.codes.emptyModel",
  BOOLEAN_FAILED: "errors.codes.booleanFailed",
  FACE_COUNT_COLLAPSED: "errors.codes.faceCountCollapsed",
  NOTHING_CUT: "errors.codes.nothingCut",
  VOLUME_UNCHANGED: "errors.codes.volumeUnchanged",
  HOLE_SPILLED: "errors.codes.holeSpilled",
  FACE_NOT_CUTTABLE: "errors.codes.faceNotCuttable",
  /**
   * 预料之外的错(Worker 崩了 / 超时了 / 某个 TypeError)
   *
   * 以前这些一律报成 `BOOLEAN_FAILED` —— 用户看到的是「布尔运算在这个模型上
   * 失败了」,但真因跟模型**没关系**。分开放,界面才能说对那句话。
   */
  UNEXPECTED: "errors.codes.unexpected",
};

/**
 * 这次失败对应哪句文案?
 *
 * 返回 `null` = 认不出来 → 调用方退回笼统那句。
 *
 * **真原因永远留在 console 里** —— 服务端的原始报错可能带着表结构这类
 * 内部信息,不该直接摆给访客。
 */
export function magnetErrorMessageKey(error: unknown): string | null {
  const code = extractMagnetErrorCode(error);
  if (!code) return null;
  return MAGNET_ERROR_KEYS[code] ?? null;
}

/** 从一个错里把 code 摘出来 —— Worker / 主线程两条路都带 code */
export function extractMagnetErrorCode(error: unknown): MagnetErrorCode | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    const code = (error as { code: string }).code;
    if (code in MAGNET_ERROR_KEYS) return code as MagnetErrorCode;
  }
  return null;
}
