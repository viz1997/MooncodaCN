/**
 * 打印工单建单**幂等** —— 判定层(纯函数)
 *
 * ## 要防的是哪一件事
 *
 * 「提交打印订单」这个按钮**没有**服务端幂等 —— 同一份请求发两次,就会建出
 * **两张工单**,两张工单各有各的付款入口 ⇒ **用户可能付两次钱**。
 *
 * 客户端那道软闸(提交中禁用按钮 + 限流 3 次/分钟)**挡不住**:
 *
 * - 用户在弹窗里点了提交,请求发出去了但**网络卡了**,他以为没提交,又点一次
 * - 用户双击 / 手抖点两下
 * - 用户提交完没看到跳转,又点一次
 *
 * ⇒ **服务端**必须自己认得出「这是同一份订单请求」。
 *
 * ## 键是**请求意图的内容哈希**(确定性键)
 *
 * 客户端**总是先上传模型再 POST** —— 每次上传都会产生**新的** `objectKey` /
 * `modelUrl`(服务端签发,带时间戳 + nanoid)。⇒ 任何含 `objectKey` 的哈希在
 * 重试时都会变 ⇒ **幂等直接失效**。
 *
 * ⇒ 键改成「**除了上传产物以外的一切**」的内容哈希:
 *
 * - 同一份意图 ⇒ 同一把键 ⇒ 第二次提交**直接返回第一次建的那张单**
 * - 跨页面刷新、跨设备、跨会话**都成立**(键不依赖任何客户端状态)
 * - 客户端**一个字都不用改**就能拿到幂等(服务端算)
 *
 * ## 键里放什么 / 不放什么 —— 每一条都有理由
 *
 * | 放 | 为什么 |
 * |---|---|
 * | 几何(体积 / 表面积 / 尺寸) | 换了模型就是另一单 |
 * | `supportWeightG` | 支撑克重**参与定价**(支撑加价的分段) |
 * | `selfSupportRatio` | **参与定价** —— 支撑加价按它分段。⚠️ 它不落库,但它改一分,价就不同 ⇒ 必须在键里 |
 * | `deliveryTier` | 加急费是**加价** —— 换档位就是另一个价 |
 * | `shippingOption` | 运费是**一笔钱** —— 换配送方式就是另一个价(2026-11-17) |
 * | `quantity` | 件数**乘进克重和钱** —— 印 3 件跟印 1 件是两个价(2026-11-17) |
 * | `couponCode` | 换码就是另一个应付金额 |
 * | `reliefKind` | 不参与定价,但它是**自洽性凭据**(托底档位变了就该是另一单) |
 * | 联系信息 / 备注 / 收货地址 id | 订单事实的一部分 |
 * | 模型文件名 / 字节数 | 同一个模型 |
 *
 * | 不放 | 为什么 |
 * |---|---|
 * | `objectKey` / `modelUrl` | **每次上传都变** —— 放了就幂等失效 |
 * | `channel`(付款方式) | 付款方式**不是「订的是什么」**。⚠️ 排除它才防得住「换通道重下 ⇒ 两张单 ⇒ 付两次」 |
 * | `locale` | 只影响邮件语言,不影响订单本身 |
 *
 * ## 数字必须**归一化**
 *
 * 客户端算出来的浮点数每次都一样,但**直接拿去哈希**是脆的 —— 只要有一丁点
 * 浮点差异(不同机器、不同累加顺序),键就变了 ⇒ 幂等失效。
 *
 * ⇒ 哈希前把数字按**落库精度**取整(`print_order` 表的列精度):
 *
 * | 字段 | 落库列 | 精度 |
 * |---|---|---|
 * | `volumeCM3` / `surfaceAreaCM2` | `numeric(12,4)` | 4 位 |
 * | `dims` / `supportWeightG` | `numeric(12,3)` | 3 位 |
 * | `selfSupportRatio` | **不落库** | 固定 6 位 |
 *
 * 归一化的**判据**:**键相同 ⇒ 落库的值完全相同**。
 *
 * ## ⚠️ 这个取舍:用户**故意**下两张一模一样的单,会被吞成一张
 *
 * 内容哈希的代价:两次提交**完全一样**的意图 ⇒ 第二次返回第一次那张单,
 * **不会**建出第二张。
 *
 * 这是**故意的** ——「一模一样」在钱的角度看就是同一单。而「同一模型打印多件」
 * 是**另一个需求**(要打三件,不是要下三单),那要靠**数量字段**解决
 * (数量进意图 ⇒ 键不同 ⇒ 两单)。
 *
 * ## 这一层是**纯函数**
 *
 * 不碰 DB、不碰网络 ⇒ 能进 vitest `unit` project 直接测(判定层先例:
 * `providers/alipay/reconcile-rules.ts` / `payments/lib/amount-guard.ts`)。
 *
 * ⚠️ 它 import 了 `node:crypto`(要算哈希)⇒ **不是零 import**。但它**不许**
 * import `@/db` / `drizzle-orm` —— 那些会把 DB 拖进单测。
 */

import { createHash } from "node:crypto";
import type { ReliefKind } from "@mooncoda/print-tool-core/pricing/relief-detect";
import {
  type DeliveryTierId,
  normalizeDeliveryTier,
} from "@mooncoda/print-tool-core/quote/delivery-tier";
import { normalizeQuantity } from "@mooncoda/print-tool-core/quote/quantity";
import {
  normalizeShippingOption,
  type ShippingOptionId,
} from "@mooncoda/print-tool-core/quote/shipping-option";
import { normalizeCouponCode } from "@/features/coupon/lib/coupon-calc";

/**
 * 意图的**版本号**
 *
 * 改了这个文件里「哪些字段进键」的规则 ⇒ 版本号 +1 ⇒ 旧键全部失效。
 *
 * ⚠️ 后果:升级之后,已经建过的单**再也命中不了**新键 ⇒ 用户重试会建出第二张
 * 单。⇒ **只在改了键的语义时才动它**;纯 bug 修复不动。
 *
 * **v2(2026-11-17)** —— 加了 `quantity` + `shippingOption` 两项(件数和配送
 * 方式都改钱)。⇒ 老单的键**命中不了**新键 —— 这是**故意的**:老单是「1 件 +
 * 顺丰到付」,跟新单不是同一份意图。
 */
const INTENT_VERSION = "print-order-intent-v2";

/** 体积 / 表面积:落库是 `numeric(12,4)` */
const SCALE_VOLUME = 4;
/** 尺寸:落库是 `numeric(12,3)` */
const SCALE_DIM = 3;
/** 支撑克重:落库是 `numeric(12,3)` */
const SCALE_WEIGHT = 3;
/** 自支撑比例:**不落库** —— 固定 6 位归一 */
const SCALE_RATIO = 6;

/**
 * 一份「下单意图」
 *
 * ⚠️ **故意不含** `objectKey` / `modelUrl` / `channel` / `locale` —— 见文件头。
 */
export type PrintOrderIntent = {
  /** 模型文件名(打包出来的 zip 名) */
  modelFileName: string;
  /** 模型字节数 */
  modelSizeBytes: number | null;
  /** 体积 cm³ */
  volumeCM3: number;
  /** 表面积 cm² */
  surfaceAreaCM2: number;
  /** 成品尺寸 mm */
  dims: readonly [number, number, number];
  /** 支撑克重 g */
  supportWeightG: number | null;
  /** 自支撑比例(支撑克重 ÷ 耗材克重)—— **参与定价** */
  selfSupportRatio: number | null;
  /** 交期档位 */
  deliveryTier: DeliveryTierId | null | undefined;
  /**
   * 打印件数(2026-11-17)
   *
   * ⚠️ **必须在键里** —— 件数乘进克重和钱(印 3 件 ≠ 印 1 件)。
   *
   * 认不出来 / 越界 ⇒ 一律当 1 件(跟引擎 `quantity.ts` 一个口径)⇒ 跟老单
   * 落在同一把键上。
   */
  quantity?: number | null;
  /**
   * 配送方式(2026-11-17)
   *
   * ⚠️ **必须在键里** —— 运费是一笔钱(¥0 / ¥18 / ¥22 三档)。
   *
   * 认不出来 ⇒ 顺丰到付(¥0),跟引擎 `shipping-option.ts` 一个口径。
   */
  shippingOption?: ShippingOptionId | null;
  /** 托底档位(浮雕 / 手办) */
  reliefKind: ReliefKind | null | undefined;
  /** 称呼 */
  contactName: string;
  /** 电话 */
  contactPhone: string | null;
  /** 留言 */
  note: string | null;
  /** 收货地址 id(内容由服务端从地址簿取) */
  addressId: string;
  /** 优惠码 */
  couponCode: string | null;
};

/**
 * 把一个数归一化成**固定精度的十进制字符串**
 *
 * 用 `toFixed` 而不是 `Math.round(x * 10^n) / 10^n` —— 后者有浮点误差
 * (`Math.ceil(1.1 * 100)` = 111 这种坑,见 `rounding.ts` 的文件头)。
 *
 * `toFixed` 走的是**十进制**舍入,跟 Postgres 的 `numeric` 落库口径**一致**
 * ⇒ 「键相同 ⇒ 落库的值完全相同」这条判据才站得住。
 */
function decimal(
  value: number | null | undefined,
  digits: number
): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  // 1e21 以上 `toFixed` 会吐指数记法 —— 几何字段不可能到那个量级,
  // 到了就说明数据坏了 ⇒ 当成「没有值」(不同值 ⇒ 不同键,不会误判成同一单)
  if (Math.abs(value) >= 1e21) return null;
  return value.toFixed(digits);
}

/**
 * 把意图**摊平成一段确定性的字符串**
 *
 * 用 `JSON.stringify` 而不是自己拼分隔符 —— 字段值里可能有 `|` / `,`
 * (用户的备注里什么都有),自己拼分隔符会撞。
 *
 * `JSON.stringify` 对**数组**是确定性的(键序就是数组顺序)⇒ 同一个意图永远
 * 摊出同一段字符串。
 */
export function canonicalPrintOrderIntent(intent: PrintOrderIntent): string {
  return JSON.stringify([
    "v",
    INTENT_VERSION,
    "file",
    intent.modelFileName.trim(),
    "size",
    intent.modelSizeBytes === null ? null : Math.trunc(intent.modelSizeBytes),
    "vol",
    decimal(intent.volumeCM3, SCALE_VOLUME),
    "area",
    decimal(intent.surfaceAreaCM2, SCALE_VOLUME),
    "dims",
    decimal(intent.dims[0], SCALE_DIM),
    decimal(intent.dims[1], SCALE_DIM),
    decimal(intent.dims[2], SCALE_DIM),
    "support",
    decimal(intent.supportWeightG, SCALE_WEIGHT),
    "ratio",
    decimal(intent.selfSupportRatio, SCALE_RATIO),
    // 认不出来的档位一律标准档(跟 `delivery-tier.ts` 一个口径)
    "tier",
    normalizeDeliveryTier(intent.deliveryTier),
    // 件数(2026-11-17)—— 认不出来 / 越界一律 1 件(跟引擎 `quantity.ts` 一个口径)
    "qty",
    normalizeQuantity(intent.quantity),
    // 配送方式(2026-11-17)—— 认不出来一律顺丰到付(¥0)
    "ship",
    normalizeShippingOption(intent.shippingOption),
    "relief",
    intent.reliefKind ?? null,
    "name",
    intent.contactName.trim(),
    "phone",
    (intent.contactPhone ?? "").trim(),
    "note",
    (intent.note ?? "").trim(),
    // 地址用 **id** —— 内容由服务端从地址簿取(归属校验在数据层)
    "addr",
    intent.addressId.trim(),
    // 码大写归一化 —— 用户输入不区分大小写
    "coupon",
    intent.couponCode === null ? "" : normalizeCouponCode(intent.couponCode),
  ]);
}

/**
 * 算一把幂等键
 *
 * @param intent 这一份下单意图(不含上传产物、不含付款通道)
 * @returns 64 位十六进制 sha256
 */
export function computePrintOrderIdempotencyKey(
  intent: PrintOrderIntent
): string {
  return createHash("sha256")
    .update(canonicalPrintOrderIntent(intent), "utf8")
    .digest("hex");
}
