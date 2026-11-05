/**
 * /api/store/addresses/[addressId] —— 改 / 删一条地址
 *
 * 跟 `/api/store/addresses` 同一个理由:小程序没有 server action。
 * 逻辑跟 Web 侧的 server action 共用 `src/features/address/mutations.ts`。
 *
 * - `PATCH` —— 改地址(带 `isDefault: true` 就是「设成默认」)
 * - `DELETE` —— 删地址
 *
 * **归属校验在数据层**:别人的地址一律当「不存在」(404),不是 403 —— 403
 * 等于告诉别人「这个 id 存在」,而 id 是可以枚举的。
 */

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  type AddressErrorCode,
  addressFields,
  deleteAddressForUser,
  updateAddressForUser,
} from "@/features/address/mutations";
import { withApiLogging } from "@/lib/api-logger";
import { getSessionFromRequest } from "@/lib/auth/request-session";
import {
  checkRateLimit,
  createRateLimitResponse,
  getClientIp,
  getRateLimitHeaders,
} from "@/lib/rate-limit";

export const runtime = "nodejs";
/** 一次 DB 写 */
export const maxDuration = 15;

/** PATCH 的 body —— 地址 id 从 URL 来,不在 body 里 */
const patchSchema = z.object({
  ...addressFields,
  isDefault: z.boolean().optional(),
});

function statusForCode(code: AddressErrorCode): number {
  switch (code) {
    case "ADDRESS_NOT_FOUND":
      return 404;
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
    case "INVALID_INPUT":
      return "地址信息不合法";
    default:
      return "操作失败,请稍后重试";
  }
}

/* -------------------------------------------------------------------------- */
/*  PATCH —— 改地址                                                            */
/* -------------------------------------------------------------------------- */

async function handlePatch(
  request: NextRequest,
  context: { params: Promise<{ addressId: string }> }
) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, "storeAddress");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  const { addressId } = await context.params;

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

  const parsed = patchSchema.safeParse(body);
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

  const result = await updateAddressForUser(session.user.id, {
    addressId,
    ...parsed.data,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.code, message: messageForCode(result.code) },
      { status: statusForCode(result.code), headers: getRateLimitHeaders(rl) }
    );
  }

  return NextResponse.json(
    { addressId: result.addressId },
    { headers: getRateLimitHeaders(rl) }
  );
}

export const PATCH = withApiLogging(handlePatch);

/* -------------------------------------------------------------------------- */
/*  DELETE —— 删地址                                                          */
/* -------------------------------------------------------------------------- */

async function handleDelete(
  request: NextRequest,
  context: { params: Promise<{ addressId: string }> }
) {
  const ip = getClientIp(request);
  const rl = await checkRateLimit(ip, "storeAddress");
  if (!rl.success) {
    return createRateLimitResponse(rl);
  }

  const { addressId } = await context.params;

  const session = await getSessionFromRequest(request);
  if (!session?.user.id) {
    return NextResponse.json(
      { error: "AUTH_REQUIRED", message: "请先登录" },
      { status: 401, headers: getRateLimitHeaders(rl) }
    );
  }

  const result = await deleteAddressForUser(session.user.id, addressId);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.code, message: messageForCode(result.code) },
      { status: statusForCode(result.code), headers: getRateLimitHeaders(rl) }
    );
  }

  return NextResponse.json(
    { addressId: result.addressId },
    { headers: getRateLimitHeaders(rl) }
  );
}

export const DELETE = withApiLogging(handleDelete);
