"use server";

/**
 * /admin/taobao-links —— 淘宝链接后台 server actions(2026-11-18)
 *
 * 买家不信任一个新店 ⇒ 结算页除了支付宝,多一个「**淘宝下单**」:点了跳到
 * 这件设计对应的淘宝商品页,在淘宝付款(享受平台担保)。钱进的是**淘宝那个
 * 账户**,不在本仓库的收钱链路里 ⇒ 工作室在淘宝后台看到钱到了,再回本站
 * 把那笔单**手工标成已收款**。
 *
 * 这一组 action 是那条路的**配置**入口:
 *
 * - `adminListTaobaoLinksAction` —— 读列表(12 件设计,每件一行)
 * - `adminSaveTaobaoLinkAction` —— 新增 / 修改一条链接
 * - `adminSetTaobaoLinkActiveAction` —— 启用 / 停用(**不删**)
 * - `adminDeleteTaobaoLinkAction` —— 真删(录错了 handle 的时候才用)
 *
 * ## 「直接下单」那两样(2026-11-18)
 *
 * 工作室报的是「用户跳到淘宝后没有自动创建订单」⇒ 跳淘宝的**下单确认页**
 * (不是商品详情页)。后台每条链接带:
 *
 * - **`directOrder`** —— 直连下单的开关。**默认开**;关掉 = 退回商品页。
 * - **`skuMap`** —— 「本站尺寸 id → 淘宝 skuId」的映射,让淘宝那边**把规格
 *   预选好**。没配也能跳(淘宝让买家自己挑一下规格)。
 *
 * 两样**都在服务端再验一遍** —— 猜出来的 skuId 会把买家带到错的规格上去。
 *
 * ## 出错返回 `{ok:false, code}`,不 throw
 *
 * throw 会被 next-safe-action 糊成「服务器错误」—— 工作室根本不知道是哪儿
 * 错了(是链接不合法?是表还没建?)。所以这里把**能预见的**失败都变成一个
 * code,界面照着 code 给话。
 *
 * ## 「use server」文件只导出 async 函数
 *
 * 类型**不能**在这里 re-export —— Turbopack 会把它注册成 server action,
 * 运行时引用一个不存在的类型绑定 → `ReferenceError` → 整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。类型全在
 * `./types.ts`。
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { describeDbError } from "@/features/shared/lib/db-error";
import { MOCK_PRODUCTS } from "@/features/storefront/lib/mock-catalog";
import { checkTaobaoUrl } from "@/features/taobao/lib/taobao-link";
import {
  deleteTaobaoLink,
  listTaobaoLinks,
  setTaobaoLinkActive,
  upsertTaobaoLink,
} from "@/features/taobao/lib/taobao-link-store";
import { checkTaobaoSkuMap } from "@/features/taobao/lib/taobao-order-link";
import { adminAction } from "@/lib/safe-action";

import {
  type AdminTaobaoLinkListResult,
  type AdminTaobaoLinkWriteResult,
  buildTaobaoLinkRows,
  type TaobaoDesignRef,
} from "./types";

const withAdminTaobaoAction = (name: string) =>
  adminAction.metadata({ action: `admin.taobao.${name}` });

/** 每次写完都要刷的路径 */
const REVALIDATE_PATH = "/[locale]/admin/taobao-links";

/* -------------------------------------------------------------------------- */
/*  校验                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 一件设计的 handle
 *
 * ⚠️ **只认商城目录里真的有的 handle** —— 键是
 * `storefront_order_item.product_handle` 那个字符串,填错一个字母,配置就
 * 挂在一件不存在的设计上 ⇒ 买家点了跳过去,订单跟链接对不上。
 *
 * 商城目录的 12 件设计是**代码常量**(`mock-catalog.ts` 的 `SEEDS`)——
 * 设计资料在代码里,型号级的配置在 DB 里(见「电商产品读后台配置」)。
 * 链接按 handle 挂 ⇒ 拿代码常量那份列表来校验。
 */
const handleSchema = z
  .string()
  .min(1, "handle 必填")
  .max(64, "handle 太长了")
  .refine((handle) => MOCK_PRODUCTS.some((p) => p.handle === handle), {
    message: "这个 handle 不在商城目录里",
  });

/** 保存一条链接的入参 */
const linkSchema = z.object({
  productHandle: handleSchema,
  /** 淘宝商品链接 —— 服务端会用 `checkTaobaoUrl()` 再验一遍 */
  url: z.string().max(2048),
  /** 工作室自己写的备注(可选) */
  note: z.string().max(200).nullish(),
  /** 启用中? */
  isActive: z.boolean(),
  /**
   * 「本站尺寸 id → 淘宝 skuId」的映射
   *
   * 键 = 本站的尺寸 id(`size_R_4`),值 = 淘宝的 skuId(纯数字)。
   * 服务端会用 `checkTaobaoSkuMap()` 再验一遍 —— **不猜**。
   */
  skuMap: z.record(z.string(), z.string()).nullish(),
  /**
   * 「**直接下单**」开关
   *
   * 开 = 跳淘宝的**下单确认页**(商品 / 件数 / 规格都替买家选好);
   * 关 = 跳普通商品页(老行为)。默认开。
   */
  directOrder: z.boolean().nullish(),
});

/* -------------------------------------------------------------------------- */
/*  读                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 读后台列表
 *
 * **列的是商城那 12 件设计**,每件一行 —— 配没配链接一眼看得见。
 * 库里多出来的行(设计下架了、或者 handle 录错了)不列:后台这一页是
 * 「给哪件设计配链接」,摆一个买不到的设计在里头只会让工作室以为还能配。
 */
export const adminListTaobaoLinksAction = withAdminTaobaoAction("list").action(
  async (): Promise<AdminTaobaoLinkListResult> => {
    try {
      const links = await listTaobaoLinks();
      const designs: TaobaoDesignRef[] = MOCK_PRODUCTS.map((product) => ({
        handle: product.handle,
        title: product.title,
        titleEn: product.titleEn,
        typeLabel: product.typeLabel,
        typeLabelEn: product.typeLabelEn,
        seriesName: product.seriesName,
        seriesNameEn: product.seriesNameEn,
        sizes: (product.sizes ?? []).map((size) => ({
          id: size.id,
          cm: size.cm,
        })),
      }));
      return { ok: true, rows: buildTaobaoLinkRows(designs, links) };
    } catch (error) {
      const info = describeDbError(error);
      console.error("[taobao] 读淘宝链接失败:", info.message || error);
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "SAVE_FAILED" };
    }
  }
);

/* -------------------------------------------------------------------------- */
/*  写                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * 新增 / 修改一条链接
 *
 * 一个设计**只有一条**链接(唯一索引 `product_taobao_link_handle_uniq_idx`)
 * ⇒ 重复保存就是覆盖。
 *
 * ## 链接的校验在**服务端**做一遍
 *
 * 前端也校验(免得工作室白填一遍),但**服务端的这份才是算数的那份** ——
 * 链接是要摆给买家点的,域名错了就是把客人往别处引。
 *
 * 校验规则在 `taobao-link.ts` 的 `checkTaobaoUrl()`(纯函数):
 * http/https + 域名是 taobao / tmall + 指得到一个具体商品(`id=`)。
 */
export const adminSaveTaobaoLinkAction = withAdminTaobaoAction("save")
  .schema(linkSchema)
  .action(async ({ parsedInput }): Promise<AdminTaobaoLinkWriteResult> => {
    const check = checkTaobaoUrl(parsedInput.url);
    if (!check.ok) {
      // `TaobaoUrlProblem` 的四个值跟 `AdminTaobaoErrorCode` 的前四个
      // **同名** ⇒ 直接透传,不用再映射一遍。
      return { ok: false, code: check.problem };
    }

    // 「本站尺寸 id → 淘宝 skuId」—— 服务端**再验一遍**
    //
    // 前端那层只是省工作室一次填写。**猜出来的 skuId 会把买家带到错的规格
    // 上去**(工作室那边对不上货)⇒ 认不出来就拒。
    const skuCheck = checkTaobaoSkuMap(parsedInput.skuMap);
    if (!skuCheck.ok) {
      return { ok: false, code: skuCheck.problem };
    }

    // 映射表的键必须是**这件设计真的有的尺寸**
    //
    // 尺寸 id 写错了 ⇒ 那条映射永远用不上(静默失效,工作室会以为配好了)。
    const design = MOCK_PRODUCTS.find(
      (p) => p.handle === parsedInput.productHandle
    );
    const knownSizeIds = new Set((design?.sizes ?? []).map((size) => size.id));
    for (const sizeId of Object.keys(skuCheck.map)) {
      if (!knownSizeIds.has(sizeId)) {
        return { ok: false, code: "UNKNOWN_SIZE_ID" };
      }
    }

    try {
      await upsertTaobaoLink({
        productHandle: parsedInput.productHandle,
        url: check.url,
        itemId: check.itemId,
        note: parsedInput.note?.trim() || null,
        isActive: parsedInput.isActive,
        skuMap: skuCheck.map,
        directOrder: parsedInput.directOrder ?? true,
      });
    } catch (error) {
      const info = describeDbError(error);
      console.error("[taobao] 保存淘宝链接失败:", info.message || error);
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePath(REVALIDATE_PATH, "page");
    return { ok: true };
  });

/**
 * 启用 / 停用一条链接
 *
 * 停用之后这个设计**不再能选淘宝下单** —— 链接留着,历史单还能查。
 * （默认用停用就够了;真删是另一条 action。）
 */
export const adminSetTaobaoLinkActiveAction = withAdminTaobaoAction("setActive")
  .schema(
    z.object({
      productHandle: handleSchema,
      isActive: z.boolean(),
    })
  )
  .action(async ({ parsedInput }): Promise<AdminTaobaoLinkWriteResult> => {
    try {
      await setTaobaoLinkActive(
        parsedInput.productHandle,
        parsedInput.isActive
      );
    } catch (error) {
      const info = describeDbError(error);
      console.error("[taobao] 停用淘宝链接失败:", info.message || error);
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePath(REVALIDATE_PATH, "page");
    return { ok: true };
  });

/**
 * 真删一条链接
 *
 * ⚠️ **默认不用这个** —— 停用就够了(链接留着,历史单还能查)。
 * 只有录错了 handle(配到一件不存在的设计上)才用得上。
 */
export const adminDeleteTaobaoLinkAction = withAdminTaobaoAction("delete")
  .schema(z.object({ productHandle: handleSchema }))
  .action(async ({ parsedInput }): Promise<AdminTaobaoLinkWriteResult> => {
    try {
      await deleteTaobaoLink(parsedInput.productHandle);
    } catch (error) {
      const info = describeDbError(error);
      console.error("[taobao] 删除淘宝链接失败:", info.message || error);
      if (info.missingRelation) {
        return { ok: false, code: "MIGRATION_MISSING" };
      }
      return { ok: false, code: "SAVE_FAILED" };
    }

    revalidatePath(REVALIDATE_PATH, "page");
    return { ok: true };
  });

/*
 * `AdminTaobaoLinkRow` / `AdminTaobaoLinkWriteResult` /
 * `AdminTaobaoErrorCode` **不在这里 re-export** —— 「use server」文件只能
 * 导出 async 函数,类型 re-export 会被 Turbopack 注册成 server action,
 * 运行时引用一个不存在的类型绑定 → ReferenceError,整个页面 500
 * (见 `src/test/repo/pure/use-server-exports.test.ts`)。
 *
 * 界面从 `@/features/taobao/admin/types` 直接 import 那些类型。
 */
