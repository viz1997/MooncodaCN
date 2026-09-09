"use client";

/**
 * /image-gen —— 登录用户 6 步下单工作台
 *
 * 2026-09-09：把原公开 demo（一次性生图 + localStorage 历史）升级为完整下单流：
 *
 *   Step 1. 选模板（productEffect 网格）
 *   Step 2. 选规格（productSize + accessoryCode + 可选 engraving）
 *   Step 3. 建草稿（createOrderFromImageGenAction → 返 token）
 *   Step 4. 上传参考图 + 生成（复用 /api/orders/[token]/{upload-url,upload,poll}）
 *   Step 5. 选候选（/api/orders/[token]/select）
 *   Step 6. 提交扣 credit（submitPublicOrderAction → SELECTED）→ 成功页
 *
 * 与 /p/[token] 的区别：
 *   - /p/[token] 是「agent 创建订单后分享给终端用户」
 *   - /image-gen 是「登录用户自助」（创建订单者 = 当前登录用户本人）
 *   - 两者共用 promptOrder + /api/orders/[token]/* API（已建好）
 *
 * 复用：
 *   - useOrder(token) — PENDING/GENERATING/CANDIDATES_READY 状态轮询
 *   - useOrderActions({token, refresh}) — upload/submit/cancel/stop/regenerate/retryAll/download
 *   - @/features/gpt-image/lib/product-catalog — getProductType / validateProductSpec / ACCESSORIES
 *   - createOrderFromImageGenAction / submitPublicOrderAction / listUserDraftAction（server actions）
 */

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Upload,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  ACCESSORIES,
  getProductType,
  validateProductSpec,
} from "@/features/gpt-image/lib/product-catalog";
import { useOrder } from "@/features/gpt-image/user/components/use-order";
import { useOrderActions } from "@/features/gpt-image/user/components/use-order-actions";
import {
  createOrderFromImageGenAction,
  listUserDraftAction,
  submitPublicOrderAction,
} from "@/features/image-gen/actions/order";
import { cn } from "@/lib/utils";

// ============================================
// 类型
// ============================================

interface PublicMask {
  maskId: string;
  name: string;
  previewUrl: string;
  productTypeCode: string | null;
  price: number;
  description: string;
  model: string;
}

type StepIndex = 0 | 1 | 2 | 3 | 4 | 5;

const STEPS: Array<{ idx: StepIndex; label: string }> = [
  { idx: 0, label: "选模板" },
  { idx: 1, label: "选规格" },
  { idx: 2, label: "建订单" },
  { idx: 3, label: "上传 + 生成" },
  { idx: 4, label: "选候选" },
  { idx: 5, label: "提交" },
];

// ============================================
// Page
// ============================================

export function PublicImageGenView() {
  const [step, setStep] = useState<StepIndex>(0);

  // Step 1：选中的模板
  const [templates, setTemplates] = useState<PublicMask[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<PublicMask | null>(
    null
  );

  // Step 2：规格
  const [productSize, setProductSize] = useState<string>("");
  const [accessoryCode, setAccessoryCode] = useState<string>("");
  const [engravingText, setEngravingText] = useState<string>("");
  const [engravingExposed, setEngravingExposed] = useState<boolean>(false);

  // Step 3 状态：草稿订单
  const [creating, setCreating] = useState(false);
  const [order, setOrder] = useState<{
    orderId: string;
    orderNo: string;
    token: string;
  } | null>(null);

  // Step 6 状态：提交
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{
    orderId: string;
    orderNo: string;
    token: string;
    creditsConsumed: number;
  } | null>(null);

  // 模板列表加载
  useEffect(() => {
    fetch("/api/public/generate")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.masks))
          setTemplates(data.masks as PublicMask[]);
      })
      .catch(() => {})
      .finally(() => setLoadingTemplates(false));
  }, []);

  // 草稿恢复：templates 加载完后检查是否有 PENDING/GENERATING/CANDIDATES_READY 订单
  const draftCheckedRef = useRef(false);
  useEffect(() => {
    if (draftCheckedRef.current) return;
    if (templates.length === 0) return;
    draftCheckedRef.current = true;

    (async () => {
      try {
        const res = await listUserDraftAction(undefined);
        const draft = res?.data?.draft;
        if (!draft) return;
        const tmpl = templates.find((t) => t.maskId === draft.templateId);
        if (!tmpl) return;
        setSelectedTemplate(tmpl);
        setProductSize(draft.productSize ?? "");
        setAccessoryCode(draft.accessoryCode ?? "");
        setEngravingText(draft.engravingText ?? "");
        setEngravingExposed(draft.engravingExposed === true);
        setOrder({
          orderId: draft.orderId,
          orderNo: draft.orderNo,
          token: draft.token,
        });
        // 直接跳到上传步骤
        if (
          draft.status === "PENDING" ||
          draft.status === "GENERATING" ||
          draft.status === "CANDIDATES_READY"
        ) {
          setStep(3);
        }
      } catch {
        // ignore
      }
    })();
  }, [templates]);

  // 选模板 → 自动跳 step 2 + 按 catalog defaults 填 size/accessory
  const handleSelectTemplate = (t: PublicMask) => {
    setSelectedTemplate(t);
    const pt = getProductType(t.productTypeCode);
    setProductSize(pt?.sizes?.[0] ?? "");
    setAccessoryCode(pt?.accessories?.[0] ?? "");
    setEngravingText("");
    setEngravingExposed(false);
    setOrder(null);
    setSubmitted(null);
    setStep(1);
  };

  // 选完规格 → 创建草稿 → 跳 step 3
  const handleConfirmSpec = async () => {
    if (!selectedTemplate) return;
    try {
      validateProductSpec(
        selectedTemplate.productTypeCode,
        productSize || null,
        accessoryCode || null
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "规格校验失败");
      return;
    }
    setCreating(true);
    try {
      const res = await createOrderFromImageGenAction({
        templateId: selectedTemplate.maskId,
        productTypeCode: selectedTemplate.productTypeCode,
        productSize: productSize || null,
        accessoryCode: accessoryCode || null,
        engravingText: engravingText.trim() || null,
        engravingExposed: engravingText.trim() ? engravingExposed : null,
      });
      if (!res?.data) throw new Error("创建订单失败");
      setOrder({
        orderId: res.data.orderId,
        orderNo: res.data.orderNo,
        token: res.data.token,
      });
      toast.success("订单已创建，请上传参考图");
      setStep(3);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建订单失败");
    } finally {
      setCreating(false);
    }
  };

  // 重置 stepper 到 step 0
  const resetFlow = useCallback(() => {
    setStep(0);
    setSelectedTemplate(null);
    setProductSize("");
    setAccessoryCode("");
    setEngravingText("");
    setEngravingExposed(false);
    setOrder(null);
    setSubmitted(null);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-30 h-12 shrink-0 bg-white dark:bg-zinc-900 border-b flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <span className="font-bold text-sm">AI 生图</span>
          <span className="text-[11px] text-muted-foreground hidden sm:inline">
            3D打印定制 · 一键生成
          </span>
        </div>
        {step > 0 ? (
          <Button variant="ghost" size="sm" onClick={resetFlow}>
            <ChevronLeft className="h-3.5 w-3.5 mr-1" />
            重新开始
          </Button>
        ) : null}
      </header>

      {/* Step bar */}
      <StepBar currentStep={step} submitted={submitted != null} />

      {/* Main */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        {step === 0 && (
          <Step1SelectTemplate
            templates={templates}
            loading={loadingTemplates}
            onSelect={handleSelectTemplate}
          />
        )}
        {step === 1 && selectedTemplate && (
          <Step2SelectSpec
            template={selectedTemplate}
            productSize={productSize}
            accessoryCode={accessoryCode}
            engravingText={engravingText}
            engravingExposed={engravingExposed}
            onChangeSize={setProductSize}
            onChangeAccessory={setAccessoryCode}
            onChangeEngravingText={setEngravingText}
            onChangeEngravingExposed={setEngravingExposed}
            onBack={() => setStep(0)}
            onConfirm={() => void handleConfirmSpec()}
            creating={creating}
          />
        )}
        {step === 2 && selectedTemplate && (
          <Step3Creating
            template={selectedTemplate}
            productSize={productSize}
            accessoryCode={accessoryCode}
          />
        )}
        {step >= 3 && step <= 5 && order && !submitted && (
          <Step456UploadGenerateSelectSubmit
            orderToken={order.token}
            orderNo={order.orderNo}
            onSubmitted={(result) => {
              setSubmitted({
                orderId: result.orderId,
                orderNo: result.orderNo,
                token: result.token,
                creditsConsumed: result.creditsConsumed,
              });
              setStep(5);
            }}
            submitting={submitting}
            setSubmitting={setSubmitting}
          />
        )}
        {step === 5 && submitted && (
          <Step6Success
            orderNo={submitted.orderNo}
            token={submitted.token}
            creditsConsumed={submitted.creditsConsumed}
            onReset={resetFlow}
          />
        )}
      </main>
    </div>
  );
}

// ============================================
// Step 1: 选模板
// ============================================

function Step1SelectTemplate({
  templates,
  loading,
  onSelect,
}: {
  templates: PublicMask[];
  loading: boolean;
  onSelect: (t: PublicMask) => void;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 静态骨架屏
          <div key={i} className="h-48 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p className="text-sm">暂无可用模板</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">选择模板</h2>
        <p className="text-sm text-muted-foreground mt-1">
          共 {templates.length} 个可用模板，点击卡片开始
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((t) => {
          const productType = getProductType(t.productTypeCode);
          return (
            <button
              key={t.maskId}
              type="button"
              onClick={() => onSelect(t)}
              className={cn(
                "group relative rounded-xl border bg-white dark:bg-zinc-900 p-4 text-left transition-all",
                "hover:border-violet-500/50 hover:shadow-md hover:-translate-y-0.5"
              )}
            >
              {/* 封面 */}
              <div className="aspect-[4/3] w-full rounded-lg bg-gradient-to-br from-violet-100 via-fuchsia-100 to-sky-100 dark:from-violet-950/40 dark:via-fuchsia-950/40 dark:to-sky-950/40 flex items-center justify-center mb-3 overflow-hidden">
                {t.previewUrl ? (
                  // biome-ignore lint/performance/noImgElement: 动态远程封面
                  <img
                    src={t.previewUrl}
                    alt={t.name}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <span className="text-5xl font-bold text-violet-700/40 dark:text-violet-300/40">
                    {t.name.slice(0, 1)}
                  </span>
                )}
              </div>

              {/* 信息 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-base">{t.name}</h3>
                  {t.productTypeCode && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                      {productType?.name ?? t.productTypeCode}
                    </span>
                  )}
                </div>
                {t.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {t.description}
                  </p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    {t.price > 0 ? `¥${(t.price / 100).toFixed(2)}` : "免费"}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 group-hover:translate-x-0.5 transition-transform">
                    使用
                    <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================
// Step 2: 选规格
// ============================================

function Step2SelectSpec({
  template,
  productSize,
  accessoryCode,
  engravingText,
  engravingExposed,
  onChangeSize,
  onChangeAccessory,
  onChangeEngravingText,
  onChangeEngravingExposed,
  onBack,
  onConfirm,
  creating,
}: {
  template: PublicMask;
  productSize: string;
  accessoryCode: string;
  engravingText: string;
  engravingExposed: boolean;
  onChangeSize: (v: string) => void;
  onChangeAccessory: (v: string) => void;
  onChangeEngravingText: (v: string) => void;
  onChangeEngravingExposed: (v: boolean) => void;
  onBack: () => void;
  onConfirm: () => void;
  creating: boolean;
}) {
  const productType = getProductType(template.productTypeCode);
  const hasSize = (productType?.sizes?.length ?? 0) > 0;
  const hasAccessory = (productType?.accessories?.length ?? 0) > 0;
  const canEngrave = productType?.capabilities.canEngrave ?? false;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="rounded-xl border bg-white dark:bg-zinc-900 p-5">
        <div className="flex items-start gap-4">
          <div className="h-16 w-16 shrink-0 rounded-lg bg-gradient-to-br from-violet-100 to-fuchsia-100 dark:from-violet-950/40 dark:to-fuchsia-950/40 flex items-center justify-center">
            <span className="text-2xl font-bold text-violet-700/40">
              {template.name.slice(0, 1)}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold">{template.name}</h2>
            {template.description && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {template.description}
              </p>
            )}
            {productType && (
              <div className="mt-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                  产品型号：{productType.name}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 尺寸 */}
      {hasSize && (
        <div className="rounded-xl border bg-white dark:bg-zinc-900 p-5">
          <h3 className="text-sm font-semibold mb-3">尺寸</h3>
          <div className="flex flex-wrap gap-2">
            {productType?.sizes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onChangeSize(s)}
                className={cn(
                  "px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                  productSize === s
                    ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                    : "border-muted-foreground/20 hover:border-violet-500/50"
                )}
              >
                {s} cm
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 配件 */}
      {hasAccessory && (
        <div className="rounded-xl border bg-white dark:bg-zinc-900 p-5">
          <h3 className="text-sm font-semibold mb-3">配件</h3>
          <div className="flex flex-wrap gap-2">
            {productType?.accessories.map((a) => {
              const acc = ACCESSORIES.find((x) => x.code === a);
              return (
                <button
                  key={a}
                  type="button"
                  onClick={() => onChangeAccessory(a)}
                  className={cn(
                    "px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                    accessoryCode === a
                      ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                      : "border-muted-foreground/20 hover:border-violet-500/50"
                  )}
                >
                  {acc?.name ?? a}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 刻字 */}
      {canEngrave && (
        <div className="rounded-xl border bg-white dark:bg-zinc-900 p-5 space-y-3">
          <h3 className="text-sm font-semibold">刻字（可选）</h3>
          <input
            type="text"
            value={engravingText}
            onChange={(e) => onChangeEngravingText(e.target.value.slice(0, 40))}
            maxLength={40}
            placeholder="如：Love U / 2026.09.09 / 宝贝 1 岁"
            className="w-full rounded-md border border-muted-foreground/20 bg-white dark:bg-zinc-800 px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
          />
          <p className="text-[11px] text-muted-foreground">
            最多 40 个字符（中文 / 英文 / 数字 / 空格）
          </p>
          {engravingText.trim().length > 0 && (
            <label className="flex items-center justify-between gap-3 cursor-pointer pt-1">
              <div>
                <div className="text-sm font-medium">外露</div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  关 = 内刻（默认）。开 = 刻在外表面
                </p>
              </div>
              <input
                type="checkbox"
                className="h-5 w-5 accent-violet-600"
                checked={engravingExposed}
                onChange={(e) => onChangeEngravingExposed(e.target.checked)}
              />
            </label>
          )}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center justify-between gap-3">
        <Button variant="outline" onClick={onBack} disabled={creating}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
        <Button
          onClick={onConfirm}
          disabled={creating}
          className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
        >
          {creating ? (
            <>
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              创建中...
            </>
          ) : (
            <>
              <Wand2 className="h-4 w-4 mr-1.5" />
              下一步：上传参考图
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ============================================
// Step 3: 创建中（占位 —— 实际 step 3 直接渲染 upload panel）
// ============================================

function Step3Creating({
  template,
  productSize,
  accessoryCode,
}: {
  template: PublicMask;
  productSize: string;
  accessoryCode: string;
}) {
  return (
    <div className="max-w-md mx-auto text-center py-16">
      <Loader2 className="h-12 w-12 text-violet-500 animate-spin mx-auto" />
      <p className="mt-4 text-sm font-medium">正在创建订单...</p>
      <p className="text-xs text-muted-foreground mt-1">
        {template.name} · {productSize}cm · {accessoryCode ?? "无配件"}
      </p>
    </div>
  );
}

// ============================================
// Step 4 + 5: 上传 / 生成 / 选候选 / 提交（按订单状态分发）
// ============================================

function Step456UploadGenerateSelectSubmit({
  orderToken,
  orderNo,
  onSubmitted,
  submitting,
  setSubmitting,
}: {
  orderToken: string;
  orderNo: string;
  onSubmitted: (result: {
    orderId: string;
    orderNo: string;
    token: string;
    creditsConsumed: number;
  }) => void;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
}) {
  const { order, loading, notFound, refresh } = useOrder(orderToken);
  const actions = useOrderActions({ token: orderToken, refresh });

  const handleSubmit = async () => {
    if (!order) return;
    setSubmitting(true);
    try {
      const res = await submitPublicOrderAction({ orderId: order.id });
      if (!res?.data) throw new Error("提交失败");
      toast.success(
        res.data.creditsConsumed > 0
          ? `订单已创建，扣减 ${res.data.creditsConsumed} 积分`
          : "订单已创建"
      );
      onSubmitted({
        orderId: res.data.orderId,
        orderNo: res.data.orderNo,
        token: res.data.token,
        creditsConsumed: res.data.creditsConsumed,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-16">
        <Loader2 className="h-8 w-8 text-muted-foreground animate-spin mx-auto" />
      </div>
    );
  }

  if (notFound || !order) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <AlertCircle className="h-10 w-10 text-rose-500 mx-auto" />
        <p className="mt-4 text-sm">订单加载失败</p>
      </div>
    );
  }

  const status = order.status;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 顶部：订单信息 */}
      <div className="rounded-xl border bg-white dark:bg-zinc-900 p-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">订单号</div>
          <div className="text-sm font-mono font-medium">{orderNo}</div>
        </div>
        <div className="text-xs text-muted-foreground text-right">
          {order.template.name} ·{" "}
          {order.productSize ? `${order.productSize}cm` : ""}
          {order.accessoryCode ? ` · ${order.accessoryCode}` : ""}
        </div>
      </div>

      {/* PENDING → 上传 */}
      {status === "PENDING" && (
        <UploadPanel
          order={order}
          uploading={actions.uploading}
          onUpload={actions.upload}
        />
      )}

      {/* GENERATING → 进度 */}
      {status === "GENERATING" && (
        <GeneratingPanel order={order} onStop={actions.stopGeneration} />
      )}

      {/* CANDIDATES_READY → 选候选 + 提交 */}
      {status === "CANDIDATES_READY" && (
        <SelectAndSubmitPanel
          order={order}
          submittingSelection={actions.submitting}
          submittingOrder={submitting}
          onSelect={actions.submit}
          onSubmit={handleSubmit}
          onDownload={(batchIdx, candIdx) =>
            void actions.download(orderNo, batchIdx, candIdx)
          }
        />
      )}

      {/* FAILED → 重试 */}
      {status === "FAILED" && (
        <FailedPanel
          order={order}
          retrying={actions.retryingAll}
          onRetry={actions.retryAll}
        />
      )}

      {/* SELECTED（在 /image-gen 中不应进入但兜底） → 直接进入成功 */}
      {status === "SELECTED" && (
        <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/30 p-6 text-center">
          <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
          <p className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            订单已提交
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================
// Upload Panel (PENDING)
// ============================================

function UploadPanel({
  order,
  uploading,
  onUpload,
}: {
  order: NonNullable<ReturnType<typeof useOrder>["order"]>;
  uploading: boolean;
  onUpload: (files: File[]) => Promise<boolean>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const totalCapacity = order.uploadCount * order.imagesPerUpload;
  const uploadedCount = order.uploadedImageCount;

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const allowed = files.filter((f) =>
      ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(f.type)
    );
    if (allowed.length === 0) {
      toast.error("请上传 JPG/PNG/WEBP 格式");
      return;
    }
    if (allowed.length > totalCapacity - uploadedCount) {
      toast.error(`剩余 ${totalCapacity - uploadedCount} 张额度，请分批上传`);
      return;
    }
    await onUpload(allowed);
  };

  return (
    <div className="rounded-xl border bg-white dark:bg-zinc-900 p-6">
      <div className="flex items-center gap-2 mb-2">
        <ImageIcon className="h-4 w-4" />
        <h3 className="text-base font-semibold">上传参考图</h3>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        支持 {totalCapacity} 张图（{order.uploadCount} 批 × 每批{" "}
        {order.imagesPerUpload} 张），已上传 {uploadedCount}/{totalCapacity}
      </p>

      {uploadedCount >= totalCapacity ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-center">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 mx-auto mb-1" />
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
            已上传 {uploadedCount}/{totalCapacity} 张
          </p>
          <p className="text-xs text-muted-foreground mt-1">请等待生成结果</p>
        </div>
      ) : (
        // biome-ignore lint/a11y/useSemanticElements: 拖拽上传区
        <div
          role="button"
          tabIndex={0}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFiles(Array.from(e.dataTransfer.files));
          }}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className={cn(
            "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all",
            dragOver
              ? "border-violet-500 bg-violet-500/5"
              : "border-muted-foreground/25 hover:border-violet-500/50"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              void handleFiles(files);
              e.target.value = "";
            }}
          />
          <Upload
            className={cn(
              "h-10 w-10 mx-auto mb-3",
              dragOver ? "text-violet-500" : "text-muted-foreground"
            )}
          />
          <p className="text-sm font-medium">
            {uploading
              ? "上传中..."
              : dragOver
                ? "释放即可上传"
                : "点击或拖拽图片"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            JPG / PNG / WEBP · 单张 ≤5MB
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================
// Generating Panel
// ============================================

function GeneratingPanel({
  order,
  onStop,
}: {
  order: NonNullable<ReturnType<typeof useOrder>["order"]>;
  onStop: () => Promise<boolean>;
}) {
  const [stopping, setStopping] = useState(false);

  return (
    <div className="rounded-xl border bg-white dark:bg-zinc-900 p-10 text-center">
      <div className="relative inline-block">
        <Loader2 className="h-14 w-14 text-sky-500 animate-spin" />
        <Sparkles className="h-5 w-5 text-violet-500 absolute top-4 left-4" />
      </div>
      <p className="mt-4 text-sm font-medium text-sky-700 dark:text-sky-400">
        AI 创作中...
      </p>
      <p className="text-xs text-muted-foreground mt-1">
        订单 {order.orderNo} · 预计 5-30 秒
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-6"
        onClick={async () => {
          setStopping(true);
          await onStop();
          setStopping(false);
        }}
        disabled={stopping}
      >
        {stopping ? "停止中..." : "停止生成"}
      </Button>
    </div>
  );
}

// ============================================
// Select + Submit Panel (CANDIDATES_READY)
// ============================================

function SelectAndSubmitPanel({
  order,
  submittingSelection,
  submittingOrder,
  onSelect,
  onSubmit,
  onDownload,
}: {
  order: NonNullable<ReturnType<typeof useOrder>["order"]>;
  submittingSelection: boolean;
  submittingOrder: boolean;
  onSelect: (
    payload: number[] | Array<{ batchIdx: number; candIdx: number }>
  ) => Promise<boolean>;
  onSubmit: () => Promise<void>;
  onDownload: (batchIdx: number, candIdx: number) => void;
}) {
  // 已锁定 selections：来自后端的 selections 字段（部分为 null）
  // 用户主动选择：存 selectedPerBatch 状态（覆盖 null 位）
  const [selectedPerBatch, setSelectedPerBatch] = useState<
    Record<number, number>
  >({});

  const allSelected = useMemo(() => {
    for (let i = 0; i < order.candidateGroups; i++) {
      if (selectedPerBatch[i] === undefined) return false;
    }
    return order.candidateGroups > 0;
  }, [selectedPerBatch, order.candidateGroups]);

  const handleConfirmSelect = async () => {
    const payload: Array<{ batchIdx: number; candIdx: number }> =
      Object.entries(selectedPerBatch).map(([batchIdx, candIdx]) => ({
        batchIdx: Number(batchIdx),
        candIdx,
      }));
    await onSelect(payload);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white dark:bg-zinc-900 p-6">
        <div className="flex items-center gap-2 mb-2">
          <Wand2 className="h-4 w-4" />
          <h3 className="text-base font-semibold">选择效果图</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          共 {order.candidateGroups} 批，每批选 1 张候选（共{" "}
          {order.candidateCount} 张候选可选）
        </p>

        <div className="space-y-6">
          {Array.from({ length: order.candidateGroups }).map((_, batchIdx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 候选批次为静态顺序
            <div key={batchIdx} className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                第 {batchIdx + 1} 批
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Array.from({ length: order.candidateCount }).map(
                  (_, candIdx) => {
                    const selected = selectedPerBatch[batchIdx] === candIdx;
                    return (
                      <button
                        // biome-ignore lint/suspicious/noArrayIndexKey: 候选索引静态
                        key={`b${batchIdx}-c${candIdx}`}
                        type="button"
                        onClick={() =>
                          setSelectedPerBatch((prev) => ({
                            ...prev,
                            [batchIdx]: candIdx,
                          }))
                        }
                        className={cn(
                          "relative aspect-square rounded-lg overflow-hidden border-2 transition-all bg-muted",
                          selected
                            ? "border-violet-500 ring-2 ring-violet-500/30"
                            : "border-transparent hover:border-violet-500/30"
                        )}
                      >
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                          候选 {candIdx + 1}
                        </div>
                        {selected && (
                          <div className="absolute top-1 right-1 h-5 w-5 rounded-full bg-violet-500 flex items-center justify-center">
                            <CheckCircle2 className="h-3 w-3 text-white" />
                          </div>
                        )}
                      </button>
                    );
                  }
                )}
              </div>
              {selectedPerBatch[batchIdx] !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onDownload(batchIdx, selectedPerBatch[batchIdx] ?? 0)
                  }
                  className="text-xs"
                >
                  <Download className="h-3 w-3 mr-1" />
                  下载预览
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => void handleConfirmSelect()}
          disabled={!allSelected || submittingSelection}
        >
          {submittingSelection ? (
            <>
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              锁定中...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              锁定选择
            </>
          )}
        </Button>

        <Button
          onClick={() => void onSubmit()}
          disabled={submittingOrder || !allSelected}
          className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
        >
          {submittingOrder ? (
            <>
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              提交中...
            </>
          ) : (
            <>
              提交成订单
              <ChevronRight className="h-4 w-4 ml-1" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// ============================================
// Failed Panel
// ============================================

function FailedPanel({
  order,
  retrying,
  onRetry,
}: {
  order: NonNullable<ReturnType<typeof useOrder>["order"]>;
  retrying: boolean;
  onRetry: () => Promise<boolean>;
}) {
  return (
    <div className="rounded-xl border bg-white dark:bg-zinc-900 p-10 text-center">
      <AlertCircle className="h-12 w-12 text-rose-500 mx-auto" />
      <p className="mt-4 text-sm font-medium text-rose-700 dark:text-rose-400">
        生成失败
      </p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
        {order.errorMessage ?? "未知错误"}
      </p>
      <Button
        className="mt-6"
        onClick={() => void onRetry()}
        disabled={retrying}
      >
        {retrying ? (
          <>
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            重试中...
          </>
        ) : (
          <>
            <RefreshCw className="h-4 w-4 mr-1.5" />
            重新生成
          </>
        )}
      </Button>
    </div>
  );
}

// ============================================
// Step 6: Success
// ============================================

function Step6Success({
  orderNo,
  token,
  creditsConsumed,
  onReset,
}: {
  orderNo: string;
  token: string;
  creditsConsumed: number;
  onReset: () => void;
}) {
  return (
    <div className="max-w-md mx-auto text-center py-16 space-y-6">
      <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/40">
        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
      </div>
      <div>
        <h2 className="text-xl font-semibold">订单已创建</h2>
        <p className="text-sm text-muted-foreground mt-2">订单号：{orderNo}</p>
        {creditsConsumed > 0 && (
          <p className="text-sm text-muted-foreground mt-1">
            已扣减 {creditsConsumed} 积分
          </p>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <Button
          variant="outline"
          onClick={() => {
            window.location.href = `/p/${token}`;
          }}
        >
          查看订单详情
        </Button>
        <Button
          onClick={onReset}
          className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
        >
          <Sparkles className="h-4 w-4 mr-1.5" />
          继续生图
        </Button>
      </div>
    </div>
  );
}

// ============================================
// Step Bar
// ============================================

function StepBar({
  currentStep,
  submitted,
}: {
  currentStep: StepIndex;
  submitted: boolean;
}) {
  return (
    <div className="border-b bg-white dark:bg-zinc-900">
      <div className="max-w-6xl mx-auto px-4 py-3">
        <div className="flex items-center gap-1 overflow-x-auto">
          {STEPS.map((s, i) => {
            const isCurrent = !submitted && i === currentStep;
            const isDone = submitted || i < currentStep;
            return (
              <div key={s.idx} className="flex items-center">
                <div
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                    isCurrent &&
                      "bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300",
                    isDone &&
                      !isCurrent &&
                      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                    !isCurrent && !isDone && "text-muted-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                      isCurrent && "bg-violet-500 text-white",
                      isDone && !isCurrent && "bg-emerald-500 text-white",
                      !isCurrent && !isDone && "bg-muted text-muted-foreground"
                    )}
                  >
                    {isDone && !isCurrent ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : (
                      s.idx + 1
                    )}
                  </span>
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="h-3 w-3 mx-1 text-muted-foreground/40" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
