"use client";

/**
 * 打印前工作台 —— `/tools/workbench`
 *
 * ## 它是打印服务的**第一步**
 *
 * 工作室的流程(2026-11-06):
 *
 *   /tools/workbench(量重量的工具,公开)→ 点「加入打印单」→ /print-order(打印单)
 *
 * 报价台(`/quote`)2026-11-06 整页删掉 —— 它跟工具页用的是**同一个**克重
 * 计算器,重复了一份「报价 + 交期 + 加进打印单」的下单控件。工作室要的是
 * 「工具里量完直接加进打印单,金额在打印单上确认」。
 *
 * | 页面 | 是什么 | 出口 |
 * |---|---|---|
 * | `/tools/workbench` | **工具**:只算不存、不显示价格 | 「加入打印单」→ `/print-order` |
 * | `/print-order` | **下单**:打印列表 + 下单金额 + 收货地址 | 一次付款 |
 *
 * 价格、交期、下单**只在打印单**那一条路上。工具页不调服务端报价接口,
 * 量重量的过程里一个网络请求都没有(除材料参数的密码校验)。
 *
 * ## 两条边界照旧
 *
 * - **工具页不显示价格** —— 价格是服务端算的,工具页只出几何
 * - **模型不上传** —— 上传是**加购动作**的一部分,不是量重量的副产品
 *
 * ## 为什么在商城路由组里
 *
 * `/tools/workbench` 在 `(marketing-atelier)` 下 —— 那一组挂着 `<CartDrawer />`。
 * 工具页自己不卖东西,但商城里能一键跳过去量。
 */

import { useCallback, useState } from "react";

import { PricingCalculator } from "@/features/pricing/components/pricing-calculator";
import type { PricingModelPayload } from "@/features/pricing/components/pricing-calculator-types";
import { PrintServiceAddToOrder } from "@/features/print-quote/components/print-service-add-to-order";
import type { ClientPrintConfig } from "@/features/print-quote/lib/pricing-settings";
import type { PrintQuoteInput } from "@/features/print-quote/lib/quote-types";

export function PrintServiceWeightTool({
  isLoggedIn,
  signInUrl,
  clientConfig,
}: {
  /** 登录了吗 —— 没登录不能加打印单(工单要挂在账号名下) */
  isLoggedIn: boolean;
  /** 登录链接(带 callbackUrl,登录完回到工具页) */
  signInUrl: string;
  /**
   * 生效中的打印定价设置(密度 / 支撑几何)
   *
   * **访客改不了** —— 由页面的 RSC 从后台 `/admin/print-pricing` 读出来
   * (兜底 `PRINT_*` 环境变量)传下来。工具页只显示克重,不显示价格。
   */
  clientConfig: ClientPrintConfig;
}) {
  /**
   * 当前量着的模型 —— 加进打印单时要按它打包上传
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

  const handleModelChange = useCallback(
    (payload: PricingModelPayload | null) => {
      setModel(payload);
    },
    []
  );

  const handleQuoteInput = useCallback((next: PrintQuoteInput | null) => {
    setInput(next);
  }, []);

  return (
    <PricingCalculator
      showChrome={false}
      clientConfig={clientConfig}
      onModelChange={handleModelChange}
      onQuoteInput={handleQuoteInput}
      quoteSlot={
        <PrintServiceAddToOrder
          model={model}
          input={input}
          isLoggedIn={isLoggedIn}
          signInUrl={signInUrl}
        />
      }
    />
  );
}
