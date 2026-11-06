"use client";

/**
 * 「加入打印单」卡片 —— 挂在克重工具(`/tools/weight`)的右栏
 *
 * ## 它是打印服务的**入口**,不是报价条
 *
 * 工作室的流程(2026-11-06):
 *
 *   /tools/weight(量重量的工具,公开)
 *     → 量好 → 点「加入打印单」
 *     → /print-order(打印列表 + 下单金额 + 收货地址 + 提交)
 *
 * 报价台(`/quote`)整页删掉之后,打印服务对外只有两页:工具页(量)、
 * 打印单(价 + 下单)。**工具里不显示价格** —— 价格只在打印单上出现。
 *
 * ## 加进去的三步
 *
 * 1. 模型文件打包成 zip 直传 R2(`uploadModelFile()`)
 * 2. `POST /api/store/print-carts/{id}/line-items` —— 服务端**重算**一遍价
 *    (客户端算的价不信),落打印单
 * 3. 跳 `/print-order` —— 打印列表和下单金额在那儿
 *
 * ## 登录:**在量之前**登录
 *
 * 加打印单要登录 —— 工单挂在账号名下,模型文件也落到用户自己的 R2 分区里
 * (归属校验按那个分区算)。
 *
 * 没登录时按钮不是灰的,而是「去登录」:**登录那一下是整页跳转**,浏览器里的
 * 模型会没。所以文案写的是「先登录再量」,而不是让人量完再被弹去登录。
 *
 * ## 交期
 *
 * 工具页**不选交期** —— 一律按标准档加进打印单,用户在打印单上逐行改
 * (标准 / 加急 / 特急,三档的加价就摆在那一行上)。
 */

import { ArrowRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import type { PricingModelPayload } from "@/features/pricing/components/pricing-calculator-types";
import type { PrintQuoteInput } from "@/features/print-quote/lib/quote-types";
import { uploadModelFile } from "@/features/print-quote/lib/upload-model";
import { usePrintCart } from "@/features/storefront/hooks/use-print-cart";
import { buildPrintServiceSpecFromGeometry } from "@/features/storefront/lib/print-service";
import { Link, useRouter } from "@/i18n/routing";

export type PrintServiceAddToOrderProps = {
  /** 工具里当前量着的模型 —— 没有就还不能加 */
  model: PricingModelPayload | null;
  /** 计算器抛出来的几何 + 支撑 —— 服务端按这组数重算报价 */
  input: PrintQuoteInput | null;
  /** 登录了吗 —— 没登录不能加打印单 */
  isLoggedIn: boolean;
  /** 登录链接(带 callbackUrl,登录完回到工具页) */
  signInUrl: string;
};

export function PrintServiceAddToOrder({
  model,
  input,
  isLoggedIn,
  signInUrl,
}: PrintServiceAddToOrderProps) {
  const t = useTranslations("PrintQuote");
  const router = useRouter();

  /**
   * 打印单 hook —— **不自动拉**
   *
   * 打开工具页不该顺手建一张空打印单(每个访客一行 DB + 一个 cookie)。
   * 等用户真的点了「加入打印单」,`addPrintLine` 自己去要那张车。
   */
  const { addPrintLine } = usePrintCart({ enabled: false });

  const [phase, setPhase] = useState<"idle" | "adding">("idle");
  const [error, setError] = useState<string | null>(null);

  /** 模型和几何都在才算「能加」 */
  const ready = Boolean(model && input);

  const handleAdd = useCallback(async () => {
    if (!model || !input) {
      setError(t("entry.errors.noModel"));
      return;
    }
    setError(null);
    setPhase("adding");

    try {
      // 模型文件在这里才离开浏览器 —— 量重量的过程一个字节都没传
      const uploaded = await uploadModelFile(model);

      await addPrintLine.mutateAsync({
        printSpec: buildPrintServiceSpecFromGeometry(input, {
          fileName: uploaded.fileName,
          objectKey: uploaded.objectKey,
          url: uploaded.url,
          sizeBytes: uploaded.size,
        }),
      });

      // 加完了去打印单 —— 金额、交期、收货地址都在那儿
      router.push("/print-order");
    } catch (err) {
      console.error("[PrintOrder] 加入打印单失败", err);
      setError(t("printOrder.errors.addFailed"));
      setPhase("idle");
    }
  }, [model, input, t, addPrintLine, router]);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border bg-muted px-3 py-2">
        <span className="text-xs font-medium text-foreground">
          {t("entry.title")}
        </span>
      </div>

      <div className="space-y-2 p-3">
        <p className="text-xs text-muted-foreground">
          {isLoggedIn ? t("entry.desc") : t("entry.descSignIn")}
        </p>

        {isLoggedIn ? (
          <button
            type="button"
            onClick={handleAdd}
            disabled={!ready || phase === "adding"}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {phase === "adding" ? t("printOrder.adding") : t("printOrder.add")}
            {phase === "adding" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ArrowRight className="size-3.5" />
            )}
          </button>
        ) : (
          <Link
            href={signInUrl}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t("entry.signInCta")}
            <ArrowRight className="size-3.5" />
          </Link>
        )}

        {error && <p className="text-[10px] text-destructive">{error}</p>}

        <p className="text-[10px] text-muted-foreground">
          {ready ? t("entry.ready") : t("entry.empty")}
        </p>
      </div>
    </div>
  );
}
