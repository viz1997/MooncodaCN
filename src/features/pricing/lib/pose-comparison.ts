/**
 * 初始角度 vs 当前姿态 —— 支撑克重对比
 *
 * 支撑克重永远跟「当前尺寸 + 当前姿态」走。没跑智能摆盘时
 * 当前姿态就是**初始角度 (0°,0°)**;跑完摆盘 / 手动微调后是新的姿态。
 *
 * 摆盘结果里要同时摆出两个克重:
 *  - 初始角度的支撑克重(`originalWeight`)—— 只跟尺寸 / 材料密度有关,
 *    跟当前角度无关,所以算一次缓存着;
 *  - 当前姿态的支撑克重(`totalSupportWeight`)。
 *
 * 「省 X%」是这两个数的比值 —— 省得不多(<1%)时不显示徽标(省 0% 没意义),
 * 但两个数字一直摆出来。
 */

/**
 * 摆盘省了多少支撑(%)—— 0~100 的整数
 *
 * @param initialWeightG 初始角度 (0°,0°) 的支撑克重
 * @param currentWeightG 当前姿态的支撑克重
 *
 * 省不出(当前姿态没有支撑、或者初始角度的数还没算出来)时返回 0。
 */
export function poseSavingPct(
  initialWeightG: number | undefined,
  currentWeightG: number
): number {
  if (
    initialWeightG === undefined ||
    !Number.isFinite(initialWeightG) ||
    !Number.isFinite(currentWeightG) ||
    currentWeightG <= 0 ||
    initialWeightG <= 0
  ) {
    return 0;
  }
  const ratio = initialWeightG / currentWeightG;
  if (ratio <= 1) return 0;
  return Math.max(0, Math.min(100, 100 - Math.round(100 / ratio)));
}

/**
 * 摆盘结果的对比行:初始角度 vs 当前姿态
 *
 * @param initialWeightG 初始角度 (0°,0°) 的支撑克重
 * @param currentWeightG 当前姿态的支撑克重
 */
export function comparePoseSupport(
  initialWeightG: number | undefined,
  currentWeightG: number
): {
  /** 初始角度的支撑克重(没有就 null —— 那一行不显示) */
  initialWeightG: number | null;
  /** 当前姿态的支撑克重 */
  currentWeightG: number;
  /** 省了多少(%)—— 省得不多时是 0 */
  savingPct: number;
} {
  return {
    initialWeightG:
      initialWeightG !== undefined && Number.isFinite(initialWeightG)
        ? initialWeightG
        : null,
    currentWeightG,
    savingPct: poseSavingPct(initialWeightG, currentWeightG),
  };
}

/**
 * 当前姿态的描述 —— 用来给支撑克重标个「这个数是哪个姿态的」
 *
 * ⚠️ 别拿「跑没跑过智能摆盘」来判断是不是初始角度:用户手动拖了 X/Y 滑块
 * 之后姿态已经不是 (0°,0°,0°) 了,但摆盘结果还是空的 —— 那样标出来会
 * 把当前姿态的支撑克重说成「初始角度」的,数字和标签对不上。
 *
 * 只看姿态本身:三个角都是 0 才是初始角度。
 */
export function describePose(
  rotX: number,
  rotY: number,
  rotZ: number
): {
  /** 是不是初始角度(0°,0°,0°) */
  isInitial: boolean;
  x: number;
  y: number;
  z: number;
} {
  return {
    isInitial: rotX === 0 && rotY === 0 && rotZ === 0,
    x: rotX,
    y: rotY,
    z: rotZ,
  };
}

/**
 * 克重栏的三个数
 *
 * 「总克重 = 耗材克重 + 支撑克重」是页面上写着的口径(也是报价的口径),
 * 所以**显示出来的三个数必须能对上** —— 用户拿计算器一加就知道对不对。
 *
 * 两个分项各自向上取整(0.4 g 也显示 1 g,别显示 0 g —— 看着像没算),
 * 总克重用**两个显示值相加**,而不是 `ceil(耗材 + 支撑)`:
 * 后者会出现「43 + 53 = 96,总克重却写 95」这种对不上的情况。
 *
 * @param materialWeightG 耗材克重(未取整)
 * @param supportWeightG 支撑克重(未取整)
 */
export function weightPanelNumbers(
  materialWeightG: number,
  supportWeightG: number
): {
  /** 耗材克重 */
  material: number;
  /** 支撑克重 */
  support: number;
  /** 总克重 —— 恒等于 material + support */
  total: number;
} {
  const material = Math.ceil(materialWeightG);
  const support = Math.ceil(supportWeightG);
  return { material, support, total: material + support };
}
