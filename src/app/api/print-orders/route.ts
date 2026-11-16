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
 *
 * ## 建单幂等(2026-11-16)
 *
 * 重复提交会建出**两张工单**,两张各有各的付款入口 ⇒ **用户可能付两次钱**。
 * 客户端那道软闸(提交中禁用按钮 + 限流 3 次/分钟)挡不住 —— 网络卡了重试 /
 * 双击 / 没看到跳转又点一次,都会过去。
 *
 * ⇒ 服务端按 **(用户, 幂等键)** 认单:
 *
 * - 键 = 「**除了上传产物以外的一切下单意图**」的**内容哈希**
 *   (见 `print-quote/lib/idempotency.ts`)
 * - 命中 ⇒ **返回第一次建的那张单**(200)—— 不重复发邮件、不重复记用券、
 *   **不重建微信 Native 会话**(微信的 `code_url` 不能重建,第二次建会被拒)
 * - 查表放在**通道检查 / 券判定 / 报价计算之前** —— 重试不该因为「券过期了」
 *   「通道挂了」而失败
 * - 数据库层面有**唯一索引**兜底 ⇒ 并发提交里只有一张能落库,另一张撞
 *   `23505` ⇒ 回查那一行,把它返给用户
 *
 * ### ⚠️ 取舍:用户**故意**下两张一模一样的单,会被吞成一张
 *
 * 「一模一样」在钱的角度看就是同一单。要真下两张不同的单,改一项就行
 * (换交期档位 / 换优惠码 / 改备注……)。「同一模型打印多件」是**另一个需求**
 * (要打三件,不是要下三单),那靠**数量字段**解决 —— 数量进意图 ⇒ 键不同。
 */

import { after, type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import type { PrintOrderRow, ShippingAddressSnapshot } from "@/db/schema";
import { getUserAddress } from "@/features/address/queries";
import { evaluateCoupon } from "@/features/coupon/lib/coupon-service";
import {
  CouponUsageLimitError,
  redeemCoupon,
} from "@/features/coupon/lib/coupon-store";
import { isR2Configured, objectExists } from "@/features/image-gen/lib/r2";
import { isPaymentChannelEnabled } from "@/features/payments/lib/registry";
import { checkReliefTier } from "@/features/pricing/lib/relief-detect";
import { getPrintOrderUser } from "@/features/print-quote/lib/auth";
import { printCouponBaseCents } from "@/features/print-quote/lib/coupon-base";
import { computePrintOrderIdempotencyKey } from "@/features/print-quote/lib/idempotency";
import { notifyPrintOrderCreated } from "@/features/print-quote/lib/notifications";
import {
  createPrintOrder,
  findPrintOrderByIdempotencyKey,
  listUserPrintOrders,
  toUserPrintOrder,
} from "@/features/print-quote/lib/order-store";
import { createPrintOrderPayment } from "@/features/print-quote/lib/payment";
import { getPrintPricingSettings } from "@/features/print-quote/lib/pricing-store";
import {
  buildPublicQuoteFromStoredOrder,
  toPublicQuote,
} from "@/features/print-quote/lib/quote-public";
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
  type RateLimitResult,
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
    /**
     * 托底档位(2026-11-15)—— `relief`(浮雕,托底 1mm)/ `figurine`(手办,托底 5mm)
     *
     * **这是「自洽性」的凭据,不是重算的依据** —— 服务端不重新算支撑体积
     * (几何不上传),它拿的是 `supportWeightG`。所以这一项只用来跟服务端按
     * `dims` 判定出来的那一档**对一下**:对不上 ⇒ 409,不建单。
     *
     * 不传 = 老客户端 ⇒ 按服务端自己判定的那一档走,不报错。
     */
    reliefKind: z.enum(["relief", "figurine"]).nullish(),
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
  /**
   * 优惠码(2026-11-08)
   *
   * 传了 = 让服务端算一下这张码在这单上能减多少。**码本身不带钱** ——
   * 折扣是服务端算的,客户端传来的任何金额一律不信(跟总价一样)。
   *
   * 券不可用 → **400 + 精确原因码**,不建单。悄悄按原价收是坑用户 ——
   * 用户会问「我的码呢」。
   */
  couponCode: z.string().max(64).nullish(),
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

  /**
   * **建单幂等**(2026-11-16)—— 查表放在**通道检查 / 券判定 / 报价计算之前**
   *
   * ## 为什么放这么早
   *
   * 重复提交的那一次,**应该直接返回第一次建的那张单** —— 不该再走一遍
   * 「通道还开着吗」「券还有效吗」「价还是这个价吗」「模型还在桶里吗」。
   *
   * 那些检查**都会因为时间推移而失败**:
   *
   * - 券过期了 ⇒ 第二次提交报「这个优惠码用不了」—— 但第一张单已经建了,
   *   用户看着像没下成
   * - 通道临时挂了 ⇒ 第二次提交 503 —— 第一张单明明在
   * - 模型文件被清掉 ⇒ 第二次提交 422
   *
   * ⇒ 幂等查表**只**依赖「登录用户 + 请求意图」,不依赖任何会变的东西。
   *
   * ## 键是**内容哈希**
   *
   * 见 `print-quote/lib/idempotency.ts` 的文件头 —— 键里**故意不含**
   * `objectKey` / `modelUrl`(每次上传都变)、`channel`(换通道重下也是同一单)。
   */
  const idempotencyKey = computePrintOrderIdempotencyKey({
    modelFileName: parsed.data.modelFileName,
    modelSizeBytes: parsed.data.modelSizeBytes ?? null,
    volumeCM3: parsed.data.quote.volumeCM3,
    surfaceAreaCM2: parsed.data.quote.surfaceAreaCM2,
    dims: parsed.data.quote.dims,
    supportWeightG: parsed.data.quote.supportWeightG ?? null,
    selfSupportRatio: parsed.data.quote.selfSupportRatio ?? null,
    deliveryTier: parsed.data.quote.deliveryTier ?? null,
    reliefKind: parsed.data.quote.reliefKind ?? null,
    contactName: parsed.data.contactName,
    contactPhone: parsed.data.contactPhone ?? null,
    note: parsed.data.note ?? null,
    addressId: parsed.data.addressId,
    couponCode: parsed.data.couponCode ?? null,
  });

  const existing = await findPrintOrderByIdempotencyKey(
    user.id,
    idempotencyKey
  );
  if (existing) {
    // **200**,不是 201 —— 这一单**已经建好了**,不是新建了一张
    return await respondWithExistingPrintOrder(existing, rl);
  }

  // 没配 R2 就没法收模型文件 —— 整条链路不可用,直接拒,
  // 别让人下单成功之后工作室才发现文件没地方取
  //
  // ⚠️ 这道闸在**幂等查表之后** —— 重试的那一次不该因为「R2 现在没配好」
  // 而失败(第一次已经建成了)。
  if (!isR2Configured()) {
    return NextResponse.json(
      {
        error: "R2_NOT_CONFIGURED",
        message: "文件存储未配置,暂时无法下单",
      },
      { status: 503 }
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
      reliefKind: parsed.data.quote.reliefKind ?? null,
    },
    modelFileName: parsed.data.modelFileName,
    objectKey: parsed.data.objectKey,
    modelUrl: parsed.data.modelUrl,
    modelSizeBytes: parsed.data.modelSizeBytes ?? null,
    contactName: parsed.data.contactName,
    contactPhone: parsed.data.contactPhone ?? null,
    note: parsed.data.note ?? null,
  };

  /**
   * 托底档位的**自洽性检查**(2026-11-15)
   *
   * 客户端报的档位跟服务端按 `dims` 判定的那一档对不上 ⇒ 409,不建单。
   *
   * 只挡一个方向 —— 「报浮雕、但尺寸判定是手办」(托底低 ⇒ 支撑少 ⇒
   * **少收支撑费**)。反过来(报手办、判成浮雕)是**多收**,放行。
   *
   * 老实客户端**撞不到**这道闸:它报的档位就是按同一组 `dims` 判出来的,
   * 而且「浮雕」那一档在几何不像浮雕时是禁用的(用户点不着)。
   */
  const reliefTier = checkReliefTier(input.quote.dims, input.quote.reliefKind);
  if (!reliefTier.ok) {
    return NextResponse.json(
      {
        error: "RELIEF_TIER_MISMATCH",
        message: "托底档位跟尺寸对不上,这一单按手办那档算",
        kind: reliefTier.kind,
      },
      { status: 409 }
    );
  }

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

  /**
   * 优惠码(2026-11-08)
   *
   * **在报价之后算,在建单之前算** —— 报价不认优惠(报价是「这活要多少料多少
   * 钱」,优惠是「这一单便宜多少」)。
   *
   * 基数 = 报价合计 − 交期加价(加急费不参与优惠,跟运费一个待遇)。
   * 跟报价预览走的是**同一个** `printCouponBaseCents()` —— 两处各算一遍
   * 迟早对不上(用户会看到「预览减 ¥20、提交减 ¥18」)。
   */
  const coupon = parsed.data.couponCode
    ? await evaluateCoupon({
        code: parsed.data.couponCode,
        orderKind: "print",
        couponBaseCents: printCouponBaseCents(quote),
        // 打印工单没有运费行 —— 免运费券在这儿会被直接拒掉
        shippingCents: 0,
        resolveUserId: async () => user.id,
      })
    : null;

  // 券不可用 → **不建单**,把精确原因码带给界面
  //
  // 悄悄按原价收是坑用户 —— 用户会问「我的码呢」。界面拿到码之后说人话
  // (见 `print-order-error.ts`)。
  if (coupon?.error) {
    return NextResponse.json(
      {
        error: coupon.error,
        message: "这个优惠码用不了",
      },
      { status: 400, headers: getRateLimitHeaders(rl) }
    );
  }

  const couponCode = coupon?.coupon?.code ?? null;
  const couponDiscountCents = coupon?.coupon?.discountCents ?? 0;

  let row: PrintOrderRow;
  try {
    /**
     * 建单 + 记一次用券 —— **同一个事务**(2026-11-08)
     *
     * 券的总量上限是**硬闸**:额度满了就**不让这一单成立**(回滚),而不是
     * 「单建了、券超发一次」。超发一次 = 工作室的预算多让出去一次。
     *
     * 幂等靠 `coupon_redemption` 的唯一索引 `(order_kind, order_id)`:
     * 同一张单重投不会把用量加两遍。
     */
    row = await db.transaction(async (tx) => {
      const created = await createPrintOrder(
        {
          orderNo,
          userId: user.id,
          // 幂等键 —— 数据库层面的唯一索引兜底(2026-11-16)
          idempotencyKey,
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
          couponCode,
          couponDiscountCents,
        },
        tx
      );

      // **有券就记** —— 不看折扣是不是 0
      //
      // 折扣 0 的券(比如免运费券)也是**用了这张券**:不记,额度就少算一次,
      // 同一张券会被用出去比上限多一次。两口子(商城 / 打印)口径必须一样。
      if (coupon?.coupon) {
        await redeemCoupon({
          couponId: coupon.coupon.couponId,
          userId: user.id,
          orderKind: "print",
          orderId: created.id,
          discountCents: couponDiscountCents,
          usageLimit: coupon.coupon.usageLimit,
          tx,
        });
      }

      return created;
    });
  } catch (error) {
    // 额度满了 → 这一单不成立(事务已经回滚)
    if (error instanceof CouponUsageLimitError) {
      return NextResponse.json(
        {
          error: "COUPON_LIMIT_REACHED",
          message: "这个优惠码已经用完了",
        },
        { status: 400, headers: getRateLimitHeaders(rl) }
      );
    }
    // 23505 = unique_violation —— 两种撞法,处理方式**完全不同**
    //
    // ① **幂等键撞了** —— 并发提交:两个请求同时查到「还没有这张单」,两个
    //    都去建,数据库唯一索引只让**一个**落库。⇒ 这不是错误,是**重复提交**
    //    ⇒ 回查那一行,把它返给用户(200)
    //
    // ② **订单号撞了** —— `order_no` 撞车(极小概率,6 位随机数 + 日期)
    //    ⇒ 409,让用户重试
    //
    // ⚠️ 并发那一种,对方的事务**可能还没提交** ⇒ 回查查不到 ⇒ 落到 ②。
    // 那就让用户再点一次 —— 第二次一定能命中幂等表。
    if (isUniqueViolation(error)) {
      const raced = await findPrintOrderByIdempotencyKey(
        user.id,
        idempotencyKey
      );
      if (raced) {
        return await respondWithExistingPrintOrder(raced, rl);
      }
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
      /**
       * **对外形状** —— 单价(¥4.50/g 那一栏)一个字节都不出去
       *
       * 工作室 2026-11-16 的要求:「不要展示 4.5 元/g 这种单价,避免暴露
       * 我们的成本」。上面那份内部报价照旧留着(建单 + 留档 + 优惠基数都用
       * 它),只在**出服务器之前**投影一次(见 `quote-public.ts`)。
       */
      quote: toPublicQuote(quote),
      /** 优惠码(2026-11-08)—— null = 没用券 */
      couponCode: row.couponCode,
      /** 这一单减了多少(分)—— 0 = 没用券 */
      couponDiscountCents: row.couponDiscountCents,
      /** 应付净额(分)—— 收银台按这个数收 */
      payableCents: row.totalPriceCents,
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

/**
 * **幂等命中** —— 返回**第一次建的那张单**(2026-11-16)
 *
 * ## 响应体跟首次建单**逐字同形**
 *
 * 客户端解析的是同一个形状(`PrintOrderCreated`)⇒ 幂等命中那条路必须
 * 给出**同样的键、同样的语义**。少一个键,客户端就会 `undefined` 一片。
 *
 * ## ⚠️ 跟首次建单那三条**不一样**
 *
 * | | 首次(201) | 幂等命中(200) |
 * |---|---|---|
 * | 报价 | `toPublicQuote(quote)`(现算的) | `buildPublicQuoteFromStoredOrder(row, …)`(从库里重建的) |
 * | 付款入口 | `payment?.paymentUrl`(刚建出来的会话) | `row.paymentUrl`(**存下来的**那一个) |
 * | 支付状态 | 硬编码 `"unpaid"` | `row.paymentStatus`(**行上的真值**) |
 *
 * ### 为什么付款入口是「存下来的」那一个
 *
 * **微信 Native 的 `code_url` 不能重建** —— `out_trade_no` 在微信侧唯一,
 * 第二次建 Native 会话会被拒(`OUT_TRADE_NO_USED`)。
 *
 * ⇒ 重试时**只能把存下来的那一个再给一次**,不能重新建。
 *
 * ## ⚠️ **不发邮件、不重复记用券**
 *
 * 幂等命中 = 第一次已经发过邮件、已经记过一次用券了。再来一次 ⇒ 用户收到
 * 两封「你的工单已创建」、券的用量被加两遍(额度少算一次 ⇒ 券被超发)。
 *
 * ⇒ 这条路**不调** `notifyPrintOrderCreated`,也**不调** `redeemCoupon`。
 *
 * ## `deliveryRates` 没落库 —— 现取一次
 *
 * 它只影响前端交期选择器的**预览**(加价金额早就算好、落库了)。
 */
async function respondWithExistingPrintOrder(
  row: PrintOrderRow,
  rl: RateLimitResult
): Promise<NextResponse> {
  const settings = await getPrintPricingSettings();

  return NextResponse.json(
    {
      orderNo: row.orderNo,
      /** 对外形状 —— 单价一个字节都不出去(见 `quote-public.ts`) */
      quote: buildPublicQuoteFromStoredOrder(row, settings.deliveryRates),
      /** 优惠码 —— null = 没用券 */
      couponCode: row.couponCode,
      /** 这一单减了多少(分) */
      couponDiscountCents: row.couponDiscountCents,
      /** 应付净额(分)—— 收银台按这个数收 */
      payableCents: row.totalPriceCents,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      locale: row.locale,
      /** 付款入口 —— **存下来的那一个**(微信的码不能重建) */
      paymentUrl: row.paymentUrl,
      /** 微信扫码的二维码内容 */
      paymentQrCodeUrl: row.paymentQrCodeUrl,
      /** 走的是哪条通道 */
      paymentChannel: row.paymentChannel,
      /** 支付状态 —— **行上的真值**(第一次建单时硬编码 unpaid,这里不能) */
      paymentStatus: row.paymentStatus,
    },
    { status: 200, headers: getRateLimitHeaders(rl) }
  );
}

export const GET = withApiLogging(handleList);
export const POST = withApiLogging(handle);
