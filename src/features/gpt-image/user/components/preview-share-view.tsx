"use client";

/**
 * /p/[token] preview 凭证客人视图（2026-09-13）
 *
 * 适用场景：page.tsx 入口按 token 查 preview_share 命中后渲染本组件。
 * 内部直接渲染 PreviewConfirmStep + 简化 TopBar（不显示 status pill / cancel，
 * 因为 preview 凭证不支持取消）+ 外层 min-h-screen 容器。
 *
 * 与 UserOrderView 的关系：
 *   - UserOrderView 走 promptOrder 路径，本组件走 preview_share 路径，两套
 *     数据独立，互不串扰。
 *   - 客人点「确认下单」成功后 → 路由 NEW INSERT promptOrder + UPDATE
 *     preview_share.status='confirmed' + linkedOrderId=新订单 id；本组件
 *     onConfirmed 回调 → router.replace(/p/{token}) 让 RSC 重新跑 page.tsx
 *     的 lookup → status='confirmed' → redirect 到 linkedOrderId 的 SELECTED 视图。
 *
 * 布局与 UserOrderView 对齐：bg-[#fafafa]、max-w-md 居中、品牌脚注，
 * 让 preview / 普通订单视觉风格一致（避免客人看到不同页面以为是两个产品）。
 */

import { useRouter } from "@/i18n/routing";
import { PreviewConfirmStep } from "./preview-confirm-step";

interface PreviewShareViewProps {
  token: string;
  /** preview 凭证号 IG-YYYYMMDD-XXXXXX（不是 promptOrder 订单号） */
  previewOrderNo: string;
  updatedAt: string;
  candidateCount: number;
  outputMode: "grid" | "separate";
  templateName: string;
  productTypeCode: string | null;
  productSize: string | null;
  accessoryCode: string | null;
  engravingText: string | null;
  engravingExposed: boolean | null;
  leatherColor: string | null;
  leatherExposed: boolean | null;
  pvcProtection: boolean | null;
  remarks: string | null;
  platform: string | null;
}

export function PreviewShareView(props: PreviewShareViewProps) {
  const router = useRouter();

  return (
    <div className="flex min-h-screen flex-col bg-[#fafafa]">
      {/* 简化 TopBar —— preview 流不显示 status pill（只有 pending 一态）
          与 cancel 按钮（preview 不支持取消，凭证由代理商在 /image-gen/orders
          自己取消，客人侧只看到"待确认"状态）。只保留预览凭证号 + 模板名。 */}
      <header className="sticky top-0 z-30 bg-[#fafafa]">
        <div className="mx-auto flex h-14 max-w-md items-center gap-3 px-5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-tight text-stone-900">
              {props.templateName}
            </p>
            <p className="truncate text-xs text-stone-400">
              预览凭证 · {props.previewOrderNo}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-600">
            待确认
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-32">
        <PreviewConfirmStep
          token={props.token}
          orderNo={props.previewOrderNo}
          updatedAt={props.updatedAt}
          candidateCount={props.candidateCount}
          outputMode={props.outputMode}
          templateName={props.templateName}
          productTypeCode={props.productTypeCode}
          productSize={props.productSize}
          accessoryCode={props.accessoryCode}
          engravingText={props.engravingText}
          engravingExposed={props.engravingExposed}
          leatherColor={props.leatherColor}
          leatherExposed={props.leatherExposed}
          pvcProtection={props.pvcProtection}
          remarks={props.remarks}
          platform={props.platform}
          onConfirmed={() => {
            // 重新跑 page.tsx 的 server-side lookup：
            //   status='confirmed' + linkedOrderId  → redirect 到 SELECTED 视图
            //   避免客户端硬拼新 token（preview 流不再暴露新订单的 token）
            router.replace(`/p/${props.token}`);
          }}
        />
      </main>

      {/* 品牌脚注 —— 与 UserOrderView 对齐，保持视觉一致 */}
      <div className="mt-12 flex items-center justify-center gap-1.5 pb-2 text-center text-xs font-medium leading-none text-stone-400">
        <img src="/logo.svg" alt="Mooncoda" className="h-4 w-4 shrink-0" />
        <span className="tracking-tight">Mooncoda梦可达</span>
        <span className="text-stone-300">·</span>
        <span>提供定制服务</span>
      </div>
    </div>
  );
}
