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
   * 切割超时 —— **模型太重,浏览器算不完**
   *
   * ⚠️ 这跟模型**有关**(不是「不是模型的问题」!)—— AI 生成的模型动辄
   * 几十万面,EXACT 布尔运算要好几分钟,甚至根本算不完。
   */
  WORKER_TIMEOUT: "errors.codes.workerTimeout",
  /**
   * 切割引擎崩了 —— Worker 整个没了
   *
   * 常见于几何太复杂(自相交 / 面数太大),引擎算到一半炸了。
   */
  WORKER_CRASHED: "errors.codes.workerCrashed",
  /**
   * Worker 压根起不来(浏览器不支持 / 没产出 worker chunk)
   *
   * 已经退回主线程算了 —— 还是没成。
   */
  WORKER_UNAVAILABLE: "errors.codes.workerUnavailable",
  /**
   * 引擎那一步抛了个预料之外的错(建网格 / 切刀摆放 / 取结果)
   *
   * **带原始信息** —— 工作室要能一眼看出是哪一步炸的。
   */
  ENGINE_FAILED: "errors.codes.engineFailed",
  /**
   * 切割引擎(wasm)没加载出来 —— **不是模型的问题**
   *
   * `manifold.wasm` 那个文件没拿到(404 / 被 locale 前缀劫持 / URL 解不出来)。
   * 详情里带原始报错。
   */
  ENGINE_LOAD_FAILED: "errors.codes.engineLoadFailed",
  /**
   * 预料之外的错(不在上面那几种之列的)
   *
   * 以前所有非 `MagnetCutterError` 的抛出都一律报成 `BOOLEAN_FAILED` ——
   * 用户看到的是「布尔运算在这个模型上失败了」,但真因(Worker 崩了 /
   * 超时了 / 某个 TypeError)全被吞了。分开放,界面才能说对那句话。
   */
  UNEXPECTED: "errors.codes.unexpected",
  /**
   * 本地 Blender 连不上 —— 插件没起 / 端口不对
   *
   * **不是模型的问题** —— 是「本地那条路还没准备好」。
   */
  BLENDER_NOT_RUNNING: "errors.codes.blenderNotRunning",
  /**
   * 本地 Blender 那边切失败了(它自己报的)
   *
   * 原因(面太薄 / 孔切到边上 / 布尔失败)在详情里。
   */
  BLENDER_FAILED: "errors.codes.blenderFailed",
  /** 本地 Blender 那边超时了 */
  BLENDER_TIMEOUT: "errors.codes.blenderTimeout",
  /** 本地 Blender 回的不是预期的东西 —— 插件版本对不上 */
  BLENDER_BAD_RESPONSE: "errors.codes.blenderBadResponse",
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
