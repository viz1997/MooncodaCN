/**
 * POST /api/print-quote —— 按几何算报价
 *
 * 报价页在用户改尺寸时实时调这个接口拿价格。**不写库** —— 报价是临时的,
 * 只有真的下单才会落一条 `print_order`。
 *
 * 限流走 `polling` 桶(60/min):语义上是「客户端反复拉同一个资源的最新
 * 状态」—— 用户拖一下尺寸滑块就换一个几何,报价得跟着变。
 *
 * 不用 `ai` 桶(20/min):这个接口只做算术,不调任何付费上游,开销跟 AI
 * 推理没法比;而且客户端有 400ms 防抖 + 定时器重置,连续拖动期间根本不会
 * 发请求,真正发出的请求数远低于「拖动频率」。
 *
 * 2026-11-01:要登录。整个打印服务改成「登录后下单」,报价接口同步收口 ——
 * 页面本身已经拦了未登录的人,接口不留后门。
 *
 * 2026-11-07:**访客也能报价了** —— 工作室的原话「现在不登录也允许计价
 * 显示」。工具页的「提交打印订单」那张卡上摆出预估报价,没登录也摆。
 *
 * 但**不是无条件放开** —— 后台(`/admin/print-pricing`)有一个「访客可见
 * 计价」的开关:
 *
 * | 情况 | 结果 |
 * |---|---|
 * | 已登录 | 照常报价(开关不管已登录的人 —— 能下单就能看价) |
 * | 未登录 + 开关开 | 报价(200) |
 * | 未登录 + 开关关 | **403 `GUEST_PRICING_DISABLED`** —— 界面摆「登录后可见报价」 |
 *
 * 开关的值在 `PrintPricingSettings.allowGuestPricing`(后台配的,兜底
 * `PRINT_ALLOW_GUEST_PRICING` 环境变量,默认**开**)。
 */

import { checkReliefTier } from "@mooncoda/print-tool-core/pricing/relief-detect";
import { printCouponBaseCents } from "@mooncoda/print-tool-core/quote/coupon-base";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { evaluateCoupon } from "@/features/coupon/lib/coupon-service";
import { getPrintOrderUser } from "@/features/print-quote/lib/auth";
import { getPrintPricingSettings } from "@/features/print-quote/lib/pricing-store";
import { toPublicQuote } from "@/features/print-quote/lib/quote-public";
import { computePrintQuote } from "@/features/print-quote/lib/quote-server";
import type { PrintQuoteInput } from "@/features/print-quote/lib/quote-types";
import { withApiLogging } from "@/lib/api-logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
/** 纯计算 + 一次 DB-less 逻辑,10s 绰绰有余 */
export const maxDuration = 10;

const quoteInputSchema = z.object({
  /** 体积 cm³ */
  volumeCM3: z.number().positive().max(1_000_000),
  /** 表面积 cm² */
  surfaceAreaCM2: z.number().min(0).max(1_000_000),
  /** 成品尺寸 mm:X=长 Y=宽 Z=高 */
  dims: z
    .tuple([
      z.number().min(0).max(100_000),
      z.number().min(0).max(100_000),
      z.number().min(0).max(100_000),
    ])
    .refine(([x, y, z]) => x > 0 || y > 0 || z > 0, {
      message: "尺寸不能全为 0",
    }),
  /** 智能摆盘算出的支撑克重 g */
  supportWeightG: z.number().min(0).max(1_000_000).nullish(),
  /** 本体支撑比例(1 = 1:1) */
  selfSupportRatio: z.number().min(0).max(1_000_000).nullish(),
  /**
   * 交期档位(48 / 72 / 96 小时)
   *
   * 不传 = 标准档。传了不认识的 zod 会拒掉 —— 那是 400,不是「按最贵的算」。
   */
  deliveryTier: z.enum(["standard", "express", "urgent"]).nullish(),
  /**
   * 优惠码(2026-11-08)
   *
   * 传了 = 让服务端算一下这张码在这单上能减多少。不传 = 不用券。
   *
   * **码不可用不会让这个接口失败** —— 报价还是给(用户得先看到价),只是
   * 响应里多一个 `couponError`(精确原因码),界面据此说人话。
   */
  couponCode: z.string().max(64).nullish(),
  /**
   * 托底档位(2026-11-15)—— `relief`(浮雕,托底 1mm)/ `figurine`(手办,托底 5mm)
   *
   * **这是「自洽性」的凭据,不是重算的依据** —— 服务端不重新算支撑体积
   * (几何不上传),它拿的是 `supportWeightG`。所以这一项只用来跟服务端按
   * `dims` 判定出来的那一档**对一下**。
   *
   * 不传 = 老客户端 ⇒ 按服务端自己判定的那一档走,不报错。
   */
  reliefKind: z.enum(["relief", "figurine"]).nullish(),
  /**
   * 打印件数(2026-11-17)
   *
   * 工作室的原话:「同一模型打印多件」—— 克重费 / 后处理费 / 支撑加价都
   * **按件**放大;**运费不乘**(「运费按单收取」)。
   *
   * ⚠️ **越界一律 400,不许夹取** —— 夹取会**静默少收钱**(用户要 5000 件,
   * 服务端夹成 999 件,少收 4/5 的钱)。引擎那一层的夹取只是兜底。
   */
  quantity: z.number().int().min(1).max(999).nullish(),
  /**
   * 配送方式(2026-11-17)
   *
   * - `cod`      —— 顺丰到付(运费 ¥0)
   * - `standard` —— 顺丰标快(¥18)
   * - `air`      —— 顺丰空运(¥22)
   *
   * 不传 = 顺丰到付。传了不认识的 zod 会拒掉 —— 那是 400,不是「按最贵的算」。
   */
  shippingOption: z.enum(["cod", "standard", "air"]).nullish(),
});

async function handle(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, "polling");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  // 价从哪儿来:后台 `/admin/print-pricing` 配的值 → `PRINT_*` env → 默认值
  // (开关也在这一份里 —— 访客能不能报价,读的是它)
  const settings = await getPrintPricingSettings();

  // 登录了吗 —— 访客能不能报价由后台那个开关说了算
  const user = await getPrintOrderUser();
  if (!user && !settings.allowGuestPricing) {
    return NextResponse.json(
      {
        error: "GUEST_PRICING_DISABLED",
        message: "访客看不到报价,登录后就能看",
      },
      { status: 403, headers: getRateLimitHeaders(rl) }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON", message: "请求体不是合法 JSON" },
      { status: 400 }
    );
  }

  const parsed = quoteInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "报价参数不合法",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  const input: PrintQuoteInput = {
    volumeCM3: parsed.data.volumeCM3,
    surfaceAreaCM2: parsed.data.surfaceAreaCM2,
    dims: parsed.data.dims,
    supportWeightG: parsed.data.supportWeightG ?? null,
    selfSupportRatio: parsed.data.selfSupportRatio ?? null,
    deliveryTier: parsed.data.deliveryTier ?? null,
    reliefKind: parsed.data.reliefKind ?? null,
    // 件数 / 配送方式(2026-11-17)—— 不传就是「1 件 + 顺丰到付」
    quantity: parsed.data.quantity ?? null,
    shippingOption: parsed.data.shippingOption ?? null,
  };

  /**
   * 托底档位的**自洽性检查**(2026-11-15)
   *
   * 客户端报的档位跟服务端按 `dims` 判定的那一档对不上 ⇒ 409。
   *
   * 只挡一个方向 —— 「报浮雕、但尺寸判定是手办」(托底低 ⇒ 支撑少 ⇒
   * **少收支撑费**)。反过来(报手办、判成浮雕)是**多收**,放行。
   *
   * 老实客户端**撞不到**这道闸:它报的档位就是按同一组 `dims` 判出来的,
   * 而且「浮雕」那一档在几何不像浮雕时是禁用的(用户点不着)。
   */
  const reliefTier = checkReliefTier(input.dims, input.reliefKind);
  if (!reliefTier.ok) {
    return NextResponse.json(
      {
        error: "RELIEF_TIER_MISMATCH",
        message: "托底档位跟尺寸对不上,按手办那档算",
        kind: reliefTier.kind,
      },
      { status: 409, headers: getRateLimitHeaders(rl) }
    );
  }

  // 价从哪儿来:后台 `/admin/print-pricing` 配的值(上面已经读过了)
  const quote = computePrintQuote(settings, input);
  if (!quote) {
    return NextResponse.json(
      { error: "QUOTE_UNAVAILABLE", message: "这组几何算不出报价" },
      { status: 422 }
    );
  }

  /**
   * 优惠码(2026-11-08)
   *
   * **券不可用不让这个接口失败** —— 报价照给(用户得先看到价),只是多带
   * 一个 `couponError`。下单那条路才会硬拒(见 `POST /api/print-orders`)。
   *
   * 基数 = 报价合计 − 交期加价 − 运费(加急费 / 寄件费都不参与优惠)。
   */
  const coupon = parsed.data.couponCode
    ? await evaluateCoupon({
        code: parsed.data.couponCode,
        orderKind: "print",
        couponBaseCents: printCouponBaseCents(quote),
        // 免运费券在打印侧**不适用**(scope 只能选 mall)—— 券在后台建的时候就
        // 选不了 print / both ⇒ 这条路走不到「把运费置 0」
        shippingCents: 0,
        resolveUserId: async () => user?.id ?? null,
      })
    : null;

  return NextResponse.json(
    {
      /**
       * **对外形状** —— 单价(¥4.50/g 那一栏)一个字节都不出去
       *
       * 工作室 2026-11-16 的要求:「不要展示 4.5 元/g 这种单价,避免暴露
       * 我们的成本」。内部那份 `quote` 带着单价,这里投影一次再发出去
       * (见 `quote-public.ts`)。
       */
      quote: toPublicQuote(quote),
      /** 优惠效果(服务端算的)—— null = 没有码,或者券不可用 */
      coupon: coupon?.coupon ?? null,
      /** 券不可用的精确原因 —— null = 没有码,或者券完全可用 */
      couponError: coupon?.error ?? null,
    },
    { headers: getRateLimitHeaders(rl) }
  );
}

export const POST = withApiLogging(handle);
