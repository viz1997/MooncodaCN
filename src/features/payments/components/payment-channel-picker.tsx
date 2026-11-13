/**
 * 支付方式选择器 —— 「微信 / 支付宝 / Shopify(银行卡)」
 *
 * ## 通道清单从服务端拿
 *
 * `GET /api/store/payment-channels` 返回**当前开放了**的通道,每个都带一个
 * `available`(配好了没)。
 *
 * **没配好的也显示** —— 显示成灰的、标着「暂未开放」。工作室要让人看见支持
 * 哪几种付款方式,但没配好的那一个**不能点**:点了服务端只会 503
 * (`PAYMENT_CHANNEL_UNAVAILABLE`)。让用户点一个注定失败的按钮,比把这个
 * 选项灰掉更糟。
 *
 * 「开放了」是工作室那边的开关(`ENABLED_PAYMENT_CHANNELS`),「配好了」是
 * 环境变量齐没齐 —— 两道闸,各管一件事。
 *
 * ## 拉不到清单怎么办
 *
 * 拉不到就**不渲染选择器** —— 结算页退回到「不传通道」,服务端挑第一个
 * 「开放了而且配好了」的通道(挑不到就报「暂时没有可用的在线支付方式」)。
 * 这不是静默降级到错的地方:拉不到清单本身就意味着环境变量大概率也没配,
 * 那条路本来也建不出支付会话(订单照样建,状态停在 unpaid,走线下)。
 *
 * ## 选中哪个
 *
 * 默认选第一个**配好了**的。用户没选就点「去支付」时,得有个合理的默认值 ——
 * 而不是把 `null` 发给服务端让服务端替用户挑。
 *
 * **绝不能把没配好的通道发出去** —— 服务端会 503。
 *
 * ## 沙箱徽章(2026-11-13)
 *
 * 沙箱模式下付的钱**不会真的扣**,订单也不会真的发货 —— 但**界面上必须一眼
 * 看得出来**。反了就是:工作室在沙箱里测着测着忘了关开关,真客户付的钱进了
 * 沙箱(钱收不到),而客户这边看着一切正常。
 *
 * 两处提示:
 *
 * - **每个沙箱通道一枚琥珀色徽章**(在按钮上,跟着通道走)
 * - **列表上方一条提示条**(只要有**任何一个**通道在沙箱就摆)
 *
 * 提示条的颜色跟「暂未开放」那个灰的明显区分 —— 那个是「还没准备好」,
 * 这个是「**在收真钱的那条路上**,现在跑的是假的」。
 */

"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/** 一个通道在界面上的信息 —— 跟服务端返回的形状一致 */
export interface PaymentChannelOption {
  channel: string;
  label: string;
  description: string;
  available: boolean;
  /**
   * 现在跑在**沙箱**还是**正式**
   *
   * 缺省当 `false` —— 服务端还没带这个字段的旧版本响应也能正常画。
   */
  sandbox?: boolean;
}

export function PaymentChannelPicker({
  value,
  onChange,
  disabled,
}: {
  /** 当前选中的通道 id */
  value: string | null;
  /** 选中变了就调 */
  onChange: (channel: string) => void;
  disabled?: boolean;
}) {
  const [channels, setChannels] = useState<PaymentChannelOption[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * 通道的名字走 i18n
   *
   * 服务端返回的 `label` / `description` 是中文兜底(通道清单是后端给的,
   * 前端不该自己造名字)。有对应翻译就翻,没有就用服务端那份 —— 新加通道
   * 忘了配文案时,界面上还是能看见这个通道。
   */
  const t = useTranslations("Payment.channels");
  const tRoot = useTranslations("Payment");

  // `value` / `onChange` 每次渲染都是新引用 —— 放进 ref,
  // effect 就只依赖「挂载时跑一次」,不会来回拉清单。
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/store/payment-channels", {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        const body = res.ok ? await res.json() : null;
        if (cancelled) return;

        const list: unknown = body?.channels;
        // **全部**都留着 —— 没配好的(`available: false`)也要显示出来,
        // 只是灰着、选不了。工作室要让人看见支持哪几种付款方式。
        const all = (Array.isArray(list) ? list : [])
          .filter(
            (c): c is PaymentChannelOption =>
              typeof c === "object" &&
              c !== null &&
              typeof (c as PaymentChannelOption).channel === "string" &&
              typeof (c as PaymentChannelOption).available === "boolean"
          )
          // `sandbox` 是后加的字段 —— 缺的老响应按「正式」处理
          .map((c) => ({ ...c, sandbox: c.sandbox === true }));

        setChannels(all);

        // 默认选中第一个**配好了**的 —— 没配好的发出去服务端只会 503
        const usable = all.filter((c) => c.available);
        const first = usable[0];
        if (
          first !== undefined &&
          !usable.some((c) => c.channel === valueRef.current)
        ) {
          onChangeRef.current(first.channel);
        }
      } catch {
        // 拉不到就藏起选择器 —— 结算页还有兜底路径
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return null;
  if (channels.length === 0) return null;

  // 一个都配不好 —— 明说,别让用户对着一个全灰的列表猜
  const noneAvailable = channels.every((channel) => !channel.available);
  // **只要有一个**通道在沙箱就摆提示条 —— 两个通道是分开拨的,
  // 工作室可能微信在沙箱、支付宝在正式(或者反过来)
  const anySandbox = channels.some((channel) => channel.sandbox);

  return (
    <fieldset className="mt-6">
      <legend className="eyebrow text-muted-foreground mb-3">
        {tRoot("title")}
      </legend>
      {anySandbox && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <span>{tRoot("sandboxNotice")}</span>
        </div>
      )}
      <ul className="space-y-2">
        {channels.map((channel) => {
          const selected = channel.channel === value;
          // 没配好的通道**显示但选不了** —— 点了服务端只会 503
          const usable = channel.available;
          // 有翻译就用翻译,没有就退回服务端给的中文文案(新通道忘了配文案时
          // 界面上仍然看得见这个通道,不会只剩一个空的 radio)
          const labelKey = `${channel.channel}.label`;
          const descriptionKey = `${channel.channel}.description`;
          const label = t.has(labelKey) ? t(labelKey) : channel.label;
          const description = t.has(descriptionKey)
            ? t(descriptionKey)
            : channel.description;
          return (
            <li key={channel.channel}>
              <label
                className={`flex gap-3 p-4 border rounded-sm transition-colors ${
                  selected ? "border-primary bg-secondary/40" : "border-border"
                } ${
                  usable && !disabled
                    ? "cursor-pointer hover:bg-secondary/30"
                    : "opacity-50 cursor-not-allowed"
                }`}
              >
                <input
                  type="radio"
                  name="payment-channel"
                  value={channel.channel}
                  checked={selected}
                  disabled={disabled || !usable}
                  onChange={() => onChange(channel.channel)}
                  className="mt-1 accent-[var(--primary)]"
                />
                <span className="flex-1 min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{label}</span>
                    {/* 沙箱徽章摆在「暂未开放」**前面** —— 沙箱是更该先看到的 */}
                    {channel.sandbox && (
                      <span className="rounded-sm border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        {tRoot("sandboxBadge")}
                      </span>
                    )}
                    {!usable && (
                      <span className="rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {tRoot("unavailable")}
                      </span>
                    )}
                  </span>
                  <span className="block mt-0.5 text-xs text-muted-foreground">
                    {description}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {noneAvailable && (
        <p className="mt-3 text-xs text-muted-foreground">
          {tRoot("noneAvailable")}
        </p>
      )}
    </fieldset>
  );
}
