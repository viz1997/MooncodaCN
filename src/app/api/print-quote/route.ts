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

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { evaluateCoupon } from "@/features/coupon/lib/coupon-service";
import { getPrintOrderUser } from "@/features/print-quote/lib/auth";
import { printCouponBaseCents } from "@/features/print-quote/lib/coupon-base";
import { getPrintPricingSettings } from "@/features/print-quote/lib/pricing-store";
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
  };

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
   * 基数 = 报价合计 − 交期加价(加急费不参与优惠)。
   */
  const coupon = parsed.data.couponCode
    ? await evaluateCoupon({
        code: parsed.data.couponCode,
        orderKind: "print",
        couponBaseCents: printCouponBaseCents(quote),
        // 打印工单没有运费行 —— 免运费券在这儿没有意义,会被直接拒掉
        shippingCents: 0,
        resolveUserId: async () => user?.id ?? null,
      })
    : null;

  return NextResponse.json(
    {
      quote,
      /** 优惠效果(服务端算的)—— null = 没有码,或者券不可用 */
      coupon: coupon?.coupon ?? null,
      /** 券不可用的精确原因 —— null = 没有码,或者券完全可用 */
      couponError: coupon?.error ?? null,
    },
    { headers: getRateLimitHeaders(rl) }
  );
}

export const POST = withApiLogging(handle);
