/**
 * 购物车的两种「性质」—— **纯文件**
 *
 * ## 为什么车要分两种
 *
 * 2026-11-06 起,打印服务**不再走商城购物袋**:
 *
 * - **商城购物袋**(`kind = "storefront"`)—— 只放目录商品(钥匙扣 / 手办 / 冰箱贴…)
 * - **打印单**(`kind = "print"`)—— 只放打印服务(用户自带 3D 模型,按克重计价)
 *
 * 两者是**两张表里的两张车**(同一张 `cart` 表,靠 `kind` 区分),两个 cookie,
 * 两套金额口径(商城有 ¥99 免运费,打印单没有 —— 打印服务的价就是报价本身,
 * 见 `print-quote/lib/payment.ts`:工单的支付金额恒等于 `total_price_cents`)。
 *
 * 工作室的说法:**「模型打印是不走商城正常的购物车的,而是走打印下单」**。
 *
 * ## 判定在**数据层**,不在界面层
 *
 * 「这一行能不能放进这张车」写在 `cart-store.ts` 的 `addLineItem()` 里 ——
 * 绕过界面的直接调 API 也进不去。界面层只是**显示**这个规则的结果。
 *
 * ## 这个文件为什么是纯的
 *
 * 客户端组件(购物袋页 / 抽屉 / 打印单页)和服务端(购物车存储 / 结算)都要读
 * 同一份判定 —— 两边各写一遍,迟早漂移(前端放行了、后端拒了,或者反过来)。
 * 所以这里**不 import 任何服务端模块**。
 */

import type { CartLineItemMetadata } from "../types";

import { getPrintServiceSpec } from "./print-service";

/**
 * 车的性质
 *
 * - `storefront` —— 商城购物袋
 * - `print` —— 打印单
 */
export type CartKind = "storefront" | "print";

/** 商城购物袋 */
export const STOREFRONT_CART_KIND: CartKind = "storefront";

/** 打印单 */
export const PRINT_CART_KIND: CartKind = "print";

/** 所有性质 —— 给「遍历所有车」的场合用 */
export const CART_KINDS: readonly CartKind[] = [
  STOREFRONT_CART_KIND,
  PRINT_CART_KIND,
];

/**
 * 把任意输入收敛成合法的性质
 *
 * DB 里这一列是 text(不是 PG enum)—— 认不出来的一律当**商城购物袋**。
 *
 * 为什么兜底是商城购物袋,不是打印单:
 *
 * - 2026-11-06 之前建的车没有这一列(默认 `'storefront'`),那时的车装的
 *   都是目录商品 —— 兜底成商城购物袋跟它当时的事实**一致**。
 * - 反过来兜底成打印单的话,那些老车里的目录商品行会**全部被滤掉**
 *   (打印单里不许有目录商品)—— 用户的购物袋会凭空消失。
 *
 * 打印单永远是代码显式写进去的 `'print'`,走不到这个兜底。
 */
export function normalizeCartKind(value: unknown): CartKind {
  return value === PRINT_CART_KIND ? PRINT_CART_KIND : STOREFRONT_CART_KIND;
}

/**
 * 这一行属于哪张车
 *
 * 判据是「有没有 printSpec」—— 不是 productId(见 `print-service.ts` 的文件头:
 * 判 productId 的话,任何一个拼错都会把打印服务行当成普通商品行)。
 */
export function cartKindForLine(
  metadata: CartLineItemMetadata | null | undefined
): CartKind {
  return getPrintServiceSpec(metadata) ? PRINT_CART_KIND : STOREFRONT_CART_KIND;
}

/**
 * 这一行能不能放进这张车
 *
 * 真正的关卡在 `cart-store.ts` 的 `addLineItem()` —— 这里是同一份判定的
 * 纯函数版本,给界面层用(「这一行放错了车」要能在界面上说清楚)。
 */
export function isLineAllowedInCart(
  kind: CartKind,
  metadata: CartLineItemMetadata | null | undefined
): boolean {
  return cartKindForLine(metadata) === kind;
}

/**
 * 放错车时给用户看的话
 *
 * 放得进去返回 null。
 */
export function describeCartKindMismatch(
  kind: CartKind,
  metadata: CartLineItemMetadata | null | undefined
): string | null {
  if (isLineAllowedInCart(kind, metadata)) return null;
  return kind === STOREFRONT_CART_KIND
    ? "打印服务不走商城购物袋,请到「打印单」页面下单"
    : "打印单里只能放打印服务(自带模型按克重计价)";
}

/**
 * 放错车 —— 抛这个错
 *
 * 数据层抛,路由层翻译成 400 并把 `message` 带给用户。
 *
 * 之所以是**专门的错误类型**而不是普通 `Error`:路由要能分辨「用户放错了车」
 * (400,话术要指路)和「真的出错了」(500)。用普通 Error 的话,只能靠匹配
 * 错误消息的字符串 —— 那是最脆的一种判别方式。
 */
export class CartKindMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CartKindMismatchError";
  }
}

/**
 * 放错车时抛错 —— 放得进去就什么都不做
 *
 * 判定和话术只有这一份(`describeCartKindMismatch`),别在别处再写一遍。
 */
export function assertLineAllowedInCart(
  kind: CartKind,
  metadata: CartLineItemMetadata | null | undefined
): void {
  const problem = describeCartKindMismatch(kind, metadata);
  if (problem) throw new CartKindMismatchError(problem);
}
