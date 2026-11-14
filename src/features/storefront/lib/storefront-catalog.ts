/**
 * 商城目录 —— **价**和**后台配置**拼在一起的那一层(服务端专用)
 *
 * ## 这个文件干什么
 *
 * 工作室 2026-11-14 的要求:「电商产品获取后台配置管理好的产品」。
 *
 * ⇒ 商城的商品目录要**跟着后台走**:
 *
 * - 某个型号**下架** ⇒ 那几件设计从商城消失
 * - 改了**型号名** ⇒ 商品页上的型号标签跟着改
 * - 改了**排序** ⇒ 商城网格里的先后跟着改
 * - 改了**价** ⇒ 跟着改(2026-11-08 就接上了)
 *
 * ## 三层分工
 *
 * | 层 | 文件 | 干什么 |
 * |---|---|---|
 * | **读** | `price-source.ts` | 一次 DB 读 ⇒ `PriceSource`(价)+ `CatalogSource`(目录配置) |
 * | **算** | `catalog-apply.ts` | 纯函数:上架判定 / 盖名字 / 排序 |
 * | **拼** | **本文件** | 把上面两样拼成「商城能直接用」的商品列表 |
 *
 * ## ⚠️ 客户端组件不许 import 本文件
 *
 * 它 import 了 `price-source.ts`(那个 import `@/db`)⇒ 被客户端组件 import
 * 会在构建期炸。价和目录配置**从服务端父组件当 props 传下去**。
 *
 * ## 下架的语义:「这一件商品不见了」
 *
 * 下架是**型号级**的(后台管的是 6 个型号,商城卖的是 12 件设计)⇒
 * 某个型号下架,那一组设计**全部**下架。
 *
 * - **目录 / 详情 / 相关推荐** —— 下架的那几件不出现
 * - **加购** —— 直接拒(不能往购物袋里塞一件已经下架的商品)
 * - **结算** —— 直接拒(车里有下架的商品 ⇒ 这一单结不了)
 *
 * 后面两条在 `cart-store.ts` / `checkout.ts` 里,不在本文件 —— 那边是
 * **收钱 / 改数据**的链路,闸门要开在写之前。
 */

import type { StorefrontProduct } from "../types";
import {
  applyCatalogConfig,
  isCatalogTypeActive,
  sortCatalogItems,
} from "./catalog-apply";
import type { CatalogSource } from "./catalog-source-types";
import {
  findProductByHandle,
  findRelatedProducts,
  MOCK_PRODUCTS,
} from "./mock-catalog";
import {
  applyPriceSource,
  getCatalogSource,
  getPriceSource,
} from "./price-source";

/* -------------------------------------------------------------------------- */
/*  内部                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 目录里的两样东西:价 + 后台配置
 *
 * ⚠️ **两份来源共用同一次 DB 读**(`price-source.ts` 的 `readStorefrontSource()`
 * 是 `cache()` 包的)⇒ 一个请求只查一次库,这里两次 `await` 也只查一次。
 */
interface ResolvedCatalog {
  readonly price: Awaited<ReturnType<typeof getPriceSource>>;
  readonly catalog: CatalogSource;
}

async function resolveCatalog(): Promise<ResolvedCatalog> {
  const [price, catalog] = await Promise.all([
    getPriceSource(),
    getCatalogSource(),
  ]);
  return { price, catalog };
}

/** 把价和配置**都**盖到一件设计上 */
function decorate(
  item: StorefrontProduct,
  resolved: ResolvedCatalog
): StorefrontProduct {
  return applyCatalogConfig(
    applyPriceSource(item, resolved.price),
    resolved.catalog
  );
}

/** 在架上的那些(按后台的排序排好) */
function activeItems(catalog: CatalogSource): StorefrontProduct[] {
  return sortCatalogItems(
    MOCK_PRODUCTS.filter((item) =>
      isCatalogTypeActive(item.productTypeCode, catalog)
    ),
    catalog
  );
}

/* -------------------------------------------------------------------------- */
/*  对外                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 商城目录 —— **服务端专用**
 *
 * 顺序 = **系列之间**按 `WJP_SERIES`(代码常量),**系列之内**按后台的
 * `sort_order`。后台没配过的型号排最后(同型号内保持代码原序)。
 *
 * ⚠️ **下架的型号不出现** —— 后台 `/admin/products` 里把某个型号改成
 * 「下架」,商城这一组设计就消失了。
 */
export async function getStorefrontProducts(): Promise<StorefrontProduct[]> {
  const resolved = await resolveCatalog();
  return activeItems(resolved.catalog).map((item) => decorate(item, resolved));
}

/**
 * 单件商品 —— **服务端专用**
 *
 * **下架 ⇒ 返回 null** —— 调用方据此 404 / 不展示。
 * 「不存在」和「已下架」给用户**同一个答案**(商品页那句「产品 X 不存在或
 * 已下架。」就是这个口径)。
 */
export async function getStorefrontProduct(
  handle: string
): Promise<StorefrontProduct | null> {
  const item = findProductByHandle(handle);
  if (!item) return null;

  const resolved = await resolveCatalog();
  if (!isCatalogTypeActive(item.productTypeCode, resolved.catalog)) return null;
  return decorate(item, resolved);
}

/**
 * 相关商品 —— **服务端专用**
 *
 * 「相关」的判断逻辑留在 `mock-catalog.ts`(同系列 / 同场合),这里只负责
 * **把价和配置盖上去** + **排除下架的**。
 *
 * ⚠️ **候选集要先过滤下架** —— 否则「相关推荐」里会出现一件已经下架的
 * 商品(点进去是个 404 页)。
 */
export async function getRelatedStorefrontProducts(
  handle: string,
  count: number
): Promise<StorefrontProduct[]> {
  const resolved = await resolveCatalog();
  const candidates = activeItems(resolved.catalog);
  return findRelatedProducts(handle, count, candidates).map((item) =>
    decorate(item, resolved)
  );
}
