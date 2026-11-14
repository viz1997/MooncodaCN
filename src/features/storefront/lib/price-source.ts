/**
 * 商品目录 + 价钱的**数据库读取** —— 服务端专用
 *
 * ## 为什么要有这个文件
 *
 * 后台 `/admin/products` 改的是 DB(`product.base_price_cents` /
 * `product_accessory_variant.price_delta_cents`),但商城网页那条链路读的
 * 是**代码常量**(`mock-catalog.ts` 的 `BASE_PRICE_CENTS`)。⇒ 后台改价,
 * 小程序变了、商城网页没变 —— 工作室看到的「改了不生效」。
 *
 * 这个文件把 DB 的价读出来,**盖到**静态目录上。纯函数那一半在
 * `pricing.ts`(加一个可选第二参),这里只管「读」和「盖」。
 *
 * ## 2026-11-14:目录**本身**也接后台了
 *
 * 工作室的要求:「电商产品获取后台配置管理好的产品」。⇒ 除了价,这一层
 * 现在还管三件事:
 *
 * | DB 的列 | 管什么 |
 * |---|---|
 * | `status` | **上架 / 下架** —— 某个型号下架,商城那几件设计一起消失 |
 * | `name` / `name_en` | **型号名** —— 商品页上的「钥匙扣 / 手办 / 冰箱贴」那个标签 |
 * | `sort_order` | **系列之内**的先后(系列之间的顺序是 `WJP_SERIES` 代码常量) |
 * | `accent` | 强调色(空 ⇒ 用代码常量) |
 *
 * **一次 DB 读**同时拿价和目录(`product` 表的两组列)⇒ 一个请求只查一次库。
 * 纯函数那一半在 `catalog-apply.ts`(上架判定 / 盖名字 / 排序)。
 *
 * ## 哪些**不**接后台(刻意的)
 *
 * 设计级的资料 —— **标题 / 图 / 配件清单 / 工期** —— 仍然是代码常量。
 * 后台管的是**型号**,商城卖的是**设计**:把型号级的 `description` /
 * `coverUrl` / `leadTimeDays` 盖到设计级上,会让 4 件设计变成同一张图 /
 * 同一段文案 / 同一个工期。理由见 CLAUDE.md「电商产品读后台配置」那一节。
 *
 * ⇒ `mock-catalog.ts` 保持客户端安全(它被 4 个 client 组件 import),
 * **不许**在这里 import `@/db` 之外的东西把它拖进浏览器。
 *
 * ## ⚠️ 这个模块会让页面变成动态渲染
 *
 * 商城页以前是**构建期静态预渲染**的 —— 不告诉 Next「这一页不能静态」,
 * 价就会在构建时烤进 HTML,改完价刷新还是旧价(**「改了不生效」原地复发**,
 * 只是换了个原因)。
 *
 * `await connection()` 就是那句「别静态」—— **一处就够**,不用给每个页面
 * 加 `force-dynamic`(那会让整个营销站永远动态,动静太大)。
 *
 * ## DB 读失败怎么办 —— **两个地方不一样**
 *
 * | 地方 | DB 读失败时 |
 * |---|---|
 * | 展示(商品页 / 购物袋) | 降级到代码常量,页面照常显示,加一条日志 |
 * | **收钱(结算 / 下单)** | **直接失败** —— 绝不按旧价收款 |
 *
 * 购物袋显示 ¥19 而结算报「价格暂时无法确认」—— 这是**故意的**:
 * 宁可下不了单,也不能按一个**已经作废的价**收钱。
 *
 * 所以 `getPriceSource()` **不抛错**,它把「查没查到」放进 `degraded` 标志;
 * **抛不抛由调用点决定**。
 */

import { connection } from "next/server";
import { cache } from "react";

import { db } from "@/db";
import { product, productAccessoryVariant } from "@/db/schema";
import { describeDbError } from "@/features/shared/lib/db-error";

import type { AccessoryGroup, StorefrontProduct } from "../types";
import { buildCatalogSource, emptyCatalogSource } from "./catalog-apply";
import type { CatalogSource } from "./catalog-source-types";
import type { PriceSource } from "./price-source-types";

export type {
  CatalogSource,
  CatalogTypeConfig,
  CatalogTypeRow,
} from "./catalog-source-types";
export type { PriceSource } from "./price-source-types";

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/** 读不到时的空价格源 —— 一切都退回代码常量 */
function emptyPriceSource(readError: string | null): PriceSource {
  return {
    basePriceCentsByTypeCode: new Map(),
    accessoryDeltaCentsByVariantId: new Map(),
    degraded: true,
    readError,
  };
}

/**
 * 一次 DB 读的结果 —— **价 + 目录配置**
 *
 * 两份来源是同一个 `product` 表的两组列 ⇒ **一个请求只查一次库**。
 */
interface StorefrontSource {
  readonly price: PriceSource;
  readonly catalog: CatalogSource;
}

/**
 * 从 DB 读价 + 读目录配置 —— **请求内只查一次**
 *
 * `cache()` 用 React 的(跟 `print-quote/lib/pricing-store.ts` 一个套路)。
 * 跨请求不缓存 —— 后台改完价 / 改完上架状态要**立刻**生效。
 *
 * ## 关于配件变体的 `is_active`
 *
 * **配件变体不按 `is_active` 过滤** —— 一个仍然在卖的变体,它的价就该用
 * DB 里那一行。**下架**是**型号级**的事(`product.status`),管的是
 * 「这一整组设计还在不在架上」,跟配件变体的价无关。
 */
const readStorefrontSource = cache(async (): Promise<StorefrontSource> => {
  try {
    const [productRows, variantRows] = await Promise.all([
      db
        .select({
          code: product.code,
          basePriceCents: product.basePriceCents,
          // 目录配置(2026-11-14)—— 上架状态 / 型号名 / 排序 / 强调色
          name: product.name,
          nameEn: product.nameEn,
          status: product.status,
          sortOrder: product.sortOrder,
          accent: product.accent,
        })
        .from(product),
      db
        .select({
          variantCode: productAccessoryVariant.variantCode,
          priceDeltaCents: productAccessoryVariant.priceDeltaCents,
        })
        .from(productAccessoryVariant),
    ]);

    const basePriceCentsByTypeCode = new Map<string, number>();
    for (const row of productRows) {
      basePriceCentsByTypeCode.set(row.code, row.basePriceCents);
    }

    // 键是 `acc_${variantCode}` —— 跟 `spec.accessoryVariantIds` 里那个
    // 字符串一模一样(`mock-catalog.ts` 的 `findAccessoryVariant` 就这么拼)。
    //
    // ⚠️ `variantCode` **必须全局唯一** —— DB 的唯一索引是
    // `(productTypeCode, accessoryCode, variantCode)`,只保证**型号内**唯一。
    // 同一个 `variantCode` 挂在两个型号下时,商城按 `acc_${variantCode}` 查
    // 就「取到哪个算哪个」。那种行**不塞进 Map** —— 退回代码常量(那边一定
    // 唯一),同时把这条数据问题喊出来。
    const accessoryDeltaCentsByVariantId = new Map<string, number>();
    const ambiguous = new Set<string>();
    for (const row of variantRows) {
      const key = `acc_${row.variantCode}`;
      if (ambiguous.has(key)) continue;
      if (accessoryDeltaCentsByVariantId.has(key)) {
        // 同一个 variantCode 出现了两次 —— 数据有问题,别猜
        ambiguous.add(key);
        accessoryDeltaCentsByVariantId.delete(key);
        console.error(
          `[storefront] 配件变体 ${row.variantCode} 在 DB 里出现了多次 —— ` +
            "商城按 acc_<variantCode> 查会取到不确定的那一个。" +
            "这一行退回代码常量的价。"
        );
        continue;
      }
      accessoryDeltaCentsByVariantId.set(key, row.priceDeltaCents);
    }

    return {
      price: {
        basePriceCentsByTypeCode,
        accessoryDeltaCentsByVariantId,
        degraded: false,
        readError: null,
      },
      // 目录配置 —— **稀疏的**:DB 里有的型号才有键
      catalog: buildCatalogSource(productRows),
    };
  } catch (error) {
    const info = describeDbError(error);
    console.error(
      "[storefront] 读商品目录失败,退回代码常量兜底:",
      info.message || error
    );
    const reason = info.message || String(error);
    return {
      price: emptyPriceSource(reason),
      // 目录也退回代码默认 —— **全部上架 + 原序**
      //
      // ⚠️ 这是**刻意**的:读失败时宁可把东西都摆出来(后台一改就好),
      // 也不要给用户一个**空店**。收钱那一侧另有硬闸(`PriceSource.degraded`
      // ⇒ 结算直接失败),不会「按旧价收钱」。
      catalog: emptyCatalogSource(reason),
    };
  }
});

/**
 * 「这一页不能静态渲染」—— **只在这一处说**
 *
 * `await connection()` 放在 `cache()` **外面** —— React 的 `cache()` 会把
 * 抛出来的值也缓存,放在里面的话动态渲染的信号会被缓存住。
 *
 * ## 为什么容忍「不在请求作用域里」
 *
 * `connection()` 在**没有任何请求作用域**时(脚本 / 单测直接调了它)是
 * **抛错**的(`E251`,Next 16 的 `next/server` 行为)。那种场景下本来就不存在
 * 「构建期预渲染」这回事 —— 没有要 bailout 的对象 ⇒ 继续往下走,别把调用方
 * 炸了。
 *
 * **构建期预渲染时它抛的是别的错**(`StaticGenBailoutError` / 挂起 promise)——
 * 那两个**必须往外抛**,它们就是「这一页别静态」的信号。
 */
async function optOutOfStaticRendering(): Promise<void> {
  try {
    await connection();
  } catch (error) {
    const code = (error as { __NEXT_ERROR_CODE?: unknown } | null)
      ?.__NEXT_ERROR_CODE;
    if (code !== "E251") throw error;
    // E251 = 「不在请求作用域里」—— 脚本 / 单测 / 少见的构建期路径。
    // 那几种场景下**本来就不存在**「构建期预渲染」这回事,继续往下走。
    // 但留一条日志:万一在构建期真的走到了这里,说明价可能被烤进了 HTML
    // —— 那是「改了不生效」复发的信号,得有人看见。
    console.warn(
      "[storefront] connection() 报 E251(不在请求作用域里)—— " +
        "继续读价。若这是构建期输出的,请检查这一页是不是被静态预渲染了" +
        "(价会被烤进 HTML,后台改价就不生效)。"
    );
  }
}

/**
 * 价格源 —— **调用它就意味着这一页不能静态渲染**
 *
 * 拿不到就**不抛** —— 把「查没查到」放进 `degraded` 标志,
 * **抛不抛由调用点决定**(见文件头那张表)。
 */
export async function getPriceSource(): Promise<PriceSource> {
  await optOutOfStaticRendering();
  return (await readStorefrontSource()).price;
}

/**
 * 目录源(上架状态 / 型号名 / 排序)—— **调用它就意味着这一页不能静态渲染**
 *
 * 跟 `getPriceSource()` **共用同一次 DB 读**(`readStorefrontSource()` 是
 * `cache()` 包的)⇒ 一个请求只查一次库。
 *
 * 纯函数那一半在 `catalog-apply.ts`;把目录拼成「商城能直接用」的形状
 * 是 `storefront-catalog.ts` 的事。
 */
export async function getCatalogSource(): Promise<CatalogSource> {
  await optOutOfStaticRendering();
  return (await readStorefrontSource()).catalog;
}

/* -------------------------------------------------------------------------- */
/*  盖                                                                         */
/* -------------------------------------------------------------------------- */

/** 把 DB 的配件加价盖到分组上 —— 没变就原样返回(省一次重渲染) */
function applyAccessoryPrices(
  groups: AccessoryGroup[],
  source: PriceSource
): AccessoryGroup[] {
  let changed = false;
  const next = groups.map((group) => {
    let groupChanged = false;
    const variants = group.variants.map((variant) => {
      const delta = source.accessoryDeltaCentsByVariantId.get(variant.id);
      if (delta === undefined || delta === variant.surchargeCents)
        return variant;
      groupChanged = true;
      return { ...variant, surchargeCents: delta };
    });
    if (!groupChanged) return group;
    changed = true;
    return { ...group, variants };
  });
  return changed ? next : groups;
}

/**
 * 把 DB 的价盖到一件商品上
 *
 * 纯函数 —— `source` 从哪儿来它不管。测试可以直接拿一份手写的 `source` 喂它。
 */
export function applyPriceSource(
  item: StorefrontProduct,
  source: PriceSource
): StorefrontProduct {
  const basePriceCents =
    source.basePriceCentsByTypeCode.get(item.productTypeCode) ??
    item.basePriceCents;
  const accessoryGroups = applyAccessoryPrices(item.accessoryGroups, source);

  if (
    basePriceCents === item.basePriceCents &&
    accessoryGroups === item.accessoryGroups
  ) {
    return item;
  }
  return { ...item, basePriceCents, accessoryGroups };
}

/* -------------------------------------------------------------------------- */
/*  目录 —— 在 `storefront-catalog.ts`                                             */
/* -------------------------------------------------------------------------- */

/**
 * 「商城目录」那三个 getter(带 DB 价 + 后台的上架 / 名字 / 排序)现在住在
 * `storefront-catalog.ts` —— 那边把**价**和**目录**两件事拼在一起。
 *
 * 这里只留**两份来源**(`getPriceSource()` / `getCatalogSource()`)和
 * 「盖价」那一半(`applyPriceSource()`)。
 */
