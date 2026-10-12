"use client";

import { useState } from "react";
import { Toaster } from "sonner";

import { MOCK_ORDERS, MOCK_STATES } from "@/features/gpt-image/lib/mock-orders";
import { MockUserOrderView } from "@/features/gpt-image/user/components/mock-user-order-view";

/**
 * 订单页 dev-only 预览 —— 底部固定 mock 状态切换器。
 *
 * 用法：在浏览器打开 `/order-preview`（任意 [locale] 都可以），用底部按钮切换 8 种
 * 订单状态。所有 action handler 都接成 mock（只弹 toast，不发请求）。
 *
 * 注意：本页面**不应该**进入生产构建（放在 `(dev)` 路由组里仅为视觉上不跟 `(marketing)`
 * 混在一起）。如果生产构建需要彻底屏蔽，可加 `process.env.NODE_ENV` 守卫。
 */
export default function OrderPreviewPage() {
  const [activeKey, setActiveKey] = useState(MOCK_STATES[0]?.key ?? "upload1");
  // mock 表里所有 key 都有值；用非空断言 + 兜底 upload1 防止用户传入未知 key
  const order =
    MOCK_ORDERS[activeKey] ??
    (MOCK_ORDERS.upload1 as NonNullable<typeof MOCK_ORDERS.upload1>);

  return (
    <div className="relative">
      {/* mock 视图本身（包含 TopBar + 主内容 + CancelDialog） */}
      <MockUserOrderView order={order} />

      {/* 底部固定 mock 切换器 */}
      <nav
        aria-label="mock 状态切换"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-stone-100 bg-white/85 shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.12)] backdrop-blur-2xl"
      >
        <div className="mx-auto max-w-md overflow-x-auto px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="shrink-0 pr-1 text-[10px] font-semibold tracking-wider text-amber-600 uppercase">
              mock
            </span>
            {MOCK_STATES.map((s) => {
              const active = s.key === activeKey;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveKey(s.key)}
                  aria-pressed={active}
                  className={[
                    "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                    active
                      ? "bg-gradient-to-r from-indigo-500 to-blue-500 text-white shadow-sm"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200",
                  ].join(" ")}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      <Toaster position="top-center" richColors />
    </div>
  );
}
