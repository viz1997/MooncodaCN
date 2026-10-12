"use client";

import { ArrowLeft, XCircle } from "lucide-react";

import { Link } from "@/i18n/routing";

/**
 * 订单已取消 —— 居中提示卡（mobile-first 单列内 max-w-md 范围内）。
 */
export function CancelledPanel({
  cancelledAt,
}: {
  cancelledAt: string | null;
}) {
  const time = cancelledAt
    ? new Date(cancelledAt).toLocaleString("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <section className="flex flex-col items-center px-5 pt-16 pb-10 animate-[fadeIn_.3s_ease-out]">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-stone-100">
        <XCircle className="h-7 w-7 text-stone-400" strokeWidth={1.75} />
      </div>
      <h2 className="text-xl font-bold text-stone-900">订单已取消</h2>
      {time && <p className="mt-1 text-sm text-stone-400">{time}</p>}
      <p className="mt-3 max-w-xs text-center text-sm text-stone-500">
        如需重新下单，请联系服务方重新发送链接。
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-xl bg-stone-100 px-4 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
      >
        <ArrowLeft className="h-4 w-4" />
        返回首页
      </Link>
    </section>
  );
}
