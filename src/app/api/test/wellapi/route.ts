/**
 * Dev only - 测试 wellapi gpt-image-2 编辑接口
 * POST /api/test/wellapi
 *
 * 多部分表单（multipart/form-data）：
 * - image: 必填，要编辑的图片（png/webp/jpg，<25MB）
 * - prompt: 必填，文本描述
 * - n: 可选，1-10，默认 1
 * - size: 可选，1024x1024 / 1536x1024 / 1024x1536 / auto，默认 auto
 *
 * 响应：直接转发 wellapi 的 JSON；非 2xx 时附 status/text 方便排查。
 *
 * 鉴权：复用 protectedAction 的会话校验（任何登录用户可调）。
 */

import { type NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";

const WELLAPI_BASE = "https://wellapi.ai/v1";
const API_KEY = process.env.LINGTING_API_KEY;

export const runtime = "nodejs";
// Vercel 计划上限：Hobby 60s / Pro 300s / Enterprise 800s
// wellapi gpt-image-2 n=1 约 5-30s，n=4 约 60-120s，单次同步调用不适合 serverless。
// 设 300 让 Pro 用户能跑 n=4；Hobby 用户照样会被 Vercel 在 60s 砍，我们会在
// catch 里给清晰提示（"operation aborted due to timeout" 通常是 Vercel 砍了，
// 而不是 wellapi 自己超时）。
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: "未登录" },
      { status: 401 }
    );
  }

  if (!API_KEY) {
    return NextResponse.json(
      { success: false, error: "LINGTING_API_KEY 未配置" },
      { status: 500 }
    );
  }

  const form = await req.formData();
  const image = form.get("image");
  const prompt = form.get("prompt");
  const n = form.get("n") ?? "1";
  const size = form.get("size") ?? "auto";

  if (!(image instanceof File)) {
    return NextResponse.json(
      { success: false, error: "缺少 image 文件" },
      { status: 400 }
    );
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    return NextResponse.json(
      { success: false, error: "缺少 prompt" },
      { status: 400 }
    );
  }
  if (image.size > 25 * 1024 * 1024) {
    return NextResponse.json(
      { success: false, error: "图片超过 25MB" },
      { status: 400 }
    );
  }

  // 构造 wellapi 请求（multipart/form-data）
  const wellapiForm = new FormData();
  wellapiForm.append(
    "image",
    new Blob([await image.arrayBuffer()], { type: image.type }),
    image.name
  );
  wellapiForm.append("prompt", prompt);
  wellapiForm.append("model", "gpt-image-2");
  wellapiForm.append("n", String(n));
  wellapiForm.append("size", String(size));

  try {
    const upstream = await fetch(`${WELLAPI_BASE}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: wellapiForm,
      // 单图 30s / 多图 120s 都够；超过 240s 视为死掉。
      // 注：如果 Vercel 在此之前砍函数（Hobby 60s / Pro 300s），fetch 会被
      // 中断并抛同样的 "aborted" 错误，下面 catch 给用户提示。
      signal: AbortSignal.timeout(240_000),
    });

    // wellapi 偶尔会返 HTML（500 错误页），先按 text 读一遍再尝试 parse
    const text = await upstream.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 2000) };
    }

    return NextResponse.json(
      {
        success: upstream.ok,
        status: upstream.status,
        statusText: upstream.statusText,
        data: payload,
      },
      { status: upstream.ok ? 200 : 502 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "网络错误";
    // 给清晰的根因提示：要么 Vercel 砍了函数，要么真的 240s 还没回。
    const isAbort = err instanceof Error && err.name === "AbortError";
    const hint = isAbort
      ? "（请求超时。可能原因：① wellapi gpt-image-2 n=4 跑得太慢（60-120s+）；② Vercel 计划函数上限已到 —— Hobby 60s / Pro 300s / Enterprise 800s，建议先试 n=1 或升级到 Pro）"
      : "";
    return NextResponse.json(
      {
        success: false,
        error: `wellapi 调用失败：${msg}${hint}`,
        hint: isAbort
          ? "Vercel 计划上限？尝试 n=1 / 小图，或在 Vercel Dashboard 确认 plan。"
          : undefined,
      },
      { status: 502 }
    );
  }
}
