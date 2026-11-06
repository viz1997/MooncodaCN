"use client";

/**
 * 克重工具 —— `/tools/weight`
 *
 * ## 它跟 `/quote` 的关系
 *
 * 两个页面用的是**同一个**克重计算器(`PricingCalculator`),分工不同:
 *
 * | 页面 | 是什么 | 报价之后 |
 * |---|---|---|
 * | `/tools/weight` | **工具**:只算不存、不显示价格、模型不上传 | 给一个「报价下单」入口 → 去 `/quote` |
 * | `/quote` | **服务**:能报价、能下单 | 选交期 → 填信息 → 付款 |
 *
 * 价格、交期、下单**只在报价台**那一条路上。工具页不调服务端报价接口,
 * 量重量的过程里一个网络请求都没有(除材料参数的密码校验)。
 *
 * ## 2026-11-06:工具页撤下报价条,改成报价下单入口
 *
 * 2026-11-05 曾在工具页挂过「报价 + 交期 + 加入购物车」那一整套 —— 跟
 * `/quote` 平行的一份,金额对得上但**多了一套要维护的下单控件**。
 * 工作室的要求是:工具里不该直接放这些,给一个报价下单入口就够。
 *
 * 撤掉之后:
 * - 工具页不再显示价格 → 计算器跑**工具模式**(`quoteMode` 不开),几何数据
 *   不抛给服务端,也就没有报价请求
 * - 模型不上传 → 上传是**下单动作**的一部分,不是量重量的副产品
 * - 量好的模型**接力**给报价台(`lib/model-handoff.ts`),用户不用重选文件
 *
 * ## 为什么在商城路由组里
 *
 * `/tools/weight` 在 `(marketing-atelier)` 下 —— 那一组挂着 `<CartDrawer />`。
 * 工具页自己不卖东西,但商城里能一键跳过去报价。
 */

import { useCallback, useState } from "react";

import { PricingCalculator } from "@/features/pricing/components/pricing-calculator";
import type { PricingModelPayload } from "@/features/pricing/components/pricing-calculator-types";
import { PrintServiceQuoteEntry } from "@/features/print-quote/components/print-service-quote-entry";

export function PrintServiceWeightTool({
  isLoggedIn,
}: {
  /** 登录了吗 —— 没登录去报价台会先被弹去登录页,模型接力会丢 */
  isLoggedIn: boolean;
}) {
  /**
   * 当前量着的模型 —— 接力给报价台用
   *
   * 计算器在**工具模式**下也会抛这个(模型不是报价专属的东西)。
   */
  const [modelPayload, setModelPayload] = useState<PricingModelPayload | null>(
    null
  );

  const handleModelChange = useCallback(
    (payload: PricingModelPayload | null) => {
      setModelPayload(payload);
    },
    []
  );

  return (
    <PricingCalculator
      showChrome={false}
      onModelChange={handleModelChange}
      quoteSlot={
        <PrintServiceQuoteEntry model={modelPayload} isLoggedIn={isLoggedIn} />
      }
    />
  );
}
