/**
 * /api/print-orders —— 打印服务的下单 + 我的工单列表
 *
 * 2026-11-01:改成**登录后下单**。订单挂在账号名下(`user_id`),用户在自己的
 * dashboard 页看进度。之前是匿名下单 + 「订单号 + 令牌」双因子查单。
 *
 * 用户带自己的 3D 模型来,按克重计价,工作室按这份工单生产。
 *
 * - `POST` —— 下单
 * - `GET`  —— 当前用户的工单列表(给「我的打印订单」页轮询用)
 *
 * ## 2026-11-08:打印服务**不进商城购物袋**,直接建工单
 *
 * 工作室的说法:「不要放入购物车,放在这里 account/print-orders」。所以这
 * 条路是打印服务的**唯一**下单出口 —— 商城购物袋只装目录商品。
 *
 * 建完单钱由**工单自己收**(建单时建支付会话:微信扫码 / 支付宝跳转),
 * 工单详情页给付款入口。
 *
 * ## 收货地址(2026-11-08)
 *
 * 客户端只给 `addressId`,地址内容由服务端从地址簿取 —— 归属校验在数据层。
 * 没有地址的单子没法开工(工作室照着单子寄不出去),所以这一个是必填。
 *
 * ## 服务端重算价格
 *
 * 客户端会带着它自己算的报价来,但**这里不信** —— 只取几何和支撑信息,
 * 用 `computePrintQuote()` 重算一遍,落库的是重算结果。跟商城购物车
 * 每次加购都重算 `calculatePricing()` 是同一个道理:客户端能被改。
 *
 * ## 联系邮箱不采信客户端
 *
 * 邮箱一律取登录用户的账号邮箱。订单已经归属账号,没理由让客户端随便填 ——
 * 否则这个接口就成了一条「给任意邮箱发信」的通道。
 *
 * ## 模型文件
 *
 * 模型已经由客户端直传到 R2(`/api/print-orders/upload-url` 签的 URL),
 * 这里只收 `modelUrl`。不收字节 —— Vercel function 4.5MB 请求体上限
 * 装不下模型文件。
 *
 * ## GET 的限流桶是 `printOrder`(120/min)
 *
 * 轮询比下单宽松得多:下单走 `strict`(3/min),轮询走 `printOrder`。
 * 同账号开 4 个标签页 ≈ 72/min,在限内 —— 但余量不大,看日志再调。
 */

import { after, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { PrintOrderRow, ShippingAddressSnapshot } from "@/db/schema";
import { getUserAddress } from "@/features/address/queries";
import { isR2Configured, objectExists } from "@/features/image-gen/lib/r2";
import { isPaymentChannelEnabled } from "@/features/payments/lib/registry";
import { getPrintOrderUser } from "@/features/print-quote/lib/auth";
import { notifyPrintOrderCreated } from "@/features/print-quote/lib/notifications";
import {
  createPrintOrder,
  listUserPrintOrders,
  toUserPrintOrder,
} from "@/features/print-quote/lib/order-store";
import { createPrintOrderPayment } from "@/features/print-quote/lib/payment";
import { getPrintPricingSettings } from "@/features/print-quote/lib/pricing-store";
import {
  computePrintQuote,
  generatePrintOrderNo,
} from "@/features/print-quote/lib/quote-server";
import type { PrintOrderRequest } from "@/features/print-quote/lib/quote-types";
import { normalizePrintOrderLocale } from "@/features/print-quote/lib/quote-types";
import { isOwnModelUrl } from "@/features/print-quote/lib/upload-key";
import { withApiLogging } from "@/lib/api-logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
/** 一次 DB 写 + 一次(异步)邮件,30s 够 */
export const maxDuration = 30;

const orderSchema = z.object({
  quote: z.object({
    volumeCM3: z.number().positive().max(1_000_000),
    surfaceAreaCM2: z.number().min(0).max(1_000_000),
    dims: z
      .tuple([
        z.number().min(0).max(100_000),
        z.number().min(0).max(100_000),
        z.number().min(0).max(100_000),
      ])
      .refine(([x, y, z]) => x > 0 || y > 0 || z > 0, {
        message: "尺寸不能全为 0",
      }),
    supportWeightG: z.number().min(0).max(1_000_000).nullish(),
    selfSupportRatio: z.number().min(0).max(1_000_000).nullish(),
    /**
     * 交期档位(48 / 72 / 96 小时)—— 加价按小计比例收
     *
     * 服务端会按这个档位**重算**加价,客户端传来的金额一律不信(跟总价
     * 一样)。不传 = 标准档(不额外收费)。
     */
    deliveryTier: z.enum(["standard", "express", "urgent"]).nullish(),
  }),
  modelFileName: z.string().min(1).max(255),
  objectKey: z.string().min(1).max(512),
  modelUrl: z.string().min(1).max(2048),
  modelSizeBytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .nullish(),
  contactName: z.string().min(1).max(60),
  contactPhone: z.string().max(40).nullish(),
  note: z.string().max(1000).nullish(),
  /**
   * 收货地址(id)—— 2026-11-08
   *
   * **只收 id,地址内容由服务端从地址簿解析** —— 归属校验在数据层
   * (`address/queries.ts` 的 `getUserAddress` 按 userId 过滤),客户端带来
   * 什么地址内容都不采信。
   *
   * 工作室要照着单子寄出去,没有收货地址的单子没法开工 —— 所以这一个是
   * **必填**,不是可选。
   */
  addressId: z.string().min(1).max(64),
  /**
   * 这单的邮件通知语言
   *
   * 客户端传当前界面语言(`useLocale()`)。服务端兜底 zh ——
   * 传 "zh-CN" 这种别的值也会落到 zh。
   */
  locale: z.string().max(10).nullish(),
  /**
   * 收款通道(2026-11-05)
   *
   * 不传 = 服务端挑第一个「开放了而且配好了」的通道。传了就用它(得是开放
   * 了的那个)—— 通道没配好时**不拦下单**,只是没有付款入口,工作室走线下
   * 收款。
   */
  channel: z.enum(["wechat", "alipay", "shopify", "stripe"]).nullish(),
});

async function handleList(request: NextRequest) {
  const ip = getClientIp(request);

  // 轮询桶:比下单(strict,3/min)宽松得多
  const rl = await checkRateLimit(ip, "printOrder");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  const user = await getPrintOrderUser();
  if (!user) {
    return NextResponse.json(
      { error: "AUTH_REQUIRED", message: "请先登录" },
      { status: 401, headers: getRateLimitHeaders(rl) }
    );
  }

  // 归属写在 where 里 —— 这里只能拿到当前用户自己的单
  const rows = await listUserPrintOrders(user.id, 50);

  return NextResponse.json(
    { orders: rows.map(toUserPrintOrder) },
    { headers: getRateLimitHeaders(rl) }
  );
}

async function handle(request: NextRequest) {
  const ip = getClientIp(request);

  // 下单比报价严格得多 —— 3 次/分钟,挡住「刷单」和「拿接口压库」
  const rl = await checkRateLimit(ip, "strict");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  // 打印服务要登录
  const user = await getPrintOrderUser();
  if (!user) {
    return NextResponse.json(
      { error: "AUTH_REQUIRED", message: "请先登录" },
      { status: 401, headers: getRateLimitHeaders(rl) }
    );
  }

  // 没配 R2 就没法收模型文件 —— 整条链路不可用,直接拒,
  // 别让人下单成功之后工作室才发现文件没地方取
  if (!isR2Configured()) {
    return NextResponse.json(
      {
        error: "R2_NOT_CONFIGURED",
        message: "文件存储未配置,暂时无法下单",
      },
      { status: 503 }
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

  const parsed = orderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "下单参数不合法",
        issues: parsed.error.issues,
      },
      { status: 400 }
    );
  }

  // 指定的通道现在不可用 → 503,别静默换一个
  //
  // 跟商城结算(`storefront/lib/checkout.ts` 的 `resolveCheckoutChannel`)同一个
  // 口径:客户端点名要一个通道,服务端不能悄悄换成别的 —— 用户以为选了微信
  // 支付、结果跳去了别处,那比直接报错糟得多。
  //
  // 「开放了但没配好」**不在这里拦** —— 那种情况下工单照样建,只是没有付款
  // 入口,工作室走线下收款(见下面「这一步失败不影响下单」)。
  if (parsed.data.channel && !isPaymentChannelEnabled(parsed.data.channel)) {
    return NextResponse.json(
      {
        error: "PAYMENT_CHANNEL_UNAVAILABLE",
        message: "这个支付方式暂时不可用,请换一个或联系工作室",
      },
      { status: 503 }
    );
  }

  const input: PrintOrderRequest = {
    quote: {
      volumeCM3: parsed.data.quote.volumeCM3,
      surfaceAreaCM2: parsed.data.quote.surfaceAreaCM2,
      dims: parsed.data.quote.dims,
      supportWeightG: parsed.data.quote.supportWeightG ?? null,
      selfSupportRatio: parsed.data.quote.selfSupportRatio ?? null,
      deliveryTier: parsed.data.quote.deliveryTier ?? null,
    },
    modelFileName: parsed.data.modelFileName,
    objectKey: parsed.data.objectKey,
    modelUrl: parsed.data.modelUrl,
    modelSizeBytes: parsed.data.modelSizeBytes ?? null,
    contactName: parsed.data.contactName,
    contactPhone: parsed.data.contactPhone ?? null,
    note: parsed.data.note ?? null,
  };

  // 模型文件必须是自己分区里的那一个 —— 别人的文件、伪造的 URL 都不行
  if (!isOwnModelUrl(input.modelUrl, input.objectKey, user.id)) {
    return NextResponse.json(
      {
        error: "INVALID_MODEL_URL",
        message: "模型文件地址不合法",
      },
      { status: 400 }
    );
  }

  // 文件必须真的在桶里 —— 工作室是照着这个链接去取件的,
  // 链接指向一个不存在的对象 = 一张没法开工的工单
  if (!(await objectExists(input.objectKey))) {
    return NextResponse.json(
      {
        error: "MODEL_NOT_FOUND",
        message: "模型文件没找到,请重新上传",
      },
      { status: 422 }
    );
  }

  // 收货地址 —— **归属校验在数据层**
  //
  // 客户端只给地址 id,地址内容由服务端从地址簿取 —— 别人的地址查出来是
  // null(见 `address/queries.ts` 的 `getUserAddress`),客户端带来什么地址
  // 内容都不采信。
  //
  // 为什么必填:工作室要照着单子把成品寄出去,没有收货地址的单子没法开工
  // (2026-11-06 工作室自己提的:旧那条路只收称呼 + 电话,「照着单子寄不
  // 出去」)。
  const addressView = await getUserAddress(user.id, parsed.data.addressId);
  if (!addressView) {
    return NextResponse.json(
      {
        error: "ADDRESS_NOT_FOUND",
        message: "收货地址不存在,请重新选择",
      },
      { status: 404 }
    );
  }

  /** 地址快照 —— 存进订单,用户后来改地址簿不改写历史工单 */
  const shippingAddress: ShippingAddressSnapshot = {
    recipientName: addressView.recipientName,
    phone: addressView.phone,
    province: addressView.province,
    city: addressView.city,
    district: addressView.district,
    detail: addressView.detail,
  };

  // 服务端重算报价 —— 客户端传来的总价一律不信
  //
  // 价从哪儿来:后台 `/admin/print-pricing` 配的值 → `PRINT_*` env → 默认值
  const settings = await getPrintPricingSettings();
  const quote = computePrintQuote(settings, input.quote);
  if (!quote) {
    return NextResponse.json(
      {
        error: "QUOTE_UNAVAILABLE",
        message: "这组几何算不出报价",
      },
      { status: 422 }
    );
  }

  const orderNo = generatePrintOrderNo();
  // 订单语言钉在订单上 —— 之后工作室改状态发的通知邮件用这个语言,
  // 不是「谁点的那个按钮」的语言
  const locale = normalizePrintOrderLocale(parsed.data.locale);

  let row: PrintOrderRow;
  try {
    row = await createPrintOrder({
      orderNo,
      userId: user.id,
      modelFileName: input.modelFileName,
      modelUrl: input.modelUrl,
      modelSizeBytes: input.modelSizeBytes,
      quote,
      contactName: input.contactName,
      // 联系邮箱以账号邮箱为准,不采信客户端
      contactEmail: user.email,
      contactPhone: input.contactPhone,
      note: input.note,
      locale,
      shippingAddress,
    });
  } catch (error) {
    // 23505 = unique_violation —— orderNo 撞车(极小概率)
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        {
          error: "ORDER_NO_CONFLICT",
          message: "订单号冲突,请重试",
        },
        { status: 409 }
      );
    }
    console.error("[PrintOrder] insert failed", error);
    return NextResponse.json(
      {
        error: "CREATE_ORDER_FAILED",
        message: "下单失败,请稍后重试",
      },
      { status: 500 }
    );
  }

  // 通知邮件挂到响应之后发 —— 响应先出去,serverless 冻结也不会丢信,
  // 也不会拖慢下单接口。邮件失败只记日志,不影响订单本身。
  after(async () => {
    await notifyPrintOrderCreated({
      orderNo: row.orderNo,
      contactName: row.contactName,
      contactEmail: row.contactEmail,
      totalPriceCents: row.totalPriceCents,
      modelFileName: row.modelFileName,
      locale: row.locale === "en" ? "en" : "zh",
    });
  });

  // 2026-11-04:建一次支付会话拿付款入口。
  //
  // **这一步失败不影响下单** —— 工单已经在本地建好了,`payment_status` 停在
  // unpaid,用户可以在详情页点「重新获取支付链接」,或者工作室走线下收款。
  // 收款通道没配好就把下单接口打挂,是把一个配置问题变成一条断掉的业务链。
  //
  // 2026-11-05:通道由客户端选(`channel`),或者不传让服务端挑第一个可用的。
  // 旧路(Sellbase + Stripe)不再接新工单 —— 代码还留着,已建好的旧工单还能
  // 重取支付入口。
  const payment = await createPrintOrderPayment(
    row,
    parsed.data.channel ?? null
  );

  return NextResponse.json(
    {
      orderNo,
      quote,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      locale: row.locale,
      /** 付款入口(跳转地址)—— null 表示线上收款没配好,走线下 */
      paymentUrl: payment?.paymentUrl ?? null,
      /** 微信扫码的二维码内容 —— 其他通道是 null */
      paymentQrCodeUrl: payment?.paymentQrCodeUrl ?? null,
      /** 走的是哪条通道 —— null 表示这次没建出付款入口 */
      paymentChannel: payment?.channel ?? null,
      /** 支付状态 */
      paymentStatus: "unpaid",
    },
    { status: 201, headers: getRateLimitHeaders(rl) }
  );
}

/** Postgres 23505 = unique_violation */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export const GET = withApiLogging(handleList);
export const POST = withApiLogging(handle);
