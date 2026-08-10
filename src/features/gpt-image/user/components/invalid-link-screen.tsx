"use client";

import { ArrowLeft, Link2 } from "lucide-react";

import { Link } from "@/i18n/routing";

/**
 * token 无效或订单不存在 —— 居中提示卡。
 */
export function InvalidLinkScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fafafa] px-5">
      <div className="w-full max-w-xs rounded-2xl border border-stone-100 bg-white p-8 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-500">
          <Link2 className="h-5 w-5" strokeWidth={2} />
        </span>
        <h2 className="text-base font-semibold tracking-tight text-stone-900">
          链接无效
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-stone-500">
          订单不存在或链接已失效。请确认链接是否完整，或联系为你创建订单的服务方。
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-xl bg-stone-100 px-4 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
        >
          <ArrowLeft className="h-4 w-4" />
          返回首页
        </Link>
      </div>
    </div>
  );
}
