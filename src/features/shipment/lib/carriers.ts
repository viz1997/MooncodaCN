/**
 * 快递公司清单 + 运单号归一化
 *
 * ## 为什么存 **code** 而不是显示名
 *
 * 两个语言站要显示同一个品牌名才好(「顺丰速运」/「SF Express」走 i18n),
 * 而且同一家快递不会在库里裂成「顺丰」「顺丰速运」两种写法 ——
 * 那会让「查这个快递公司的单子」永远查不全。
 *
 * 所以库里存 `code`,显示名走 `nameKey` 查 i18n。
 *
 * 这个文件是**纯函数**:不 import db / React / next,可以直接跑单测。
 */

/**
 * 快递公司清单
 *
 * 工作室实际只用顺丰等几家 —— 清单按「常见程度」排,`other` 收尾兜底。
 *
 * `nameKey` 是**相对 `Shipment` 命名空间的 i18n 键**(不是绝对路径)——
 * 消费方一律 `useTranslations("Shipment")` 然后 `t(carrier.nameKey)`。
 *
 * ⚠️ **别写成绝对路径**(`Shipment.carriers.sf`)—— 命名空间化的 `t` 会去找
 * `Shipment.Shipment.carriers.sf`,查不到。仓库里 `MaterialPricing` 的
 * `products.pet.name` 就是这个套路。
 */
export const SHIPMENT_CARRIERS = [
  { code: "sf", nameKey: "carriers.sf" }, // 顺丰速运
  { code: "jd", nameKey: "carriers.jd" }, // 京东物流
  { code: "zto", nameKey: "carriers.zto" }, // 中通快递
  { code: "yto", nameKey: "carriers.yto" }, // 圆通速递
  { code: "sto", nameKey: "carriers.sto" }, // 申通快递
  { code: "yunda", nameKey: "carriers.yunda" }, // 韵达速递
  { code: "ems", nameKey: "carriers.ems" }, // 中国邮政 EMS
  { code: "post", nameKey: "carriers.post" }, // 中国邮政
  { code: "jtsd", nameKey: "carriers.jtsd" }, // 极兔速递
  { code: "deppon", nameKey: "carriers.deppon" }, // 德邦快递
  { code: "other", nameKey: "carriers.other" }, // 其它(自己填名字)
] as const;

/** 快递公司代码 */
export type ShipmentCarrierCode = (typeof SHIPMENT_CARRIERS)[number]["code"];

/** 「其它」那个 code —— 选了它必须自己填公司名 */
export const OTHER_CARRIER_CODE = "other" as const;

/** 判断一个字符串是不是清单里的 code */
export function isShipmentCarrierCode(v: string): v is ShipmentCarrierCode {
  return SHIPMENT_CARRIERS.some((carrier) => carrier.code === v);
}

/** 按 code 取清单里那一条(认不出来返 null) */
export function getShipmentCarrier(
  code: string
): (typeof SHIPMENT_CARRIERS)[number] | null {
  return SHIPMENT_CARRIERS.find((carrier) => carrier.code === code) ?? null;
}

/** 全角 ASCII 的起止码点(U+FF01–U+FF5E) */
const FULLWIDTH_START = 0xff01;
const FULLWIDTH_END = 0xff5e;
/** 全角 ASCII 跟半角的码点差 */
const FULLWIDTH_OFFSET = 0xfee0;
/** 表意空格(U+3000)—— 中文输入法打出来的空格 */
const IDEOGRAPHIC_SPACE = 0x3000;

/**
 * 运单号归一化 —— **入库前必过**
 *
 * 三步,顺序不能换:
 *
 * 1. **全角 → 半角** —— 手机输入法打出来的单号常是全角
 * 2. **去所有空白** —— 快递员报号时中间常有空格
 * 3. **转大写** —— 运单号的字母数字不区分大小写,统一大写少一类对不上的扯皮
 */
export function normalizeTrackingNumber(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= FULLWIDTH_START && code <= FULLWIDTH_END) {
      // 全角 → 半角
      out += String.fromCharCode(code - FULLWIDTH_OFFSET);
    } else if (code === IDEOGRAPHIC_SPACE) {
      // 表意空格按普通空格处理(下一步一起去掉)
      out += " ";
    } else {
      out += ch;
    }
  }
  return out.replace(/\s+/g, "").toUpperCase();
}

/**
 * 「其它」快递的公司名 —— 归一化
 *
 * 去掉首尾空白、把中间的连续空白压成一个空格;空了就返 `null`
 * (调用方据此报 `INVALID_INPUT`)。
 */
export function normalizeShippingCompanyLabel(value: string): string | null {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 快递公司的**显示名**
 *
 * - 清单里的(除了「其它」)→ 走 i18n(两个语言站显示不同的品牌名)
 * - 「其它」→ 用工作室自己填的名字
 * - 认不出来的 code → 先用工作室填的名字,再不行就显示 code 本身
 *
 * ## 为什么把 `translate` 传进来
 *
 * 这个函数**不碰 i18n** —— 它只算「该显示什么」,文案由调用方查
 * `t()`。这样它能进 vitest `unit` project 跑单测(不需要 i18n 的运行时),
 * 后台和买家侧也共用同一份判定。
 */
export function resolveShipmentCarrierLabel(params: {
  code: string;
  /** 工作室自己填的名字(code = `other` 时才有值) */
  customLabel: string | null;
  /** 查 i18n —— 把 `t` 传进来 */
  translate: (key: string) => string;
}): string {
  const custom = params.customLabel?.trim() ?? "";
  const carrier = getShipmentCarrier(params.code);

  if (!carrier) {
    // 清单里没有的 code(老数据 / 手工改库)—— 有自己填的名字就用它
    return custom.length > 0 ? custom : params.code;
  }
  if (carrier.code === OTHER_CARRIER_CODE) {
    return custom.length > 0 ? custom : params.translate(carrier.nameKey);
  }
  return params.translate(carrier.nameKey);
}
