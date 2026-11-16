/**
 * 打印服务报价 —— **引擎侧**的共享类型
 *
 * 客户端(报价页)和服务端(报价 API / 下单 API)共用这一份定义,避免两边
 * 字段名对不上导致「页面显示的价」和「入库的价」不是同一个东西。
 *
 * ## 金额单位:一律「分」
 *
 * 跟 `product.basePriceCents` / `product_variant.priceCents` 保持一致。
 * 报价页要显示金额,下单要落库,两边都拿分,不用在边界上做单位换算。
 *
 * ## 形状/尺寸单位
 *
 *  - 体积 cm³
 *  - 表面积 cm²
 *  - 尺寸 mm(X=长 Y=宽 Z=高)
 *  - 克重 g
 *
 * ## 这里是**引擎**的部分
 *
 * 「工单」那几组类型(状态 / 收款状态 / 收款通道 / 下单入参 / 用户侧视图)
 * **不在这个包里** —— 它们绑着 `print_order` 表和 DB 的地址快照,是**服务端
 * 业务**的东西,跟「算几何、算克重、算价」没关系。留在应用侧。
 */

import type { ReliefKind } from "../pricing/relief-detect";
import type { DeliveryRates, DeliveryTierId } from "./delivery-tier";
import type { ShippingFees, ShippingOptionId } from "./shipping-option";

/**
 * 报价入参 —— 几何 + 支撑信息
 *
 * 几何是**客户端解析 + 用户尺寸调整之后**的结果(体积已经含缩放),
 * 服务端不重新解析模型,只按这组数算价。
 */
export type PrintQuoteInput = {
  /** 体积 cm³ */
  volumeCM3: number;
  /** 表面积 cm² */
  surfaceAreaCM2: number;
  /** 成品尺寸 mm:X=长 Y=宽 Z=高 */
  dims: [number, number, number];
  /** 智能摆盘算出的支撑克重 g;没跑摆盘是 null */
  supportWeightG?: number | null;
  /** 本体支撑比例(1 = 1:1);没跑摆盘是 null */
  selfSupportRatio?: number | null;
  /**
   * 交期档位(48 / 72 / 96 小时)—— 不传 = 标准档(不额外收费)
   *
   * 加价按**比例**收,比例见 `delivery-tier.ts`。
   */
  deliveryTier?: DeliveryTierId | null;
  /**
   * 托底档位 —— `relief`(浮雕,托底 1mm)/ `figurine`(手办,托底 5mm)
   *
   * 2026-11-15:工作室的原话「浮雕模型不需要像手办模型5mm底部支撑，只需要1mm支撑」。
   *
   * **这个字段是「自洽性」的凭据**,不是重算的依据 —— 服务端**不重新算支撑
   * 体积**(那在浏览器里算,几何不上传),它拿的是 `supportWeightG`。所以服务端
   * 用这个字段做的是**一道自洽性检查**:客户端报的档位跟服务端按 `dims`
   * 判定出来的那一档**对不上**吗?
   *
   * 只挡一个方向 —— 「报浮雕、但尺寸判定是手办」(托底低 ⇒ 支撑少 ⇒ 少收
   * 支撑费)。反过来(报手办、判成浮雕)是**多收**,放行。
   *
   * 不传 = 老客户端 ⇒ 按服务端自己判定的那一档走,不报错。
   */
  reliefKind?: ReliefKind | null;
  /**
   * 打印件数(2026-11-17)
   *
   * 工作室的原话:「同一模型打印多件」—— 同一个模型一次印多件,克重费 /
   * 后处理费 / 支撑加价都**按件**放大(见 `quantity.ts` 的文件头)。
   *
   * **运费不乘件数** —— 工作室的原话「运费按单收取」。
   *
   * 不传 = 1 件(老客户端)。越界 / 非法 ⇒ 引擎夹到合法范围;**接口层要
   * 拒绝**(夹取会静默少收钱)。
   */
  quantity?: number | null;
  /**
   * 配送方式(2026-11-17)
   *
   * 工作室的原话:「配送方式 运费按单收取 顺丰到付…顺丰标快 ¥18…顺丰空运
   * ¥22」。
   *
   * ⚠️ **跟 `deliveryTier`(交期档位)是两个正交的轴** —— 交期管「多快
   * 发货」,配送方式管「怎么寄、运费多少」。
   *
   * 不传 = 顺丰到付(运费 ¥0)。认不出来的值也落到顺丰到付。
   */
  shippingOption?: ShippingOptionId | null;
};

/**
 * 支撑加价的**一档**(2026-11-06)
 *
 * 工作室的规则:「模型支撑超过 1:1 的多的支撑按照 0.5 元一克,1:2 的多的
 * 支撑按照 1 元一克」。也就是超阈值的那部分**分两段**收:
 *
 * ```
 * r ≤ 1         不收钱
 * 1 < r ≤ 2     超出部分 × 第一档单价(0.5 元/g)
 * r > 2         再超出部分 × 第二档单价(1 元/g)
 * ```
 *
 * `r` = 本体支撑比例 = 支撑克重 ÷ 耗材克重。
 *
 * ## 单位:**分**
 *
 * 跟 `PrintQuote` 的其余金额字段一致 —— 引擎内部用「元」,转换只发生在
 * 这一层(`compute-quote.ts` 的 `computePrintQuote()`)。
 */
export type PrintSupportFeeBand = {
  /** 这一档的**下**界(比例)—— 第一档是阈值,后面是上一档的上界 */
  fromRatio: number;
  /** 这一档的**上**界(比例)—— 最后一档是 null(没有上限) */
  upToRatio: number | null;
  /** 这一档的单价 分/g */
  priceCentsPerGram: number;
  /** 这一档收钱的支撑克重 g(**整单**—— 已经乘过件数) */
  weightG: number;
  /** 这一档的钱 分(**整单**) */
  feeCents: number;
};

/**
 * 报价结果
 *
 * ## ⚠️ 这是一份**整单**的报价(2026-11-17)
 *
 * 「同一模型打印多件」之后,**克重和钱都是整单的**(件数已经乘进去了):
 *
 * - `materialWeightG` / `supportWeightG` / `excessSupportWeightG` —— **整单**克重
 * - `weightFeeCents` / `varnishFeeCents` / `supportFeeCents` —— **整单**的钱
 *
 * 理由:**界面上「克重」和「克重费」必须对得上** —— 一边是单件、一边是整单,
 * 用户会以为「8.3 g 却按 3 倍收」。乘件数这一步只发生在引擎里一次。
 *
 * (`quantity` 摆出来是为了让界面能写清楚「N 件」—— 客户端**不做乘法**。)
 *
 * ## `totalPriceCents` 恒等于**五项**费用之和
 *
 * 克重费 + 后处理费 + 支撑加价 + 交期加价 + **运费**。
 *
 * 各项**各自取整后再加**,不是先加后取整 —— 报价页上「明细加起来 = 合计」
 * 必须成立,否则用户会来问为什么差一块。
 */
export type PrintQuote = {
  /**
   * 打印件数(2026-11-17)
   *
   * 1 = 打印一件(老客户端、老工单都是这个值)。
   */
  quantity: number;
  /** 耗材克重 g(**整单**—— 已经乘过件数) */
  materialWeightG: number;
  /** 支撑克重 g(**整单**;没跑摆盘是 null) */
  supportWeightG: number | null;
  volumeCM3: number;
  surfaceAreaCM2: number;
  dims: [number, number, number];
  /** 材料密度 g/cm³ */
  density: number;
  /** 单价 分/g */
  unitPriceCentsPerGram: number;
  /** 克重费(分)= 克重 × 单价 × 件数 */
  weightFeeCents: number;
  /** 后处理费(分)= 单件后处理费 × 件数(2026-11-17) */
  varnishFeeCents: number;
  /** 支撑加价(分)—— 本体支撑比例超 1:1 的部分(× 件数) */
  supportFeeCents: number;
  /** 超出 1:1 阈值的支撑克重 g(**整单**) */
  excessSupportWeightG: number;
  /**
   * 支撑加价的**分段明细**(2026-11-06)
   *
   * 工作室的规则是分段的(1:1~1:2 一档,超 1:2 另一档),所以一笔支撑费
   * 不是一个数 —— 得能说清「哪一段按哪个价收的」。
   *
   * **各档 `feeCents` 之和恒等于 `supportFeeCents`** —— 明细加起来必须
   * 等于合计(取整的差额由最后一档吸收),否则用户会看到「8.3 g × ¥0.50/g
   * + 4.2 g × ¥1.00/g」跟「支撑加价 ¥6.60」对不上。
   *
   * 支撑加价关掉时是空数组(不是 null)—— 界面直接 `.map()` 就行。
   */
  supportFeeBands: PrintSupportFeeBand[];
  /**
   * 交期加价(分)—— 按小计的**比例**收(见 `delivery-tier.ts`)
   *
   * 标准档是 0;加价只跟「多快发货」有关,跟模型本身无关。
   */
  deliveryFeeCents: number;
  /** 这单选的交期档位 */
  deliveryTier: DeliveryTierId;
  /** 这档承诺的交期(小时) */
  deliveryHours: number;
  /**
   * 本次报价用的加价比例 —— 服务端带回来的
   *
   * 前端拿它把**三档**的价都显示出来(「48 小时 +¥20.65」)。前端不自己认
   * 一份比例:服务端的比例可以用环境变量改,两边各认一份就会出现「页面写
   * +$3.00、实际收 $2.98」。
   */
  deliveryRates: DeliveryRates;
  /**
   * 配送方式(2026-11-17)
   *
   * 这单走哪一档寄 —— 顺丰到付 / 顺丰标快 / 顺丰空运。
   *
   * ⚠️ **跟 `deliveryTier`(交期档位)是两个正交的轴**。
   */
  shippingOption: ShippingOptionId;
  /**
   * 运费(分)—— **按单收**,不乘件数
   *
   * 工作室的原话「配送方式 运费按单收取」。
   */
  shippingFeeCents: number;
  /**
   * 各档运费(分)—— 服务端带回来的
   *
   * 前端拿它把**三档**的价都显示出来(「顺丰标快 ¥18 / 顺丰空运 ¥22」)。
   * 前端不自己认一份价:后台能改运费,两边各认一份就会出现「页面写 ¥18、
   * 实际收 ¥0」。
   */
  shippingFees: ShippingFees;
  /**
   * 合计(分)= 克重费 + 后处理费 + 支撑加价 + 交期加价 + 运费
   *
   * **五项之和**,各自取整后再加。
   */
  totalPriceCents: number;
};

/**
 * 报价的**对外形状** —— 跟 `PrintQuote` 的区别只有一个:**没有单价**
 *
 * 工作室 2026-11-16 的要求:**「不要展示 4.5 元/g 这种单价,避免暴露我们的
 * 成本」**。
 *
 * `PrintQuote` 是**内部**形状 —— 它带着:
 *
 * - `unitPriceCentsPerGram` —— 每克单价(450 = ¥4.50/g)
 * - `supportFeeBands[]` —— 支撑分段明细,**每一档都带单价**(¥0.50/g / ¥1.00/g)
 * - `excessSupportWeightG` —— 超出 1:1 阈值的支撑克重
 *
 * 那三个都是**工作室的成本 / 定价口径**。内部要留着(后台要显示、留档要记、
 * 工单上要能对账),但**凡是发给浏览器的报价,一个字节都不许出去**。
 *
 * ⇒ 对外一律用 `PublicPrintQuote`,转换见应用侧的 `quote-public.ts`。
 *
 * ## 界面上摆的是「克重」和「那笔费用」,不是「单价」
 *
 * 收据的样子是「克重费 ¥12.34」,不是「12.34 元 ÷ 8.3 g = ¥1.49/g」。
 */
export type PublicPrintQuote = Omit<
  PrintQuote,
  "unitPriceCentsPerGram" | "supportFeeBands" | "excessSupportWeightG"
>;
