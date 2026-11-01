/**
 * POST /api/print-orders —— 打印服务下单
 *
 * 匿名可下(跟商城的匿名定制一致)。用户带自己的 3D 模型来,按克重计价,
 * 工作室按这份工单生产。
 *
 * ## 服务端重算价格
 *
 * 客户端会带着它自己算的报价来,但**这里不信** —— 只取几何和支撑信息,
 * 用 `computePrintQuote()` 重算一遍,落库的是重算结果。跟商城购物车
 * 每次加购都重算 `calculatePricing()` 是同一个道理:客户端能被改。
 *
 * ## 模型文件
 *
 * 模型已经由客户端直传到 R2(`/api/print-orders/upload-url` 签的 URL),
 * 这里只收 `modelUrl`。不收字节 —— Vercel function 4.5MB 请求体上限
 * 装不下模型文件。
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getPublicUrl,
  isR2Configured,
  objectExists,
} from "@/features/image-gen/lib/r2";
import { createPrintOrder } from "@/features/print-quote/lib/order-store";
import {
  computePrintQuote,
  generatePrintOrderNo,
  generatePrintOrderToken,
} from "@/features/print-quote/lib/quote-server";
import type { PrintOrderRequest } from "@/features/print-quote/lib/quote-types";
import { withApiLogging } from "@/lib/api-logger";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
/** 一次 DB 写,30s 够 */
export const maxDuration = 30;

/**
 * R2 公共桶里的对象路径前缀 —— 模型文件必须落在自己的目录下。
 *
 * 不校验的话,这个接口能存任意链接,工作室照着链接去取件会打到站外。
 */
const MODEL_URL_PREFIX = "print-orders/";

/**
 * 校验「模型文件确实是我们自己签发的那一个」。
 *
 * ## 为什么不能只查 modelUrl 里有 "print-orders/" 这段字符串
 *
 * `includes` 是子串匹配 —— `https://attacker.example.com/print-orders/x.zip`
 * 一样能过。所以这里反过来做:**服务端自己把 objectKey 拼成 URL**,
 * 要求客户端交上来的 modelUrl 跟它**逐字符相等**。
 *
 * 这样一来:
 *  - 域名不用单独判(拼出来的就是自己的桶)
 *  - 路径不用单独判(拼出来的就是 print-orders/ 下面)
 *  - 客户端就算伪造 modelUrl,也对不上服务端算出来的那个
 */
function isOwnModelUrl(modelUrl: string, objectKey: string): boolean {
  if (!objectKey.startsWith(MODEL_URL_PREFIX)) return false;
  // objectKey 只能由我们自己生成:`print-orders/<日期>/<时间戳>-<nanoid>.<ext>`
  // 不允许出现 `..` / 空段 / 反斜杠 —— 这些是路径穿越的原料
  if (!/^print-orders\/[\w-]+\/[\w.-]+\.[a-z0-9]+$/.test(objectKey))
    return false;
  return getPublicUrl(objectKey) === modelUrl;
}

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
  contactEmail: z.string().email().max(200),
  contactPhone: z.string().max(40).nullish(),
  note: z.string().max(1000).nullish(),
});

async function handle(request: NextRequest) {
  const ip = getClientIp(request);

  // 下单比报价严格得多 —— 3 次/分钟,挡住「刷单」和「拿接口压库」
  const rl = await checkRateLimit(ip, "strict");
  if (!rl.success) {
    return createRateLimitResponse(rl);
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

  const input: PrintOrderRequest = {
    quote: {
      volumeCM3: parsed.data.quote.volumeCM3,
      surfaceAreaCM2: parsed.data.quote.surfaceAreaCM2,
      dims: parsed.data.quote.dims,
      supportWeightG: parsed.data.quote.supportWeightG ?? null,
      selfSupportRatio: parsed.data.quote.selfSupportRatio ?? null,
    },
    modelFileName: parsed.data.modelFileName,
    objectKey: parsed.data.objectKey,
    modelUrl: parsed.data.modelUrl,
    modelSizeBytes: parsed.data.modelSizeBytes ?? null,
    contactName: parsed.data.contactName,
    contactEmail: parsed.data.contactEmail,
    contactPhone: parsed.data.contactPhone ?? null,
    note: parsed.data.note ?? null,
  };

  if (!isOwnModelUrl(input.modelUrl, input.objectKey)) {
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

  // 服务端重算报价 —— 客户端传来的总价一律不信
  const quote = computePrintQuote(input.quote);
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
  const token = generatePrintOrderToken();

  try {
    await createPrintOrder({
      orderNo,
      accessToken: token,
      modelFileName: input.modelFileName,
      modelUrl: input.modelUrl,
      modelSizeBytes: input.modelSizeBytes,
      quote,
      contactName: input.contactName,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      note: input.note,
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

  return NextResponse.json(
    {
      orderNo,
      token,
      quote,
      createdAt: new Date().toISOString(),
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

export const POST = withApiLogging(handle);
