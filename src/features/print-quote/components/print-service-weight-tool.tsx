"use client";

/**
 * 打印前工作台 —— `/tools/workbench`
 *
 * ## 它是打印服务的**第一步**
 *
 * 工作室的流程(2026-11-08 改):
 *
 *   /tools/workbench(量重量的工具,公开)
 *     → 量好 → 点「填写下单信息」→ 表单展开在下面
 *     → 提交 → 服务端重算报价 + 建工单
 *     → 跳 `/account/print-orders/{orderNo}` —— 钱在那儿付
 *
 * 报价台(`/quote`)2026-11-06 整页删掉 —— 它跟工具页用的是**同一个**克重
 * 计算器,重复了一份「报价 + 交期 + 下单」的下单控件。
 *
 * ## 打印服务**不进商城购物袋**(2026-11-08)
 *
 * 工作室的原话:**「不要放入购物车,放在这里 account/print-orders」**。
 *
 * 商城购物袋只装**目录商品**;打印服务是**另一条线**:工单自己建、自己收款。
 * 2026-11-08 之前那一版是「打印服务并进商城购物袋」—— 那条路整个退回去了。
 *
 * | 页面 | 是什么 | 出口 |
 * |---|---|---|
 * | `/tools/workbench` | **工具**:只算不存;右栏那张卡摆一个服务端算的预估价 | 「填写下单信息」→ 表单 → 提交 |
 * | `/account/print-orders` | **我的打印订单**:工单列表 | 详情页付款 / 看进度 |
 *
 * ## 两条边界照旧
 *
 * - **工具页不自己算价** —— 价格是服务端算的,工具页只出几何
 * - **模型不上传** —— 上传是**提交订单**的一部分,不是量重量的副产品
 *
 * ## 为什么在商城路由组里
 *
 * `/tools/workbench` 在 `(marketing-atelier)` 下 —— 那一组挂着商城头部。
 * 工具页自己不卖东西,但商城里能一键跳过去量。
 */

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";

import type { AddressView } from "@/features/address/types";
import { PricingCalculator } from "@/features/pricing/components/pricing-calculator";
import type {
  EnsureSupportFn,
  PricingModelPayload,
} from "@/features/pricing/components/pricing-calculator-types";
import {
  PrintServiceOrderForm,
  type PrintServiceOrderFormProps,
  type PrintServiceOrderValues,
} from "@/features/print-quote/components/print-service-order-form";
import { PrintServiceSubmitCard } from "@/features/print-quote/components/print-service-submit-card";
import {
  DEFAULT_DELIVERY_TIER,
  type DeliveryRates,
  type DeliveryTierId,
} from "@/features/print-quote/lib/delivery-tier";
import type { ClientPrintConfig } from "@/features/print-quote/lib/pricing-settings";
import { printOrderErrorMessageKey } from "@/features/print-quote/lib/print-order-error";
import type {
  PrintQuote,
  PrintQuoteInput,
} from "@/features/print-quote/lib/quote-types";
import { uploadModelFile } from "@/features/print-quote/lib/upload-model";
import { toRequestError } from "@/features/shared/lib/request-error";
import { useRouter } from "@/i18n/routing";

export function PrintServiceWeightTool({
  isLoggedIn,
  signInUrl,
  clientConfig,
  addresses,
  user,
}: {
  /** 登录了吗 —— 没登录不能建工单(工单要挂在账号名下) */
  isLoggedIn: boolean;
  /** 登录链接(带 callbackUrl,登录完回到工具页) */
  signInUrl: string;
  /**
   * 生效中的打印定价设置(密度 / 支撑几何)
   *
   * **访客改不了** —— 由页面的 RSC 从后台 `/admin/print-pricing` 读出来
   * (兜底 `PRINT_*` 环境变量)传下来。工具页的克重是本地算的,价格一律
   * 服务端算(这张配置里没有单价 / 后处理 / 阈值 / 交期比例)。
   */
  clientConfig: ClientPrintConfig;
  /** 地址簿(服务端查好传进来)—— 下单要选收货地址 */
  addresses: AddressView[];
  /** 当前用户 —— 称呼预填,邮箱只读展示 */
  user: { name: string; email: string };
}) {
  const t = useTranslations("PrintQuote");
  const locale = useLocale();
  const router = useRouter();

  /**
   * 当前量着的模型 —— 提交订单时要按它打包上传
   *
   * 计算器在两种场合都会抛这个:模型换了几何变了(缩放改了)都会更新。
   */
  const [model, setModel] = useState<PricingModelPayload | null>(null);

  /**
   * 当前几何 + 支撑 —— 服务端按这组数重算报价
   *
   * 计算器本地算出来的(体积 / 表面积 / 尺寸 / 支撑克重),**不是价格**。
   * 价格一律服务端算(见 `print-quote/lib/quote-server.ts`)。
   */
  const [input, setInput] = useState<PrintQuoteInput | null>(null);

  /* ------------------------------------------------------------------ */
  /*  下单状态                                                            */
  /* ------------------------------------------------------------------ */

  /** 表单展开了没有 —— 点右栏那颗「填写下单信息」才展开 */
  const [formOpen, setFormOpen] = useState(false);

  /** 交期档位 —— 默认标准档,加价由服务端按比例算 */
  const [deliveryTier, setDeliveryTier] = useState<DeliveryTierId>(
    DEFAULT_DELIVERY_TIER
  );

  /**
   * 服务端报价
   *
   * **只在新报价到达时更新** —— 换档位的那一下会重新去服务端问价,那几百毫
   * 秒里报价是「旧的」。要是这时候把报价清成 null,交期选择器就**没有比例
   * 了**(比例是报价带回来的)—— 三档的加价会整块消失。
   */
  const [quote, setQuote] = useState<PrintQuote | null>(null);
  const [rates, setRates] = useState<DeliveryRates | null>(null);

  /** 选中的收货地址 */
  const [addressId, setAddressId] = useState<string | null>(
    addresses[0]?.id ?? null
  );

  /** 选中的收款通道 —— null = 让服务端挑第一个「开放了而且配好了」的 */
  const [channel, setChannel] = useState<string | null>(null);

  /** 提交进度 / 上一次失败的话 */
  const [phase, setPhase] = useState<"idle" | "submitting">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleModelChange = useCallback(
    (payload: PricingModelPayload | null) => {
      setModel(payload);
    },
    []
  );

  const handleQuoteInput = useCallback((next: PrintQuoteInput | null) => {
    setInput(next);
  }, []);

  const handleQuote = useCallback((next: PrintQuote | null) => {
    if (!next) return;
    setQuote(next);
    setRates(next.deliveryRates);
  }, []);

  /**
   * 「按当前姿态算支撑」的入口 —— 提交订单之前要 await 它
   *
   * 支撑**不跟随角度实时重算**(工作室 2026-11-07 的口径):用户把角度摆定
   * 之后点「包裹支撑」才算一次。但提交订单必须带上支撑克重 ——
   * 服务端按它重算报价,少了它支撑费会算成 0(收少了钱)。
   *
   * 所以提交之前:没算过就现算一次(计算器那边已经算过就直接给现成的)。
   */
  const ensureSupportRef = useRef<EnsureSupportFn | null>(null);
  const handleEnsureSupport = useCallback((ensure: EnsureSupportFn) => {
    ensureSupportRef.current = ensure;
  }, []);
  const ensureSupport = useCallback(async () => {
    return (await ensureSupportRef.current?.()) ?? null;
  }, []);

  /**
   * 提交订单
   *
   * 四步:① 算支撑 → ② 打包模型直传 R2 → ③ 服务端重算报价 + 建工单
   * → ④ 跳工单详情页(钱在那儿付)。
   *
   * **服务端重算** —— 客户端带来的价一律不信(工具页本来就不算价,这里传的
   * 只是几何)。
   */
  const handleSubmit = useCallback(
    async (values: PrintServiceOrderValues) => {
      if (!model) {
        setError(t("entry.errors.noModel"));
        return;
      }
      setError(null);
      setPhase("submitting");

      try {
        /**
         * 支撑克重 —— 服务端重算报价要这个数
         *
         * 支撑不跟随角度实时重算(用户点「包裹支撑」才算),所以用户可能
         * 没点过那颗按钮就直接提交了。这里现算一次 —— 少了它,服务端的
         * `input.supportWeightG ?? 0` 会把支撑费算成 0(收少了钱)。
         *
         * **算不出来就不提交** —— 宁可让用户重试一次,也不能收少了钱。
         */
        const fresh = await ensureSupport();
        if (!fresh) {
          setError(t("printOrder.errors.supportUnavailable"));
          setPhase("idle");
          return;
        }

        // 模型文件在这里才离开浏览器 —— 量重量的过程一个字节都没传
        const uploaded = await uploadModelFile(model);

        const response = await fetch("/api/print-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quote: { ...fresh, deliveryTier: values.deliveryTier },
            modelFileName: uploaded.fileName,
            objectKey: uploaded.objectKey,
            modelUrl: uploaded.url,
            modelSizeBytes: uploaded.size,
            contactName: values.contactName,
            contactPhone: values.contactPhone || null,
            note: values.note || null,
            addressId: values.addressId,
            locale,
            channel: values.channel,
          }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          // 带上 code —— 界面据此摆具体的话(「收货地址不存在」而不是
          // 「请稍后重试」)
          throw toRequestError(body, response.status);
        }

        const created = (await response.json()) as { orderNo: string };
        // 跳工单详情页 —— 付款入口在那儿(工单自己收款)
        router.push(`/account/print-orders/${created.orderNo}`);
      } catch (err) {
        console.error("[PrintOrder] 提交打印订单失败", err);
        setError(describeFailure(err, t));
        setPhase("idle");
      }
    },
    [model, ensureSupport, locale, router, t]
  );

  const formProps: Omit<
    PrintServiceOrderFormProps,
    "phase" | "error" | "onSubmit" | "onCancel"
  > = {
    quote,
    rates,
    deliveryTier,
    onDeliveryTierChange: setDeliveryTier,
    addresses,
    addressId,
    onAddressChange: setAddressId,
    user,
    modelName: model?.model?.name ?? "",
    channel,
    onChannelChange: setChannel,
  };

  return (
    <>
      <PricingCalculator
        showChrome={false}
        clientConfig={clientConfig}
        onModelChange={handleModelChange}
        onQuoteInput={handleQuoteInput}
        onEnsureSupport={handleEnsureSupport}
        quoteSlot={
          <PrintServiceSubmitCard
            input={input}
            deliveryTier={deliveryTier}
            onQuote={handleQuote}
            onStart={() => setFormOpen(true)}
            formOpen={formOpen}
            isLoggedIn={isLoggedIn}
            signInUrl={signInUrl}
          />
        }
      />

      {formOpen && isLoggedIn ? (
        <PrintServiceOrderForm
          {...formProps}
          phase={phase}
          error={error}
          onSubmit={handleSubmit}
          onCancel={() => {
            setFormOpen(false);
            setError(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * 把一次失败变成一句**用户看得懂**的话
 *
 * 服务端的失败都带稳定的 code —— 认得就摆具体的,认不出才退回笼统那句。
 * 映射表在 `print-quote/lib/print-order-error.ts`(纯文件,有单测守着)。
 *
 * 真实原因永远留在 console 里(`console.error`)—— 服务端的原始报错可能
 * 带着表结构这类内部信息,不该直接摆给访客。
 */
function describeFailure(err: unknown, t: (key: string) => string): string {
  const key = printOrderErrorMessageKey(err);
  if (key) return t(key);
  return t("printOrder.errors.addFailed");
}
