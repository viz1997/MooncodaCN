"use client";

/**
 * 「加入购物袋」卡片 —— 挂在打印前工作台(`/tools/workbench`)的右栏
 *
 * ## 它是打印服务的**入口**,不是报价条
 *
 * 工作室的流程(2026-11-08 改):
 *
 *   /tools/workbench(量重量的工具,公开)
 *     → 量好 → 点「加入购物袋」
 *     → /cart(商城购物袋:打印服务那一行 + 目录商品 + 结算)
 *
 * 2026-11-06 到 2026-11-08 之间,打印服务走的是**自己的**打印单
 * (`/print-order` + 另一张车 + 另一个 cookie)。工作室后来改口了:
 * **「不要 print-order,进入商城那个」** —— 打印服务并进商城购物袋,跟目录
 * 商品走同一个 `/cart`、同一个 `/checkout`、一次付款。
 *
 * **工具里不自己算价** —— 价格是服务端算的。
 *
 * 2026-11-07 起,这张卡上多了一个**预估报价**(工作室的原话:「现在不登录
 * 也允许计价显示」):那是问服务端要的(`POST /api/print-quote`),不是本地
 * 算的;访客能不能看由后台 `/admin/print-pricing` 的「访客可见计价」开关
 * 决定。**最终金额仍在购物袋里确认。**
 *
 * ## 加进去的三步
 *
 * 1. 模型文件打包成 zip 直传 R2(`uploadModelFile()`)
 * 2. `POST /api/store/carts/{id}/line-items` —— 服务端**重算**一遍价
 *    (客户端算的价不信),落购物袋
 * 3. 跳 `/cart` —— 打印列表和下单金额在那儿
 *
 * ## 登录:**在量之前**登录
 *
 * 加购要登录 —— 工单挂在账号名下,模型文件也落到用户自己的 R2 分区里
 * (归属校验按那个分区算)。
 *
 * 没登录时按钮不是灰的,而是「去登录」:**登录那一下是整页跳转**,浏览器里的
 * 模型会没。所以文案写的是「先登录再量」,而不是让人量完再被弹去登录。
 *
 * ## 交期
 *
 * 工具页**不选交期** —— 一律按标准档加进购物袋,用户在购物袋里逐行改
 * (标准 / 加急 / 特急,三档的加价就摆在那一行上)。
 */

import { ArrowRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import type {
  EnsureSupportFn,
  PricingModelPayload,
} from "@/features/pricing/components/pricing-calculator-types";
import { PrintServiceQuotePreview } from "@/features/print-quote/components/print-service-quote-preview";
import { printOrderErrorMessageKey } from "@/features/print-quote/lib/print-order-error";
import type { PrintQuoteInput } from "@/features/print-quote/lib/quote-types";
import { uploadModelFile } from "@/features/print-quote/lib/upload-model";
import { useCart } from "@/features/storefront/hooks/use-cart";
import { buildPrintServiceSpecFromGeometry } from "@/features/storefront/lib/print-service";
import { Link, useRouter } from "@/i18n/routing";

/**
 * 把一次失败变成一句**用户看得懂**的话
 *
 * 服务端的失败都带稳定的 code —— 认得就摆具体的(「模型文件没找到,请重新
 * 上传」),不认得才退回笼统那句。映射表在
 * `print-quote/lib/print-order-error.ts`(纯文件,有单测守着)。
 *
 * 真实原因永远留在 console 里(`console.error`)—— 服务端的原始报错可能
 * 带着表结构这类内部信息,不该直接摆给访客。
 */
function describeFailure(err: unknown, t: (key: string) => string): string {
  const key = printOrderErrorMessageKey(err);
  if (key) return t(key);
  return t("printOrder.errors.addFailed");
}

export type PrintServiceAddToOrderProps = {
  /** 工具里当前量着的模型 —— 没有就还不能加 */
  model: PricingModelPayload | null;
  /** 计算器抛出来的几何 + 支撑 —— 服务端按这组数重算报价 */
  input: PrintQuoteInput | null;
  /**
   * 「按当前姿态把支撑算出来」—— 加购之前要 await 它
   *
   * 支撑**不跟随角度实时重算**(工作室 2026-11-07 的口径):用户把角度摆定
   * 之后点「包裹支撑」才算一次。用户没点过那颗按钮就直接加购的话,这里
   * 现算一次 —— 服务端按 `supportWeightG` 重算报价,少了它支撑费会算成 0
   * (收少了钱)。
   *
   * 已经算过就返回现成的,不重算。
   */
  ensureSupport?: EnsureSupportFn;
  /** 登录了吗 —— 没登录不能加打印单 */
  isLoggedIn: boolean;
  /** 登录链接(带 callbackUrl,登录完回到工具页) */
  signInUrl: string;
};

export function PrintServiceAddToOrder({
  model,
  input,
  ensureSupport,
  isLoggedIn,
  signInUrl,
}: PrintServiceAddToOrderProps) {
  const t = useTranslations("PrintQuote");
  const router = useRouter();

  /**
   * 购物袋 hook —— 加购跟目录商品走**同一条路**(2026-11-08)
   *
   * 工具页所在的那一组 layout 已经挂着商城头部(头部里有购物袋按钮,它自己
   * 就调 `useCart()`),所以购物车早就在了,这里不用再单独维护一份。
   */
  const { addPrintLine } = useCart();

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
      /**
       * 支撑克重 —— 服务端重算报价要这个数
       *
       * 支撑不跟随角度实时重算(用户点「包裹支撑」才算),所以用户可能
       * 没点过那颗按钮就直接加购了。这里现算一次 —— 少了它,服务端的
       * `input.supportWeightG ?? 0` 会把支撑费算成 0(收少了钱)。
       *
       * **算不出来就不加** —— 宁可让用户重试一次,也不能收少了钱。
       * 拿几何原样过去看着像「加成功了」,但支撑费是 0。
       */
      const fresh = ensureSupport ? await ensureSupport() : input;
      if (!fresh) {
        setError(t("printOrder.errors.supportUnavailable"));
        setPhase("idle");
        return;
      }

      // 模型文件在这里才离开浏览器 —— 量重量的过程一个字节都没传
      const uploaded = await uploadModelFile(model);

      await addPrintLine.mutateAsync({
        printSpec: buildPrintServiceSpecFromGeometry(fresh, {
          fileName: uploaded.fileName,
          objectKey: uploaded.objectKey,
          url: uploaded.url,
          sizeBytes: uploaded.size,
        }),
      });

      // 加完了去商城购物袋 —— 金额、交期、收货地址都在那儿
      router.push("/cart");
    } catch (err) {
      console.error("[PrintOrder] 加入购物袋失败", err);
      setError(describeFailure(err, t));
      setPhase("idle");
    }
  }, [model, input, ensureSupport, t, addPrintLine, router]);

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

        {/* 预估报价(2026-11-07)—— 访客也能看,后台一个开关管着 */}
        <PrintServiceQuotePreview input={input} />

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
