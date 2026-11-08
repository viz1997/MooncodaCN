"use client";

/**
 * PrintLineRow —— 购物袋里**打印服务**那一行的画法
 *
 * ## 为什么单独一个组件
 *
 * 打印服务并进商城购物袋之后(工作室的说法:「不要 print-order,进入商城那
 * 个」),这一行在**三个地方**出现:购物袋详情页(`/cart`)、购物袋抽屉、
 * 结算页(`/checkout`)。三处画的东西一样(模型名 / 尺寸 / 克重 / 支撑加价 /
 * 交期档位 / 行合计),各写一遍的话,过两天这三处就会长得不一样。
 *
 * 所以抽出来,三处共用。
 *
 * ## 三处给的 prop 不一样
 *
 * | 位置 | `onTierChange` | `onRemove` | 尺寸 |
 * |---|---|---|---|
 * | 购物袋页 | 有(能改交期) | 有 | 大 |
 * | 抽屉 | 无(空间不够,去详情页改) | 有 | 小 |
 * | 结算页 | 无(结算页上不给改) | 无 | 小 |
 *
 * 传了 `onTierChange` 就摆交期档位选择器,没传就不摆 —— 不是靠一个
 * `showXxx` 开关,省得两处对不上。
 *
 * ## 数字全是**服务端回填**的
 *
 * 耗材克重 / 支撑加价 / 各档比例 / 交期加价 —— 都是服务端重算报价时填进
 * `printSpec` 的(见 `cart-store.ts` 的 `repriceLineItem()`)。客户端不重算:
 * 客户端没有材料密度,也不认一份加价比例(比例在后台能调)。
 */

import { Package, Trash2 } from "lucide-react";

import { DeliveryTierPicker } from "@/features/print-quote/components/delivery-tier-picker";
import {
  DEFAULT_DELIVERY_RATES,
  type DeliveryTierId,
} from "@/features/print-quote/lib/delivery-tier";
import { formatCents } from "@/lib/money";

import { getPrintServiceSpec } from "../lib/print-service";
import type { CartLineItem } from "../types";

export type PrintLineRowProps = {
  item: CartLineItem;
  /** 有请求在飞 —— 按钮先禁用,免得连点 */
  busy?: boolean;
  /** 切交期档位 —— 不传就不摆选择器 */
  onTierChange?: (tier: DeliveryTierId) => void;
  /** 删掉这一行 —— 不传就不摆删除按钮 */
  onRemove?: () => void;
  /** 缩略图尺寸(抽屉 / 结算页用小一点) */
  size?: "sm" | "md";
  /** `<li>` 上的 class —— 抽屉那一行要带左右留白 */
  className?: string;
};

export function PrintLineRow({
  item,
  busy = false,
  onTierChange,
  onRemove,
  size = "md",
  className = "py-6",
}: PrintLineRowProps) {
  const printSpec = getPrintServiceSpec(item.metadata);
  if (!printSpec) return null;

  const lineTotalCents = item.discountedUnitPriceCents * item.quantity;

  /**
   * 不含加价的小计 —— 三档加价的基数
   *
   * 服务端重算的时候回填了 `deliveryFeeCents`(见 `cart-store.ts` 的
   * `repriceLineItem()`),减掉就是小计。有了它才能把「48 小时 +¥20.65」这种
   * 加价摆出来 —— 用户点加急之前就知道要加多少钱。
   */
  const subtotalCents = lineTotalCents - (printSpec.deliveryFeeCents ?? 0);

  const thumbClass =
    size === "sm"
      ? "size-16 rounded-sm bg-secondary flex items-center justify-center"
      : "size-20 rounded-sm bg-secondary flex items-center justify-center";
  const iconClass = size === "sm" ? "size-5" : "size-7";
  const titleClass =
    size === "sm"
      ? "font-serif text-[15px] leading-tight truncate"
      : "font-serif text-base leading-tight truncate";

  return (
    <li className={className}>
      <div className="flex gap-4">
        {/* 打印服务行没有封面图 —— 手上有的是模型文件(一个 zip),不是图片 */}
        <div className={thumbClass}>
          <Package className={`${iconClass} text-muted-foreground`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className={titleClass}>{printSpec.modelFileName}</p>
              <div className="mt-1 space-y-0.5">
                <p className="text-[11px] text-muted-foreground">
                  {printSpec.dims[0]} × {printSpec.dims[1]} ×{" "}
                  {printSpec.dims[2]} mm
                </p>
                {printSpec.materialWeightG != null && (
                  <p className="text-[11px] text-muted-foreground">
                    耗材 {printSpec.materialWeightG.toFixed(1)} g
                    {printSpec.supportWeightG != null &&
                      ` · 支撑 ${printSpec.supportWeightG.toFixed(1)} g`}
                  </p>
                )}
                {/*
                  支撑加价 —— **分段**收(工作室的规则:超 1:1 的按 0.5 元/g,
                  超 1:2 的按 1 元/g)。摆出「哪一段按哪个价收的」,用户不用
                  猜这一笔是怎么来的。

                  数字全是服务端回填的(`cart-store.ts` 的 `repriceLineItem()`),
                  客户端不重算 —— 各档 `feeCents` 之和恒等于这一行的支撑
                  加价,不会出现「加起来 ≠ 合计」。
                */}
                {(printSpec.supportFeeCents ?? 0) > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    支撑加价 {formatCents(printSpec.supportFeeCents ?? 0)}
                    {printSpec.supportFeeBands?.length
                      ? `（${printSpec.supportFeeBands
                          .map(
                            (band) =>
                              `${band.weightG.toFixed(1)} g × ${formatCents(band.priceCentsPerGram)}/g`
                          )
                          .join(" + ")}）`
                      : null}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3 shrink-0">
              <p className="text-sm font-medium">
                {formatCents(lineTotalCents)}
              </p>
              {onRemove && (
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={busy}
                  aria-label={`移除 ${printSpec.modelFileName}`}
                  className="text-muted-foreground hover:text-destructive transition-colors p-1 disabled:opacity-50 shrink-0"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </div>

          {/* 交期档位 —— 跟报价台共用一个选择器 */}
          {onTierChange && (
            <div className="mt-4 max-w-md">
              <DeliveryTierPicker
                value={printSpec.deliveryTier}
                rates={printSpec.deliveryRates ?? DEFAULT_DELIVERY_RATES}
                subtotalCents={subtotalCents}
                onChange={onTierChange}
                disabled={busy}
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
