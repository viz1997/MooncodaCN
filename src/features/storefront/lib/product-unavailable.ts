/**
 * 商品**下架** —— 加购 / 结算都要挡住的那道闸
 *
 * 纯文件(不碰 DB、不碰网络)⇒ 能进 vitest `unit` project。
 *
 * ## 为什么要有这道闸
 *
 * 工作室 2026-11-14 的要求:「电商产品获取后台配置管理好的产品」⇒ 后台
 * `/admin/products` 把某个型号**下架**,商城那一组设计就不该再卖。
 *
 * 但下架要挡**三处**,少一处就漏:
 *
 * | 位置 | 漏了会怎样 | 谁挡 |
 * |---|---|---|
 * | 目录 / 详情 / 相关推荐 | 下架的商品还摆在网格里 | `storefront-catalog.ts` |
 * | **加购** | 用户能往购物袋里塞一件下架的商品 | **本文件** |
 * | **结算** | 车里有下架的商品,那一单**照样结得掉** | **本文件** |
 *
 * ## 为什么是「拒」,不是「静默跳过那一行」
 *
 * 结算时把下架的那一行**悄悄跳过** ⇒ 用户看到的合计跟最后付的金额对不上
 * (用户以为买了三件,付款只有两件的钱)⇒ **逐分相等**当场破。
 *
 * ⇒ 两边都**拒**,并说清楚是哪一件下架了,让用户自己把那一行删掉。
 *
 * ## 「没有 DB 行 ⇒ 上架」
 *
 * 判定口径在 `isCatalogTypeActive()`(读失败 / 后台没播种过 ⇒ 一切按代码
 * 默认上架)。**不是**「DB 里没有就下架」—— 那会让工作室一改数据库就把整店
 * 变空店。
 */

import { isCatalogTypeActive } from "./catalog-apply";
import type { CatalogSource } from "./catalog-source-types";

/**
 * 错误码 —— 接口层靠它回 **409**
 *
 * 409 = 「这个状态跟现在的请求冲突」—— 下架的商品没法买。
 * 400(参数错)不对(参数没问题),500 更不对(不是服务器坏了)。
 */
export const PRODUCT_UNAVAILABLE_CODE = "PRODUCT_UNAVAILABLE";

/**
 * 说人话 —— **加购 / 结算用同一句**
 *
 * 商城这一整套交易界面是**中文硬编码**的(见 `cart-drawer.tsx` /
 * `cart-page-view.tsx` / `checkout-view.tsx` 的文件头)⇒ 这里跟着走,
 * 不另开一套 i18n。
 */
export function productUnavailableMessage(productTitle: string): string {
  return `「${productTitle}」已经下架了,不能购买`;
}

/**
 * 下架了 —— 加购那条路抛它
 *
 * 接口层(`POST /api/store/carts/[id]/line-items`)catch 它 ⇒ 回 409
 * `PRODUCT_UNAVAILABLE`。
 */
export class ProductUnavailableError extends Error {
  /** 机器可读的码 —— 跟 `PRODUCT_UNAVAILABLE_CODE` 同一个 */
  readonly code = PRODUCT_UNAVAILABLE_CODE;
  /** 是哪一件商品 */
  readonly productTitle: string;
  /** 它的型号 code(R / A / P / RM / LB / M) */
  readonly productTypeCode: string;

  constructor(productTitle: string, productTypeCode: string) {
    super(productUnavailableMessage(productTitle));
    this.name = "ProductUnavailableError";
    this.productTitle = productTitle;
    this.productTypeCode = productTypeCode;
  }
}

/**
 * 这个型号**在不在架上** —— 不在 ⇒ 抛 `ProductUnavailableError`
 *
 * 「没有 DB 行 ⇒ 上架」的口径在 `isCatalogTypeActive()` 里。
 */
export function assertCatalogTypeAvailable(params: {
  typeCode: string;
  productTitle: string;
  catalog: CatalogSource;
}): void {
  if (isCatalogTypeActive(params.typeCode, params.catalog)) return;
  throw new ProductUnavailableError(params.productTitle, params.typeCode);
}
