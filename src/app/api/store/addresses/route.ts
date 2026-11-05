/**
 * /api/store/addresses —— 收货地址簿(HTTP 版)
 *
 * ## 为什么已经有 server action 还要 HTTP 路由
 *
 * Web 侧的地址簿走 `src/features/address/actions.ts`(server action)。
 * 小程序没有 server action —— 它只能发 HTTP 请求。结算那一步要一个
 * `addressId`,小程序得有个地方拿得到。
 *
 * 两条路共用 `src/features/address/mutations.ts` 里的同一份逻辑,校验规则
 * 和「默认地址只有一个」的约束不会走偏。
 *
 * ## 认证
 *
 * `Authorization: Bearer <token>`(小程序)或者 Better Auth 的签名
 * cookie(浏览器)—— 见 `getSessionFromRequest`。
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  type AddressErrorCode,
  createAddressForUser,
  createAddressSchema,
} from "@/features/address/mutations";
import { listUserAddresses } from "@/features/address/queries";
import { withApiLogging } from "@/lib/api-logger";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
/** 一次 DB 查询 */
export const maxDuration = 15;

/** 写操作的错误码 → HTTP 状态 */
function statusForCode(code: AddressErrorCode): number {
  switch (code) {
    case "ADDRESS_NOT_FOUND":
      return 404;
    case "TOO_MANY_ADDRESSES":
      return 429;
    case "INVALID_INPUT":
      return 400;
    default:
      return 500;
  }
}

function messageForCode(code: AddressErrorCode): string {
  switch (code) {
    case "ADDRESS_NOT_FOUND":
      return "地址不存在";
    case "TOO_MANY_ADDRESSES":
      return "地址存太多了,先删几个";
    case "INVALID_INPUT":
      return "地址信息不合法";
    default:
      return "操作失败,请稍后重试";
  }
}

/* -------------------------------------------------------------------------- */
/*  GET —— 列地址簿                                                           */
/* -------------------------------------------------------------------------- */

async function handleGet(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, "storeAddress");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  const session = await getSessionFromRequest(request);
  if (!session?.user.id) {
    return NextResponse.json(
      { error: "AUTH_REQUIRED", message: "请先登录" },
      { status: 401, headers: getRateLimitHeaders(rl) }
    );
  }

  const addresses = await listUserAddresses(session.user.id);

  return NextResponse.json({ addresses }, { headers: getRateLimitHeaders(rl) });
}

export const GET = withApiLogging(handleGet);

/* -------------------------------------------------------------------------- */
/*  POST —— 新建地址                                                          */
/* -------------------------------------------------------------------------- */

async function handlePost(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, "storeAddress");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  const session = await getSessionFromRequest(request);
  if (!session?.user.id) {
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
      { status: 400, headers: getRateLimitHeaders(rl) }
    );
  }

  const parsed = createAddressSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "INVALID_INPUT",
        message: "地址信息不合法",
        issues: parsed.error.issues,
      },
      { status: 400, headers: getRateLimitHeaders(rl) }
    );
  }

  const result = await createAddressForUser(session.user.id, parsed.data);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.code, message: messageForCode(result.code) },
      { status: statusForCode(result.code), headers: getRateLimitHeaders(rl) }
    );
  }

  return NextResponse.json(
    { addressId: result.addressId },
    { status: 201, headers: getRateLimitHeaders(rl) }
  );
}

export const POST = withApiLogging(handlePost);
