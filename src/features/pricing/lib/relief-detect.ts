/**
 * 浮雕 / 手办 —— **托底高度分两档**(2026-11-15)
 *
 * 工作室的原话:
 *
 * > 「克重工具中浮雕模型不需要像手办模型5mm底部支撑,只需要1mm支撑」
 *
 * ## 托底是什么
 *
 * 打印机在平台上先长一层支撑把模型托起来(默认 5mm,`SUPPORT_LIFT_MM`),
 * 模型悬在托底上,不直接贴平台。那 5mm **是算进支撑体积的**(占地 × 5mm),
 * 也就是**算进支撑克重**、**算进支撑加价**。
 *
 * 浮雕(徽章 / 冰箱贴 / 浮雕钥匙扣)背面是**平的** —— 1mm 就够;
 * 手办要 5mm 是因为脚底那点接触面撑不住,托底块得厚一点。
 *
 * ## 判定规则(纯几何)
 *
 * 把成品尺寸按从小到大排:`t0 ≤ t1 ≤ t2`。
 *
 * ```
 * 浮雕 ⇔ t0 > 0 且 t0 ≤ 10mm 且 t0 ≤ 0.5 × t1
 * ```
 *
 * - **10mm** —— 浮雕徽章 / 冰箱贴的常见厚度。超过这个厚度一般就是手办。
 * - **0.5 × t1** —— 「薄片」的形状判据:最小边得比第二小边薄一半以上。
 *   这一条挡住「薄但小」的方块(20×20×8 那个比例还算浮雕,8×8×4 那种
 *   迷你件也是)—— 说到底是**形状**:扁平的板 ⇒ 浮雕。
 * - **用最大边不用最小边** 判单位那一套(见 `model-units.ts`)是另一件事,
 *   这里判的是**形状**,跟模型单位无关(尺寸已经归一化到毫米了)。
 *
 * ## 退化输入一律当手办
 *
 * 某一轴是 0 / NaN / Infinity ⇒ **判成手办**。
 *
 * 理由是**钱的方向**:托底越高 ⇒ 支撑体积越大 ⇒ 支撑费越高。
 * 判不出来时取**贵的那一档**,绝不会因为一个坏数字少收钱。
 *
 * ## 纯函数,零依赖
 *
 * 不引 `@/db`、不引 `server-only` ⇒ 浏览器 bundle 和服务端路由都能 import,
 * 也能进 vitest `unit` project 跑单测
 * (`src/test/pricing/pure/relief-detect.test.ts`)。
 */

/**
 * 模型属于哪一档
 *
 * - `relief` —— 浮雕(扁平板状)⇒ 托底 1mm
 * - `figurine` —— 手办 ⇒ 托底 5mm
 */
export type ReliefKind = "relief" | "figurine";

/**
 * 用户能选的模式
 *
 * - `auto` —— 按几何自动判定(默认)
 * - `relief` / `figurine` —— 用户手动指定
 */
export type ReliefMode = "auto" | ReliefKind;

/**
 * 浮雕的最大厚度 mm
 *
 * 超过这个厚度一般就是手办(或者用户没把模型摆平)。
 */
export const RELIEF_MAX_THICKNESS_MM = 10;

/**
 * 浮雕的形状判据:最小边 ≤ 第二小边 × 这个比例
 *
 * 「扁平板」才算浮雕 —— 立方体、薄条不在这条线上。
 */
export const RELIEF_THINNESS_RATIO = 0.5;

/**
 * 判定:这个尺寸是浮雕还是手办
 *
 * @param dims 成品尺寸 mm `[x, y, z]`(任意顺序,内部会排)
 * @returns `relief` / `figurine` —— 退化输入一律 `figurine`(钱的方向)
 */
export function detectReliefKind(
  dims: readonly number[] | null | undefined
): ReliefKind {
  if (!dims || dims.length < 3) return "figurine";
  const x = dims[0];
  const y = dims[1];
  const z = dims[2];
  if (x === undefined || y === undefined || z === undefined) return "figurine";
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return "figurine";
  }
  if (x <= 0 || y <= 0 || z <= 0) return "figurine";

  const sorted = [x, y, z].sort((a, b) => a - b);
  const t0 = sorted[0];
  const t1 = sorted[1];
  if (t0 === undefined || t1 === undefined) return "figurine";

  if (t0 > RELIEF_MAX_THICKNESS_MM) return "figurine";
  if (t0 > RELIEF_THINNESS_RATIO * t1) return "figurine";
  return "relief";
}

/**
 * 生效的档位 —— 模式 + 尺寸
 *
 * `auto` ⇒ 按几何判定;用户指定了 ⇒ **只在不越界的时候**才用用户指定的那档。
 *
 * ## 为什么手动指定也要看几何
 *
 * 托底低 ⇒ 支撑体积小 ⇒ **支撑费低**。「手动挑浮雕」就是「手动少付钱」的那
 * 个旋钮 —— 所以**手动只能往更保守的方向走**:
 *
 * - 手动挑「浮雕」,几何判定也是浮雕 ⇒ 用浮雕(1mm 托底)✓
 * - 手动挑「浮雕」,几何判定是手办 ⇒ **退化到手办**(5mm 托底)——
 *   宁可多收,不可少收。服务端那道闸(`checkReliefTier`)也只挡这一个方向。
 * - 手动挑「手办」⇒ 一律手办(不管几何像不像)—— 那一档是**保守**的方向,
 *   客户多付,不会算错。
 */
export function resolveReliefKind(
  mode: ReliefMode | null | undefined,
  dims: readonly number[] | null | undefined
): ReliefKind {
  const detected = detectReliefKind(dims);
  if (mode === "figurine") return "figurine";
  if (mode === "relief") return detected === "relief" ? "relief" : "figurine";
  return detected;
}

/**
 * 两档托底高度
 */
export type ReliefLifts = {
  /** 手办那档(默认 5mm) */
  figurineLiftMm: number;
  /** 浮雕那档(默认 1mm) */
  reliefLiftMm: number;
};

/**
 * 这一档该用多少托底高度
 */
export function reliefLiftMm(kind: ReliefKind, lifts: ReliefLifts): number {
  return kind === "relief" ? lifts.reliefLiftMm : lifts.figurineLiftMm;
}

/**
 * 服务端的那道闸 —— 客户端报的档位对不对
 *
 * ## 为什么只挡一个方向
 *
 * 托底越低 ⇒ 支撑越少 ⇒ 支撑费越低。所以只有**「客户端报浮雕、但服务端
 * 按尺寸判定是手办」**这一个方向是**少收钱**的风险 ⇒ 挡它。
 *
 * 反过来(客户端报手办、服务端判成浮雕)—— 客户**多付**钱,收了也不亏,
 * 放行(客户自己选的那档托底算出来更保守,不会算错)。
 *
 * ## 没报档位怎么办
 *
 * 老客户端 / 老工单不带这个字段 ⇒ 按服务端自己判的来(缺省就是服务端
 * 那一档),不报错。
 */
export type ReliefTierCheck =
  | { ok: true; kind: ReliefKind }
  | { ok: false; kind: ReliefKind };

/**
 * 服务端判定:客户端报的档位能不能用
 *
 * @param dims 客户端报上来的成品尺寸 mm
 * @param declared 客户端报上来的档位(null / undefined = 没报)
 * @returns `ok: false` 时 `kind` 是**服务端认定的那一档** —— 客户端照着
 *   它重算一遍再来
 */
export function checkReliefTier(
  dims: readonly number[] | null | undefined,
  declared: ReliefKind | null | undefined
): ReliefTierCheck {
  const detected = detectReliefKind(dims);
  if (declared === "relief" && detected === "figurine") {
    return { ok: false, kind: detected };
  }
  return { ok: true, kind: declared ?? detected };
}
