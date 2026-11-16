"use client";

/**
 * 配送方式选择器 —— 三档(顺丰到付 / 顺丰标快 / 顺丰空运)
 *
 * ## 配送方式跟交期档位是**两个正交的轴**
 *
 * | 轴 | 回答的问题 | 收多少钱 |
 * |---|---|---|
 * | **交期档位**(`delivery-tier-picker.tsx`) | **多快做好** | 小计的百分比 |
 * | **配送方式**(本文件) | **怎么寄** | 固定金额,按单收 |
 *
 * 两者互不影响:选「特急」不改变运费,选「空运」也不改变加急费。
 *
 * ## 价在本地算,运费表由服务端给
 *
 * 三档的运费 = `fees` 那一列,而 `fees` 是**服务端在报价里带回来的**
 * (`quote.shippingFees`)—— 前端不自己认一份。后台 `/admin/print-pricing`
 * 能改运费,两边各认一份就会出现「页面写 ¥18、实际收 ¥0」。
 *
 * 算价函数跟服务端是**同一个**(`computeShippingFeeCents`)。
 *
 * ## 运费**不乘件数**
 *
 * 工作室的原话「运费按单收取」—— 多件装一个箱,一个运费。所以件数那一栏
 * 只影响克重费 / 后处理费 / 支撑加价,不影响这里。
 *
 * ## 「到付」那一档显示「收件人付款」而不是「¥0」
 *
 * 它的运费确实是 0(工作室自己付),但显示「¥0」会让人以为**免运费** ——
 * 实际是收件人签收时付钱。写清楚比显示一个 0 好。
 */

import {
  computeShippingFeeCents,
  SHIPPING_OPTIONS,
  type ShippingFees,
  type ShippingOptionId,
} from "@mooncoda/print-tool-core/quote/shipping-option";
import { useTranslations } from "next-intl";
import { formatCents } from "@/features/print-quote/lib/format";

export type ShippingOptionPickerProps = {
  /** 当前选中的配送方式 */
  value: ShippingOptionId;
  /** 各档运费(分)—— 服务端报价里带回来的 */
  fees: ShippingFees;
  /** 切档位 —— 父组件要重新去服务端报价 */
  onChange: (option: ShippingOptionId) => void;
  /** 报价请求进行中 —— 切档位的那一下先锁住 */
  disabled?: boolean;
};

export function ShippingOptionPicker({
  value,
  fees,
  onChange,
  disabled = false,
}: ShippingOptionPickerProps) {
  const t = useTranslations("PrintQuote");

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">
          {t("shipping.label")}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {t("shipping.hint")}
        </span>
      </div>

      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {SHIPPING_OPTIONS.map((option) => {
          const selected = option.id === value;
          const fee = computeShippingFeeCents(option.id, fees);

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              aria-pressed={selected}
              disabled={disabled}
              className={`rounded-md border px-2 py-1.5 text-left transition-colors disabled:opacity-50 ${
                selected
                  ? "border-foreground bg-foreground text-background"
                  : "border-border hover:border-foreground/40"
              }`}
            >
              <span className="block text-[11px] font-medium leading-tight">
                {t(`shipping.option.${option.id}`)}
              </span>
              <span
                className={`mt-0.5 block text-[10px] leading-tight ${
                  selected ? "text-background/70" : "text-muted-foreground"
                }`}
              >
                {t("shipping.days", { days: option.days })}
              </span>
              <span
                className={`mt-0.5 block font-mono text-[10px] leading-tight ${
                  selected ? "text-background/90" : "text-muted-foreground"
                }`}
              >
                {fee === 0 ? t("shipping.receiverPays") : formatCents(fee)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
