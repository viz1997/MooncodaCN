import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { withApiLogging } from "@/lib/api-logger";

/**
 * 3D 打印克重计算器 —— 材料参数解锁校验
 *
 * ## 为什么要走服务端
 *
 * 源项目（wjp-source-code）把材料参数的密码哈希硬编码在客户端 bundle 里
 * （`crypto.ts` 里写死 `moon@2026` 的 SHA-256）。那份代码要发布成公开页，
 * 硬编码哈希等于把密码一起发布出去 —— 任何人都能扒出 bundle 里的哈希并
 * 离线爆破。
 *
 * 所以这里改成：密码只存在于服务端环境变量 `PRICING_MATERIALS_PASSWORD`，
 * 客户端只拿到「是否配置」和「这次输对了没有」两个布尔值。
 *
 * ## 降级行为
 *
 * `PRICING_MATERIALS_PASSWORD` 未配置 → `configured: false` → 前端**不显示**
 * 密码框，材料参数直接可编辑。这是本仓库「可选服务优雅降级」的惯例
 * （见 CLAUDE.md）。生产环境想锁住参数就配这个环境变量。
 *
 * ## 不写库
 *
 * 本路由只做内存中的常量比对，不碰数据库 —— 克重工具整体「只算不存」。
 */

export const runtime = "nodejs";
export const maxDuration = 10;

const bodySchema = z.object({
  password: z.string().min(1).max(256),
});

/** 常量时间比较，避免按字节短路造成的时序侧信道 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // 长度不同也要走一次比较，免得长度本身泄漏信息
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export const GET = withApiLogging(async () => {
  const configured = !!process.env.PRICING_MATERIALS_PASSWORD;
  return Response.json({ configured });
});

export const POST = withApiLogging(async (request: Request) => {
  const expected = process.env.PRICING_MATERIALS_PASSWORD;
  if (!expected) {
    // 未配置密码 → 无需解锁
    return Response.json({ configured: false, ok: true });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ configured: true, ok: false }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ configured: true, ok: false }, { status: 400 });
  }

  const ok = safeEqual(parsed.data.password, expected);
  return Response.json({ configured: true, ok });
});
