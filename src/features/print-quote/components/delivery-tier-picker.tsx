"use client";

/**
 * 交期档位选择器 —— 报价条里的三档(48 / 72 / 96 小时)
 *
 * ## 三档的价直接摆出来
 *
 * 用户要在**下单之前**就知道加急要加多少钱,不是选完了才在明细里看到。
 * 「48 小时 +$3.00 / 72 小时 +$0.81 / 96 小时 +$0.00」—— 跟工作室给的那
 * 张表是同一套口径(比例是反推出来的,见 `lib/delivery-tier.ts`)。
 *
 * ## 价在本地算,比例由服务端给
 *
 * 三档的价 = 报价小计 × 比例。比例是**服务端在报价里带回来的**
 * (`quote.deliveryRates`),前端不自己认一份 —— 服务端的比例可以用环境变量
 * 调,前端自己认一份就会出现「页面写 +$3.00、实际收 $2.98」。
 *
 * 算价函数跟服务端是**同一个**(`computeDeliveryFeeCents`),所以选中那一档
 * 算出来的数一定等于服务端报价里的加价。
 *
 * ## 没报价时只显示档位
 *
 * 还没报价(模型没上传)就没有小计,也就没有价 —— 这时候只摆档位和名字,
 * 价格位置留「—」。不拿「猜的价」占位,免得用户以为那就是最终价。
 */

import { useTranslations } from "next-intl";
import {
  computeDeliveryFeeCents,
  DELIVERY_TIERS,
  type DeliveryRates,
  type DeliveryTierId,
} from "@/features/print-quote/lib/delivery-tier";
import { formatCents } from "@/features/print-quote/lib/format";

export type DeliveryTierPickerProps = {
  /** 当前选中的档位 */
  value: DeliveryTierId;
  /** 各档比例 —— 服务端报价里带回来的 */
  rates: DeliveryRates;
  /** 报价小计(分);null = 还没报价 */
  subtotalCents: number | null;
  /** 切档位 —— 父组件要重新去服务端报价 */
  onChange: (tier: DeliveryTierId) => void;
  /** 报价请求进行中 —— 切档位的那一下先锁住 */
  disabled?: boolean;
};

export function DeliveryTierPicker({
  value,
  rates,
  subtotalCents,
  onChange,
  disabled = false,
}: DeliveryTierPickerProps) {
  const t = useTranslations("PrintQuote");

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">
          {t("delivery.label")}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {t("delivery.hint")}
        </span>
      </div>

      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {DELIVERY_TIERS.map((tier) => {
          const selected = tier.id === value;
          const fee =
            subtotalCents === null
              ? null
              : computeDeliveryFeeCents(subtotalCents, tier.id, rates);

          return (
            <button
              key={tier.id}
              type="button"
              onClick={() => onChange(tier.id)}
              aria-pressed={selected}
              disabled={disabled}
              className={`rounded-md border px-2 py-1.5 text-left transition-colors disabled:opacity-50 ${
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border hover:border-foreground/40"
              }`}
            >
              <span className="block text-[11px] font-medium leading-tight">
                {t("delivery.hours", { hours: tier.hours })}
              </span>
              <span
                className={`mt-0.5 block text-[10px] leading-tight ${
                  selected ? "text-background/70" : "text-muted-foreground"
                }`}
              >
                {t(`delivery.tier.${tier.id}`)}
              </span>
              <span
                className={`mt-0.5 block font-mono text-[10px] leading-tight ${
                  selected ? "text-background/90" : "text-muted-foreground"
                }`}
              >
                {fee === null
                  ? "—"
                  : fee === 0
                    ? t("delivery.free")
                    : `+${formatCents(fee)}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
