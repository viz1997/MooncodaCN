/**
 * 真实案例的**前台读取** —— 服务端专用
 *
 * 跟 `price-source.ts` 一个套路:纯逻辑在 `case-apply.ts`,连库在
 * `case-store.ts`,图片解析在 `case-image.ts`,这里把三样拼成
 * 「前台能直接摆」的那一批。
 *
 * ## 读不到怎么办 —— **降级,不崩**
 *
 * DB 读失败(迁移脚本没跑 / 网络抖)⇒ 返回**空数组** + 一条 error 日志。
 * 前台那一层看到空数组就**整段不摆** —— 见
 * `src/features/marketing/components/storefront/craft-gallery.tsx`。
 *
 * 为什么降级而不是抛:案例是**营销内容**,不是收钱链路的一环。
 * 案例读不到 ⇒ 页面上没有那一段,其余部分照常卖货;抛出去 ⇒ 整个首页 500。
 *
 * ⚠️ 但**不能拿静态数据兜底** —— 以前那两块「真实照片。真实礼物。」喂的是
 * Unsplash 的宠物照片 + 编出来的点赞数(工作室的猫狗当顾客的成品)。
 * 那种假数据摆在「真实」两个字底下比不摆更糟 ⇒ **宁可空着**。
 *
 * ## 静态预渲染
 *
 * `await connection()` —— 「这一页别静态」的那一声。案例是后台随时会改的,
 * 烤进 HTML 就会看到旧的。
 *
 * ⚠️ 放在 `cache()` **外面** —— React 的 `cache()` 会把抛出来的值也缓存住。
 */

import { connection } from "next/server";
import { cache } from "react";

import { describeDbError } from "@/features/shared/lib/db-error";

import { toShowcaseCases } from "./case-apply";
import { resolveShowcaseImageSrc } from "./case-image";
import { listShowcaseCases } from "./case-store";
import type {
  ShowcaseCase,
  ShowcaseCaseRecord,
  ShowcaseLocale,
} from "./case-types";

/**
 * 「这一页不能静态渲染」—— **只在这一处说**
 *
 * `connection()` 在**没有请求作用域**时(脚本 / 单测直接调)是抛错的
 * (`E251`)⇒ 那几种场景下本来就不存在「构建期预渲染」这回事,继续往下走。
 *
 * ⚠️ **只吞 E251** —— 构建期预渲染时它抛的是别的错
 * (`StaticGenBailoutError` / 挂起的 promise),那两个**必须往外抛**,
 * 它们就是「这一页别静态」的信号。
 */
async function optOutOfStaticRendering(): Promise<void> {
  try {
    await connection();
  } catch (error) {
    const code = (error as { __NEXT_ERROR_CODE?: unknown } | null)
      ?.__NEXT_ERROR_CODE;
    if (code !== "E251") throw error;
    console.warn(
      "[showcase] connection() 报 E251(不在请求作用域里)—— 继续读案例。" +
        "若这是构建期输出的,请检查这一页是不是被静态预渲染了" +
        "(案例会被烤进 HTML,后台改了不生效)。"
    );
  }
}

/**
 * 读上架的案例 —— **请求内只查一次**
 *
 * 读失败 ⇒ 空数组 + 一条 error 日志(见文件头)。
 */
const readShowcaseRecords = cache(async (): Promise<ShowcaseCaseRecord[]> => {
  try {
    return await listShowcaseCases({ includeInactive: false });
  } catch (error) {
    const info = describeDbError(error);
    console.error(
      "[showcase] 读案例失败(前台降级成「没有案例」):",
      info.message || error
    );
    return [];
  }
});

/**
 * 前台摆的那一批案例
 *
 * @param locale  挑哪一份文案
 * @param limit   最多摆几条(不传 = 全部)
 *
 * ## 图片解析不出来的条目会被**剔掉**
 *
 * 投影那一步(`toShowcaseCases`)会把封面解析不了的条目剔掉 ⇒ 返回的数组
 * 里**每一条都有能用的 `coverSrc`**。前台不用再判空。
 */
export async function getShowcaseCases(
  locale: ShowcaseLocale,
  limit?: number
): Promise<ShowcaseCase[]> {
  await optOutOfStaticRendering();
  const records = await readShowcaseRecords();
  return toShowcaseCases(records, locale, resolveShowcaseImageSrc, limit);
}
