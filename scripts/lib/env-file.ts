/**
 * 往 `.env.local` / `.env` 写单个变量
 *
 * 已存在同名变量就**替换**那一行,而不是追加 —— 追加会出现两个同名变量,
 * dotenv 取哪个取决于顺序,很容易踩坑(「密钥明明配了却读不到」)。
 *
 * 值里有空格 / 特殊字符时加引号 —— dotenv 会把引号剥掉,Supabase CLI 的
 * env 解析器也能接受(它比 dotenv 严格)。
 */

import { readFile, writeFile } from "node:fs/promises";

/** 需要加引号的值(带空格 / # / 引号 / $ 之类) */
function needsQuotes(value: string): boolean {
  return /[\s#"'$]/.test(value);
}

/**
 * 写一个环境变量到 env 文件
 *
 * @param envPath env 文件路径
 * @param key     变量名
 * @param value   值
 * @param secret  true = 加引号(密钥类,防止被 shell / 解析器搞坏)
 */
export async function upsertEnvVar(
  envPath: string,
  key: string,
  value: string,
  options: { secret?: boolean } = {}
): Promise<void> {
  let content = "";
  try {
    content = await readFile(envPath, "utf8");
  } catch {
    // 文件不存在 —— 从空开始写
  }

  const quoted =
    options.secret === true || needsQuotes(value) ? `"${value}"` : value;
  const line = `${key}=${quoted}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");

  const next = pattern.test(content)
    ? content.replace(pattern, line)
    : `${content}${content.endsWith("\n") || content === "" ? "" : "\n"}${line}\n`;

  await writeFile(envPath, next, "utf8");
}
