/**
 * /image-gen —— 登录用户生图 demo
 *
 * 2026-09-09：原公开 demo 形态恢复，但加登录 gate：
 *   - 未登录访问 → redirect("/sign-in?callbackUrl=/image-gen")
 *   - 登录后 → 渲染 PublicImageGenView（产品效果网格 + 一次性生图）
 *
 * 复用：
 *   - GET  /api/public/generate 拿 active productEffect 列表
 *   - POST /api/public/upload    R2 预签名直传
 *   - POST /api/public/generate  发起生图（同步返图或 taskId）
 *   - GET  /api/image/task/[id]  异步任务轮询
 *
 * 与 workbench 的区别：本页是"一次性体验"——不创建 promptOrder、不扣 credit、
 * 不接订单系统。历史只存浏览器 localStorage（key=mooncoda_public_imagegen_history，
 * 最多 30 条），换浏览器/换账号就丢了；正式下单走 /p/[token] 或工作台 V1。
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PublicImageGenView } from "@/features/image-gen/components/public-image-gen-view";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ImageGenPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/image-gen");
  }

  return <PublicImageGenView />;
}
