"use client";

/**
 * 打印服务报价台 —— 官网的「上传模型 → 报价 → 加入打印单 → 提交」主流程
 *
 * ## 页面结构
 *
 *   ┌─ 克重计算器(复用 /tools/weight 的那套)─────────┐
 *   │  左:3D 预览      右:克重 → 尺寸调整 → 报价条   │
 *   └────────────────────────────────────────────────┘
 *   └─ 我的打印订单
 *
 * ## 报价台的出口是**打印单**,不是「直接提交订单」(2026-11-06)
 *
 * 工作室的要求:「模型打印是不走商城正常的购物车的,而是走打印下单,即展示
 * 打印列表和下单金额」。所以这里的主按钮是「加入打印单」——
 *
 * - 加到**打印单**(`/print-order`):另一张车(`kind = "print"`、另一个 cookie
 *   `wjp_print_cart_id`),**不是**商城购物袋
 * - 打印单页摆出**打印列表**(每个模型一行)和**下单金额**;用户确认金额、填
 *   收货地址、提交 → 一次付款 → 钱到了才开工单
 *
 * ## 谁算什么
 *
 * 浏览器算**几何**(体积 / 表面积 / 尺寸 / 克重)—— 这是本地解析出来的,
 * 不上传。服务端算**价格** —— 客户端算的价不信,加进打印单时服务端还会再算
 * 一遍(见 `storefront/lib/cart-store.ts` 的 `computePrintServiceLinePrice`)。
 *
 * ## 模型文件什么时候离开浏览器
 *
 * 只有真的点「加入打印单」时才上传。上面那些「改尺寸看价格」的反复调整,
 * 模型一个字节都没出过浏览器 —— 跟克重工具「只算不存」的边界一致,只是多
 * 了一条出口。
 *
 * ## 直接下单那条路(旧,界面上不再走)
 *
 * 以前这里有个「填写下单信息」的内联表单,直接 POST `/api/print-orders`
 * 建一张工单。那条路**留着**(`order-form.tsx` / `order-created-card.tsx` /
 * `/api/print-orders` 都在树里),但界面上不再走它:
 *
 * - 两个出口会让用户不知道钱付到哪儿去了
 * - 那条路**不收收货地址**(只有称呼 + 电话)—— 工作室照着单子寄不出去
 */

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  PricingCalculator,
  type PricingModelPayload,
} from "@/features/pricing/components/pricing-calculator";
import { PrintOrderList } from "@/features/print-quote/components/print-order-list";
import { QuoteSummary } from "@/features/print-quote/components/quote-summary";
import { usePrintOrderPolling } from "@/features/print-quote/hooks/use-print-order-polling";
import { usePrintQuote } from "@/features/print-quote/hooks/use-print-quote";
import { takePendingModel } from "@/features/print-quote/lib/model-handoff";
import type { UserPrintOrder } from "@/features/print-quote/lib/quote-types";
import { uploadModelFile } from "@/features/print-quote/lib/upload-model";
import { usePrintCart } from "@/features/storefront/hooks/use-print-cart";

type Stage = "quote" | "added";

export function QuoteWorkbench({
  initialOrders,
}: {
  /** 这个用户最近的订单(页面 RSC 查好传进来) */
  initialOrders: UserPrintOrder[];
}) {
  const t = useTranslations("PrintQuote");

  const [modelPayload, setModelPayload] = useState<PricingModelPayload | null>(
    null
  );

  /**
   * 从克重工具接力过来的模型 —— 挂载后取一次
   *
   * 必须在 effect 里取,不能在 render 里取:接力只存在于浏览器(客户端跳转
   * 过来的),render 时取会让服务端渲染出空态、客户端渲染出有模型 —— 两边
   * 不一致,React 会报 hydration 错。
   *
   * 取走即清空(见 `lib/model-handoff.ts`),所以刷新一下不会又冒出个模型。
   */
  const [relayedModel, setRelayedModel] = useState<PricingModelPayload | null>(
    null
  );
  useEffect(() => {
    const pending = takePendingModel();
    if (pending) setRelayedModel(pending);
  }, []);

  /**
   * 报价 —— 防抖请求 + 过期判定
   *
   * 价格**只在报价台这一处算**(2026-11-06 起工具页不显示价格、也不调报价
   * 接口)。这个 hook 是「报价的唯一入口」—— 将来再加第二个报价入口,照着它
   * 接,不要另写一套防抖 / 过期判定。
   */
  const {
    quoteInput,
    setQuoteInput: handleQuoteInput,
    deliveryTier,
    setDeliveryTier,
    quote,
    quoteFresh,
    loading: quoteLoading,
    error: quoteError,
  } = usePrintQuote();

  /**
   * 打印单 hook —— **不自动拉**(报价台不该给每个访客建一张空打印单)
   *
   * 真正要加行的时候,`addPrintLine` 自己会去要那张车(见 hook 里的
   * `ensurePrintCart()`)。加完之后缓存里就是最新的打印单,`/print-order`
   * 打开时直接拿得到。
   */
  const { addPrintLine } = usePrintCart({ enabled: false });

  const [stage, setStage] = useState<Stage>("quote");
  const [phase, setPhase] = useState<"idle" | "adding">("idle");
  const [orderError, setOrderError] = useState<string | null>(null);

  /**
   * 我的订单
   *
   * 首屏由页面 RSC 查好传进来(这个登录用户最近的订单)。之后靠轮询保持
   * 新鲜:工作室在后台改了状态,这个页面开着也会跟着变。
   */
  const { orders } = usePrintOrderPolling(initialOrders);

  const handleModelChange = useCallback(
    (payload: PricingModelPayload | null) => {
      setModelPayload(payload);
    },
    []
  );

  // ---- 加入打印单 ----
  const handleAddToPrintOrder = useCallback(async () => {
    if (!quoteInput || !modelPayload) {
      setOrderError(t("order.errors.noModel"));
      return;
    }
    // 报价跟当前几何对不上 → 不能加。用户看到的价和服务端会算的价
    // 不是同一个,加进去的单子跟他确认过的对不上。
    if (!quoteFresh) {
      setOrderError(t("order.errors.quoteStale"));
      return;
    }
    setOrderError(null);
    setPhase("adding");

    try {
      // 模型文件在这里才离开浏览器 —— 上面的报价阶段一个字节都没传
      const uploaded = await uploadModelFile(modelPayload);

      await addPrintLine.mutateAsync({
        printSpec: {
          volumeCM3: quoteInput.volumeCM3,
          surfaceAreaCM2: quoteInput.surfaceAreaCM2,
          dims: quoteInput.dims,
          supportWeightG: quoteInput.supportWeightG ?? null,
          selfSupportRatio: quoteInput.selfSupportRatio ?? null,
          deliveryTier,
          modelFileName: uploaded.fileName,
          modelObjectKey: uploaded.objectKey,
          modelUrl: uploaded.url,
          modelSizeBytes: uploaded.size,
        },
      });

      setStage("added");
    } catch (error) {
      console.error("[PrintQuote] 加入打印单失败", error);
      setOrderError(t("printOrder.errors.addFailed"));
    } finally {
      setPhase("idle");
    }
  }, [quoteInput, modelPayload, quoteFresh, t, deliveryTier, addPrintLine]);

  const quoteSlot = useMemo(
    () => (
      <QuoteSummary
        quote={quote}
        loading={quoteLoading}
        stale={!quoteFresh}
        error={quoteError}
        adding={phase === "adding"}
        added={stage === "added"}
        onAddToPrintOrder={handleAddToPrintOrder}
        onReset={() => {
          setStage("quote");
          setOrderError(null);
        }}
        deliveryTier={deliveryTier}
        onDeliveryTierChange={setDeliveryTier}
      />
    ),
    [
      quote,
      quoteLoading,
      quoteError,
      quoteFresh,
      phase,
      stage,
      handleAddToPrintOrder,
      deliveryTier,
      setDeliveryTier,
    ]
  );

  return (
    <div className="space-y-8">
      <PricingCalculator
        showChrome={false}
        quoteMode
        onQuoteInput={handleQuoteInput}
        onModelChange={handleModelChange}
        initialModel={relayedModel}
        quoteSlot={quoteSlot}
      />

      {orderError && (
        <p className="text-sm text-destructive text-center">{orderError}</p>
      )}

      <PrintOrderList orders={orders} />
    </div>
  );
}
