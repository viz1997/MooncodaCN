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

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PricingCalculator,
  type PricingModelPayload,
} from "@/features/pricing/components/pricing-calculator";
import {
  buildModelZipBlob,
  exportRotatedObj,
} from "@/features/pricing/lib/obj-exporter";
import {
  type OrderContact,
  OrderForm,
} from "@/features/print-quote/components/order-form";
import { OrderList } from "@/features/print-quote/components/order-list";
import { QuoteSummary } from "@/features/print-quote/components/quote-summary";
import { saveLocalOrder } from "@/features/print-quote/lib/local-orders";
import type {
  PrintOrderCreated,
  PrintQuote,
  PrintQuoteInput,
} from "@/features/print-quote/lib/quote-types";

type Stage = "quote" | "form" | "done";

export function QuoteWorkbench() {
  const t = useTranslations("PrintQuote");

  const [quoteInput, setQuoteInput] = useState<PrintQuoteInput | null>(null);
  const [modelPayload, setModelPayload] = useState<PricingModelPayload | null>(
    null
  );

  /**
   * 服务端报价 —— 连同「它是按哪组几何算出来的」一起存。
   *
   * 只存报价不够:用户改了尺寸之后,新报价要等 400ms 防抖 + 一次往返才回来,
   * 这期间界面上挂的还是**旧几何的价**。只看「有没有报价」来决定能不能下单,
   * 就会让用户按旧价确认、服务端按新价建单 —— 两边对不上。
   *
   * 所以报价必须带着它的输入一起存,靠 `quoteFresh` 判断它跟当前几何还对不对得上。
   */
  const [quoteResult, setQuoteResult] = useState<{
    input: PrintQuoteInput;
    quote: PrintQuote;
  } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const quote = quoteResult?.quote ?? null;

  /**
   * 挂着的报价跟当前几何还对得上吗?
   *
   * 对不上 = 界面上的价是上一组尺寸的,不能拿去下单。
   */
  const quoteFresh = useMemo(
    () =>
      quoteResult !== null &&
      quoteInput !== null &&
      sameQuoteInput(quoteResult.input, quoteInput),
    [quoteResult, quoteInput]
  );

  const [stage, setStage] = useState<Stage>("quote");
  const [phase, setPhase] = useState<"idle" | "uploading" | "submitting">(
    "idle"
  );
  const [orderError, setOrderError] = useState<string | null>(null);
  const [order, setOrder] = useState<PrintOrderCreated | null>(null);

  const handleQuoteInput = useCallback((input: PrintQuoteInput | null) => {
    setQuoteInput(input);
  }, []);

  const handleModelChange = useCallback(
    (payload: PricingModelPayload | null) => {
      setModelPayload(payload);
    },
    []
  );

  // ---- 报价请求(防抖) ----
  //
  // 拖尺寸滑块会连着触发几十次几何变化 —— 不防抖就是几十次请求。
  // 400ms 是个体感合适的值:停手之后价格立刻跟上。
  //
  // `latestInputRef` 存当前几何:响应回来时先比一下,晚到的旧响应直接丢,
  // 免得旧几何的价把新几何的价盖掉。
  const latestInputRef = useRef(quoteInput);
  useEffect(() => {
    latestInputRef.current = quoteInput;
  }, [quoteInput]);

  useEffect(() => {
    if (!quoteInput) {
      setQuoteResult(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }

    const requestedInput = quoteInput;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setQuoteLoading(true);
      void (async () => {
        try {
          const res = await fetch("/api/print-quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestedInput),
            signal: controller.signal,
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as {
              message?: string;
            } | null;
            setQuoteError(body?.message ?? t("quote.error"));
            setQuoteResult(null);
            return;
          }
          const body = (await res.json()) as { quote: PrintQuote };
          // 几何在这期间又变了 → 这个价已经过期,丢掉(新请求在路上)
          if (!sameQuoteInput(requestedInput, latestInputRef.current)) return;
          setQuoteResult({ input: requestedInput, quote: body.quote });
          setQuoteError(null);
        } catch (error) {
          // 几何又变了 → 这次请求作废,新的请求已经在路上
          if ((error as Error)?.name === "AbortError") return;
          setQuoteError(t("quote.error"));
          setQuoteResult(null);
        } finally {
          if (!controller.signal.aborted) setQuoteLoading(false);
        }
      })();
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [quoteInput, t]);

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
            quote: quoteInput,
            modelFileName: uploaded.fileName,
            objectKey: uploaded.objectKey,
            modelUrl: uploaded.url,
            modelSizeBytes: uploaded.size,
            contactName: contact.name,
            contactEmail: contact.email,
            contactPhone: contact.phone || null,
            note: contact.note || null,
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
        saveLocalOrder({
          orderNo: created.orderNo,
          token: created.token,
          createdAt: created.createdAt,
        });
      } catch (error) {
        console.error("[PrintQuote] 下单失败", error);
        setOrderError(t("order.errors.submit"));
        setPhase("idle");
      }
    },
    [quoteInput, modelPayload, quoteFresh, t]
  );

  const quoteSlot = useMemo(
    () => (
      <QuoteSummary
        quote={quote}
        loading={quoteLoading}
        stale={!quoteFresh}
        error={quoteError}
        ordering={stage === "form"}
        onStartOrder={() => {
          // 报价过期就别进填单 —— 进去之后表单上显示的还是旧价
          if (!quoteFresh) return;
          setStage("form");
          setOrderError(null);
        }}
      />
    ),
    [quote, quoteLoading, quoteError, quoteFresh, stage]
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
          phase={phase}
          error={orderError}
          onSubmit={handleSubmitOrder}
          onCancel={() => {
            setStage("quote");
            setOrderError(null);
          }}
        />
      )}

      {stage === "done" && order && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5">
          <h3 className="text-base font-semibold text-emerald-900">
            {t("order.successTitle")}
          </h3>
          <p className="mt-1 text-sm text-emerald-800/80">
            {t("order.successBody")}
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-emerald-800/70">
                {t("order.orderNo")}
              </dt>
              <dd className="mt-0.5 font-mono text-sm font-medium text-emerald-900">
                {order.orderNo}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-emerald-800/70">
                {t("quote.total")}
              </dt>
              <dd className="mt-0.5 font-mono text-sm font-medium text-emerald-900">
                {new Intl.NumberFormat("zh-CN", {
                  style: "currency",
                  currency: "CNY",
                }).format(order.quote.totalPriceCents / 100)}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-emerald-800/70">
            {t("order.successHint")}
          </p>
        </div>
      )}

      <OrderList />
    </div>
  );
}

/**
 * 把模型打包成 ZIP 直传到 R2
 *
 * 打包时按用户调过的尺寸重新缩放 —— 否则工作室拿到的文件尺寸和报价单上
 * 的对不上。**不旋转**:报价单上的尺寸是未旋转的包围盒,旋转后包围盒会变,
 * 两边对不上;摆盘角度是给工作室的参考,不是硬约束。
 */
async function uploadModelFile(payload: PricingModelPayload): Promise<{
  url: string;
  objectKey: string;
  size: number;
  fileName: string;
}> {
  const { model, scales } = payload;

  const objText = exportRotatedObj(
    model.objText,
    { rotX: 0, rotY: 0, rotZ: 0 },
    { scaleX: scales[0], scaleY: scales[1], scaleZ: scales[2] }
  );

  const blob = await buildModelZipBlob(
    objText,
    model.mtlText,
    model.textureBlobs,
    model.objFileName,
    model.mtlFileName
  );

  const fileName = `${model.name || "model"}.zip`;

  const presignRes = await fetch("/api/print-orders/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, size: blob.size }),
  });
  if (!presignRes.ok) {
    const body = (await presignRes.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "presign failed");
  }

  const presign = (await presignRes.json()) as {
    uploadUrl: string;
    publicUrl: string;
    objectKey: string;
    headers: Record<string, string>;
  };

  const putRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers,
    body: blob,
  });
  if (!putRes.ok) {
    throw new Error(`R2 PUT failed: ${putRes.status}`);
  }

  return {
    url: presign.publicUrl,
    objectKey: presign.objectKey,
    size: blob.size,
    fileName,
  };
}

/**
 * 两组几何是不是同一组
 *
 * 按值比 —— 几何每次变化都是新对象,比引用永远不相等。
 * 报价是否过期、下单前的一致性检查都靠它。
 */
function sameQuoteInput(
  a: PrintQuoteInput | null,
  b: PrintQuoteInput | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.volumeCM3 === b.volumeCM3 &&
    a.surfaceAreaCM2 === b.surfaceAreaCM2 &&
    a.dims[0] === b.dims[0] &&
    a.dims[1] === b.dims[1] &&
    a.dims[2] === b.dims[2] &&
    (a.supportWeightG ?? null) === (b.supportWeightG ?? null) &&
    (a.selfSupportRatio ?? null) === (b.selfSupportRatio ?? null)
  );
}
