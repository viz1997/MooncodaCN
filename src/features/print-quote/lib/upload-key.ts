/**
 * 打印订单模型文件的 R2 对象键 —— **按用户分区**
 *
 * ## 为什么要分区
 *
 * 2026-11-01 之前对象键是 `print-orders/<日期>/<时间戳>-<nanoid>.<ext>`,
 * 下单时只校验「这个 URL 是不是我们自己拼出来的」。这就漏了一个口子:
 * A 用户上传的模型,B 用户拿到 URL 就能下单 —— 工单是 B 的,模型是 A 的,
 * 工作室按 B 的单去生产 A 的文件。
 *
 * 改成按用户分区之后,每个用户只能引用自己目录下的对象,跨用户引用直接拒。
 *
 * ## 为什么用 sha256 而不是裸 userId
 *
 * 模型文件的 URL 是**公开**的(工作室按链接取件),userId 不该出现在里面。
 * 取 sha256 前 16 位既稳定又能区分不同用户,又不泄露账号 id。
 *
 * ## 键的形状
 *
 *   print-orders/<scope>/<YYYY-MM-DD>/<时间戳>-<nanoid10>.<ext>
 *
 * 只有我们自己能生成这种形状 —— 下单时按同一套正则校验,`..` / 空段 /
 * 反斜杠这些路径穿越的原料都进不来。
 */

import { createHash } from "node:crypto";

import { nanoid } from "nanoid";

import { getPublicUrl } from "@/features/image-gen/lib/r2";

/** 对象键的固定前缀 */
const OBJECT_KEY_ROOT = "print-orders";

/**
 * 用户作用域 —— userId 的 sha256 前 16 位
 *
 * 同一个 userId 永远算出同一个值(下单时要拿它跟对象键比对)。
 */
export function printOrderScope(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 16);
}

/**
 * 某个用户的对象键前缀 —— `print-orders/<scope>/`
 *
 * 上传签发和下单校验都用它,保证两边算出来的一定一致。
 */
export function printOrderPrefix(userId: string): string {
  return `${OBJECT_KEY_ROOT}/${printOrderScope(userId)}/`;
}

/**
 * 生成模型文件的对象键
 *
 * @param userId 上传者 —— 决定分区
 * @param ext    文件扩展名(小写,不带点)
 * @param now    日期(测试可注入)
 */
export function buildPrintOrderObjectKey(
  userId: string,
  ext: string,
  now: Date = new Date()
): string {
  const ymd = now.toISOString().slice(0, 10);
  const stamp = now.getTime();
  // nanoid 而不是 Math.random() —— 对象键会出现在公开 URL 里,
  // 猜到别人的键就等于拿到别人的模型
  const rand = nanoid(10);
  return `${printOrderPrefix(userId)}${ymd}/${stamp}-${rand}.${ext}`;
}

/**
 * 校验「模型文件确实是这个用户自己上传的那一个」
 *
 * 三件事都要对:
 *  1. 对象键在这个用户的分区里(别人的文件 → 拒)
 *  2. 剩下的路径段是我们自己生成的形状(`..` / 空段 / 反斜杠 → 拒)
 *  3. URL 跟服务端自己拼出来的一字不差(伪造 URL → 拒)
 *
 * 第 3 条是关键:服务端不信任客户端交上来的 URL,而是自己把 objectKey 拼成
 * URL 再逐字符比。这样域名、路径、归属三件事一次校验完。
 */
export function isOwnModelUrl(
  modelUrl: string,
  objectKey: string,
  userId: string
): boolean {
  const prefix = printOrderPrefix(userId);
  if (!objectKey.startsWith(prefix)) return false;

  // 前缀之后必须是我们自己生成的形状:`<日期>/<时间戳>-<nanoid>.<ext>`
  const rest = objectKey.slice(prefix.length);
  if (!/^[\w-]+\/[\w.-]+\.[a-z0-9]+$/.test(rest)) return false;

  return getPublicUrl(objectKey) === modelUrl;
}
