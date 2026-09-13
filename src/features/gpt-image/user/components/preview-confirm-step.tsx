"use client";

/**
 * /p/[token] preview 凭证客人「确认下单」视图（2026-09-13）
 *
 * 适用场景：/p/[token] 入口 page.tsx 按 token 查 preview_share 命中后渲染本组件
 * （PreviewShareView 包装）。preview 凭证已在独立 preview_share 表承载，
 * 不再混入 promptOrder 行 —— 分享链接 ≠ 下单。
 *
 * 业务流程：代理商在 /image-gen demo 流点「分享给客户预览」→ createPreviewShareAction
 * 写 preview_share（status='pending'，不扣 credit）。客户扫码进 /p/{token} →
 * 看到这张卡 → 选 cell（grid + 多候选时 QuadrantGridPicker；1 candidate 模式
 * 直接显示大图）→ 点「确认下单」→ POST /api/orders/[token]/guest-submit 路由
 * 扣代理商 credit + NEW INSERT promptOrder(status='SELECTED') + UPDATE
 * preview_share.status='confirmed' + linkedOrderId=新订单 id。
 *
 * 与 SelectStep 的差异：
 *   - SelectStep 是 ToC「按批选候选」的 partial select UI（支持 regenerate /
 *     cancel / 多批循环）；本组件是 demo 流 preview 凭证的「一次性确认」UI。
 *   - 没有 regenerate / cancel 按钮（preview 凭证 regenerateLimit=0 + 凭证由
 *     代理商在 /image-gen/orders 自己 cancel）。
 *   - 也没有切批控件（batchCount=1）。
 *   - 提交成功后 → onConfirmed 回调让 PreviewShareView router.replace(/p/{token})
 *     → RSC 重跑 page.tsx 的 lookup → status='confirmed' → redirect 到
 *     linkedOrderId 的 SELECTED 视图。
 *
 * 错误处理：
 *   - 402 代理商积分不足 → 显示「代理商积分不足」提示（不需要 retry 按钮，
 *     这是代理商账户问题，客户无法解决）
 *   - 409 已确认 → 「订单已确认」非阻塞提示（idempotent 防御重提）
 *   - 410 已过期 → 提示客户联系代理商重新分享
 *   - 400 状态异常 / 校验失败 → 服务端 error 字段透传
 *   - 500 默认「提交失败，请稍后重试」
 */

import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  formatCustomization,
  formatProductSpec,
} from "@/features/gpt-image/lib/product-catalog";
import { candidateUrl } from "@/features/gpt-image/user/components/image-urls";
import { QuadrantGrid } from "@/features/gpt-image/user/components/quadrant-grid";

interface PreviewConfirmStepProps {
  token: string;
  orderNo: string;
  updatedAt: string;
  /** 候选宫格数（来自模板 candidateCount）；preview 流永远 candidates=[[url]] */
  candidateCount: number;
  /** 模板候选输出模式（grid 走 QuadrantGrid，separate 不支持 preview → 直显大图） */
  outputMode?: "grid" | "separate";
  /** 模板名称 */
  templateName: string;
  /** 规格显示（用户定制字段汇总） */
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
  /** 确认下单成功后的回调（外层 UserOrderContent 用它 refresh 订单视图） */
  onConfirmed: () => void;
}

interface GuestSubmitSuccess {
  orderNo: string;
  selections: number[];
  selectedAt: string;
  creditsCharged: number;
}

interface GuestSubmitError {
  status: number;
  message: string;
  /** 仅 402 携带：代理商积分不足 + 数字 */
  agentHasInsufficientCredits?: boolean;
  required?: number;
  available?: number;
}

/**
 * 客人确认下单视图 —— 2026-09-13 新增，与 SelectStep 互不替代。
 * 详见文件头注释。返回 null 让外层 UserOrderContent 在非 preview 流下不渲染。
 */
export function PreviewConfirmStep({
  token,
  orderNo,
  updatedAt,
  candidateCount,
  outputMode = "grid",
  templateName,
  productTypeCode,
  productSize,
  accessoryCode,
  engravingText,
  engravingExposed,
  leatherColor,
  leatherExposed,
  pvcProtection,
  remarks,
  platform,
  onConfirmed,
}: PreviewConfirmStepProps) {
  // selectedCell：grid + 多候选时为 0..N-1，否则固定 0。batchCount=1 永远成立
  // （preview 流 candidates 是 [[demoPreviewUrl]]），但 props 保留 batchCount 让
  // future 扩展多 batch 时不需要改这个文件。
  const [selectedCell, setSelectedCell] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<GuestSubmitSuccess | null>(null);
  const [error, setError] = useState<GuestSubmitError | null>(null);

  // preview 流 batchCount=1 永远成立，但保留 batchIdx=0 作为唯一批的下标。
  const safeBatchIdx = 0;

  // 预览图 URL —— /api/orders/[token]/candidates/[imageIdx=0]/[candIdx=0]
  // 服务端解析 candidates[0][0] = demoPreviewUrl，返回 302 到 R2。
  const previewSrc = candidateUrl(token, safeBatchIdx, 0, updatedAt);

  // 复合视图：产品基本规格 + 用户定制字段
  const productLine = formatProductSpec({
    productTypeCode,
    productSize,
    accessoryCode,
  });
  const customizationLine = formatCustomization({
    engravingText,
    engravingExposed,
    leatherColor,
    leatherExposed,
    pvcProtection,
    remarks,
    platform,
  });
  const hasCustomization = customizationLine.length > 0;
  const hasRemarks = !!remarks?.trim();

  const showGridPicker = outputMode === "grid" && candidateCount > 1;

  const handleConfirm = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${token}/guest-submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // selectedCell 在 grid 模式 + 多 cell 时是 picker 当前值；其他情况 0
        body: JSON.stringify({ selectedCell }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
        error?: string;
        data?: {
          orderNo?: string;
          selections?: number[];
          selectedAt?: string;
          creditsCharged?: number;
          agentHasInsufficientCredits?: boolean;
          required?: number;
          available?: number;
        };
      };

      if (res.ok && json.success && json.data) {
        setSuccess({
          orderNo: json.data.orderNo ?? orderNo,
          selections: json.data.selections ?? [selectedCell],
          selectedAt: json.data.selectedAt ?? new Date().toISOString(),
          creditsCharged: json.data.creditsCharged ?? 0,
        });
        // 短暂展示成功状态再 refresh（让用户看到反馈），300ms 足够
        setTimeout(() => {
          onConfirmed();
        }, 300);
      } else {
        // 2026-09-13：exactOptionalPropertyTypes 兼容 —— 只在 json.data 携带对应
        // 字段时放进 error 对象，避免 { agentHasInsufficientCredits: undefined }
        // 落到 strict typed state setter。
        const nextError: GuestSubmitError = {
          status: res.status,
          message:
            json.error || json.message || `提交失败（HTTP ${res.status}）`,
        };
        if (json.data?.agentHasInsufficientCredits) {
          nextError.agentHasInsufficientCredits = true;
          if (typeof json.data.required === "number") {
            nextError.required = json.data.required;
          }
          if (typeof json.data.available === "number") {
            nextError.available = json.data.available;
          }
        }
        setError(nextError);
      }
    } catch (err) {
      setError({
        status: 0,
        message: err instanceof Error ? err.message : "网络异常，请稍后重试",
      });
    } finally {
      setSubmitting(false);
    }
  }, [token, orderNo, selectedCell, submitting, onConfirmed]);

  // 成功态：服务端已 SELECTED + 写完 creditsCharged。让外层 refreshOrder 切换到
  // ResultStep。这里展示一个简短成功提示作为过渡。
  if (success) {
    return (
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-6 text-center space-y-3">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
        </div>
        <h2 className="text-lg font-semibold text-emerald-900">已确认下单</h2>
        <p className="text-sm text-emerald-700">
          订单号：{success.orderNo}
          {success.creditsCharged > 0 && (
            <span className="block mt-1 text-xs">
              已从代理商账户扣除 {success.creditsCharged} 积分
            </span>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部状态徽章 + 标题 */}
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/60 to-violet-50/40 p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-sm">
            <Sparkles className="h-4 w-4 text-indigo-600" />
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold tracking-tight text-stone-900">
              预览待确认
            </h2>
            <p className="text-xs text-stone-600 mt-1 leading-relaxed">
              代理商为您生成了定制预览效果。点击下方「确认下单」将立即进入生产排期，并从代理商账户扣除相应积分。
            </p>
          </div>
        </div>
      </div>

      {/* 预览大图 / QuadrantGridPicker（grid + 多候选时） */}
      <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm">
        {showGridPicker ? (
          <QuadrantGrid
            token={token}
            updatedAt={updatedAt}
            imageIdx={safeBatchIdx}
            compositeUrl={previewSrc}
            quadrantCount={candidateCount as 1 | 2 | 4 | 9}
            selectedQuadrant={selectedCell}
            onSelect={(idx) => setSelectedCell(idx)}
          />
        ) : (
          // biome-ignore lint/performance/noImgElement: preview image from /api/orders/.../candidates/0/0
          <img
            src={previewSrc}
            alt="预览效果"
            className="w-full rounded-xl object-cover"
          />
        )}
      </div>

      {/* 规格摘要 */}
      <div className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm space-y-3">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-wider text-stone-400">
            模板
          </div>
          <div className="text-sm font-medium text-stone-900 mt-0.5">
            {templateName}
          </div>
        </div>
        {productLine !== "-" && (
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-stone-400">
              规格
            </div>
            <div className="text-sm text-stone-700 mt-0.5">{productLine}</div>
          </div>
        )}
        {hasCustomization && (
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-stone-400">
              定制
            </div>
            <div className="text-sm text-stone-700 mt-0.5">
              {customizationLine}
            </div>
          </div>
        )}
        {hasRemarks && (
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-stone-400">
              备注
            </div>
            <div className="text-sm text-stone-700 mt-0.5 whitespace-pre-wrap">
              {remarks}
            </div>
          </div>
        )}
      </div>

      {/* 错误展示（代理商积分不足 / 状态异常 / 网络） */}
      {error && (
        <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium text-rose-900">
              {error.agentHasInsufficientCredits
                ? "代理商积分不足"
                : error.status === 409
                  ? "订单已确认"
                  : "提交失败"}
            </p>
            <p className="text-xs text-rose-700 leading-relaxed">
              {error.agentHasInsufficientCredits
                ? `代理商当前积分 ${error.available ?? "?"}，需要 ${error.required ?? "?"}。请联系代理商充值后再分享预览链接。`
                : error.message}
            </p>
          </div>
        </div>
      )}

      {/* 浮底 CTA —— mobile-first 固定底部 */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-100 bg-[#fafafa]/95 backdrop-blur-sm">
        <div className="mx-auto max-w-md px-5 py-4">
          <Button
            type="button"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={submitting}
            className="w-full h-12 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-sm font-semibold shadow-sm"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                提交中...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-1.5" />
                确认下单
              </>
            )}
          </Button>
          <p className="mt-2 text-[10px] text-center text-stone-400 leading-relaxed">
            提交后订单立即进入生产排期，结果不可修改。
            <br />
            订单号：{orderNo}
          </p>
        </div>
      </div>
    </div>
  );
}
