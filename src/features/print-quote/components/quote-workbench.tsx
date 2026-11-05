"use client";

/**
 * 打印服务报价台 —— 官网的「上传模型 → 报价 → 下单」主流程
 *
 * ## 页面结构
 *
 *   ┌─ 克重计算器（复用 /tools/weight 的那套）─────────┐
 *   │  左：3D 预览      右：克重 → 尺寸调整 → 报价条   │
 *   └────────────────────────────────────────────────┘
 *   └─ 下单表单（点「填写下单信息」后内联展开）
 *   └─ 下单成功 / 我的订单
 *
 * ## 谁算什么
 *
 * 浏览器算**几何**(体积 / 表面积 / 尺寸 / 克重)—— 这是本地解析出来的,
 * 不上传。服务端算**价格** —— 客户端算的价不信,下单时服务端还会再算一遍。
 *
 * ## 模型文件什么时候离开浏览器
 *
 * 只有真的下单时才上传。上面那些「改尺寸看价格」的反复调整,模型一个字节
 * 都没出过浏览器 —— 跟克重工具「只算不存」的边界一致,只是多了一条出口。
 */

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";

import {
  PricingCalculator,
  type PricingModelPayload,
} from "@/features/pricing/components/pricing-calculator";
import { OrderCreatedCard } from "@/features/print-quote/components/order-created-card";
import {
  type OrderContact,
  OrderForm,
} from "@/features/print-quote/components/order-form";
import { PrintOrderList } from "@/features/print-quote/components/print-order-list";
import { QuoteSummary } from "@/features/print-quote/components/quote-summary";
import { usePrintOrderPolling } from "@/features/print-quote/hooks/use-print-order-polling";
import { usePrintQuote } from "@/features/print-quote/hooks/use-print-quote";
import type {
  PrintOrderCreated,
  UserPrintOrder,
} from "@/features/print-quote/lib/quote-types";
import { uploadModelFile } from "@/features/print-quote/lib/upload-model";

type Stage = "quote" | "form" | "done";

export function QuoteWorkbench({
  user,
  initialOrders,
}: {
  /** 当前登录用户 —— 表单用它预填称呼和邮箱 */
  user: { name: string; email: string };
  /** 这个用户最近的订单(页面 RSC 查好传进来) */
  initialOrders: UserPrintOrder[];
}) {
  const t = useTranslations("PrintQuote");
  /**
   * 当前界面语言 —— 跟着订单一起落库
   *
   * 之后工作室改状态发的通知邮件用**订单的语言**,不是「谁点的那个按钮」
   * 的语言:改状态的是工作室(中文界面),但邮件是发给下单用户的。
   */
  const locale = useLocale();

  const [modelPayload, setModelPayload] = useState<PricingModelPayload | null>(
    null
  );

  /**
   * 报价 —— 防抖请求 + 过期判定
   *
   * 跟 `/tools/weight` 的「加入购物车」那条路**共用同一个 hook** ——
   * 两个页面看到的价必须是同一个数(同一个服务端接口、同一套口径)。
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

  const [stage, setStage] = useState<Stage>("quote");
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitting">(
    "idle"
  );
  const [orderError, setOrderError] = useState<string | null>(null);
  const [order, setOrder] = useState<PrintOrderCreated | null>(null);
  /**
   * 选中的收款通道
   *
   * null = 还没选(服务端挑一个**开放的**通道,见
   * `payments/lib/registry.ts` 的 `ENABLED_PAYMENT_CHANNELS`)。
   * 支付方式选择器只渲染**配好了**的通道 —— 没配好的不给人看。
   */
  const [channel, setChannel] = useState<string | null>(null);
  /**
   * 我的订单
   *
   * 首屏由页面 RSC 查好传进来(这个登录用户最近的订单);下单成功后新单
   * 乐观插到最上面 —— 不用等刷新就能看到。
   *
   * 之后靠轮询保持新鲜:工作室在后台改了状态,这个页面开着也会跟着变。
   */
  const { orders, upsertOrder } = usePrintOrderPolling(initialOrders);

  const handleModelChange = useCallback(
    (payload: PricingModelPayload | null) => {
      setModelPayload(payload);
    },
    []
  );

  // ---- 下单 ----
  const handleSubmitOrder = useCallback(
    async (contact: OrderContact) => {
      if (!quoteInput || !modelPayload) {
        setOrderError(t("order.errors.noModel"));
        return;
      }
      // 报价跟当前几何对不上 → 不能下单。用户看到的价和服务端会算的价
      // 不是同一个,建出来的单子跟他确认过的对不上。
      if (!quoteFresh) {
        setOrderError(t("order.errors.quoteStale"));
        return;
      }
      setOrderError(null);

      try {
        setPhase("uploading");
        const uploaded = await uploadModelFile(modelPayload);

        setPhase("submitting");
        const res = await fetch("/api/print-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quote: { ...quoteInput, deliveryTier },
            modelFileName: uploaded.fileName,
            objectKey: uploaded.objectKey,
            modelUrl: uploaded.url,
            modelSizeBytes: uploaded.size,
            contactName: contact.name,
            contactPhone: contact.phone || null,
            note: contact.note || null,
            // 这单的邮件通知语言 —— 落库,之后改状态时按它发信
            locale,
            // 收款通道 —— 微信扫码 / 支付宝 / Shopify,不传由服务端挑一个
            // 开放的通道
            channel: channel ?? undefined,
          }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            message?: string;
          } | null;
          setOrderError(body?.message ?? t("order.errors.submit"));
          setPhase("idle");
          return;
        }

        const created = (await res.json()) as PrintOrderCreated;
        setOrder(created);
        setStage("done");
        setPhase("idle");
        // 新单乐观插到列表顶部 —— 订单挂在账号名下,列表本身就是「我的订单」。
        // 服务端下一轮拉到这张单之后,以服务端为准。
        upsertOrder({
          orderNo: created.orderNo,
          status: "PENDING",
          modelFileName: uploaded.fileName,
          materialWeightG: created.quote.materialWeightG,
          supportWeightG: created.quote.supportWeightG,
          dims: created.quote.dims,
          totalPriceCents: created.quote.totalPriceCents,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
          paymentStatus: created.paymentStatus,
          paymentUrl: created.paymentUrl,
          paymentQrCodeUrl: created.paymentQrCodeUrl,
          paymentChannel: created.paymentChannel,
        });
      } catch (error) {
        console.error("[PrintQuote] 下单失败", error);
        setOrderError(t("order.errors.submit"));
        setPhase("idle");
      }
    },
    [
      quoteInput,
      modelPayload,
      quoteFresh,
      t,
      locale,
      upsertOrder,
      deliveryTier,
      channel,
    ]
  );

  const quoteSlot = useMemo(
    () => (
      <QuoteSummary
        quote={quote}
        loading={quoteLoading}
        stale={!quoteFresh}
        error={quoteError}
        ordering={stage === "form"}
        deliveryTier={deliveryTier}
        onDeliveryTierChange={setDeliveryTier}
        onStartOrder={() => {
          // 报价过期就别进填单 —— 进去之后表单上显示的还是旧价
          if (!quoteFresh) return;
          setStage("form");
          setOrderError(null);
        }}
      />
    ),
    [quote, quoteLoading, quoteError, quoteFresh, stage, deliveryTier]
  );

  return (
    <div className="space-y-8">
      <PricingCalculator
        showChrome={false}
        quoteMode
        onQuoteInput={handleQuoteInput}
        onModelChange={handleModelChange}
        quoteSlot={quoteSlot}
      />

      {stage === "form" && (
        <OrderForm
          quote={quote}
          modelName={modelPayload?.model.objFileName ?? ""}
          user={user}
          phase={phase}
          error={orderError}
          channel={channel}
          onChannelChange={setChannel}
          onSubmit={handleSubmitOrder}
          onCancel={() => {
            setStage("quote");
            setOrderError(null);
          }}
        />
      )}

      {stage === "done" && order && <OrderCreatedCard order={order} />}

      <PrintOrderList orders={orders} />
    </div>
  );
}
