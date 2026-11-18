/**
 * 淘宝通道 —— 跳到淘宝拍下这一单
 *
 * ## 这一条路跟别的通道**根本不同**
 *
 * | | 微信 / 支付宝 | 淘宝 |
 * |---|---|---|
 * | 钱进哪儿 | 本仓库的商户号 / 账户 | **淘宝那个账户** |
 * | 谁确认收款 | 平台推过来的通知(webhook) | **工作室在淘宝后台看,再手工标** |
 * | 本仓库的金额 | 就是收的金额(「逐分相等」) | **只是参考价** —— 淘宝那边的价、运费模板、优惠券都是它自己那套 |
 * | 订单号 | 平台给的(`provider_order_id`) | 工作室从淘宝后台**抄**进来 |
 *
 * ⇒ 所以这个 provider **不调任何接口** —— `createSession()` 只是把「这件设计
 * 对应的淘宝链接」找出来,给浏览器一个跳转地址。
 *
 * ## 跳过去的是**下单确认页**,不是商品详情页(2026-11-18)
 *
 * 工作室报的是「用户跳到淘宝后没有自动创建订单」。本站**确实**建了单
 * (`checkout.ts` 里 `storefront_order` 落库**早于**建支付会话)—— 缺的是
 * **淘宝那边的那一单**。
 *
 * 以前跳过去是**商品详情页**(`item.taobao.com/item.htm?id=…`),买家到了淘宝
 * 还得自己:挑规格 → 点「立即购买」→ 填地址 ⇒ 看起来就是「没自动创建订单」。
 *
 * ⇒ 现在拼淘宝的**下单确认页**(`buyParam` 带商品 + 数量 + 规格),买家一落地
 * 就在「确认订单」那一步,商品、件数、规格都替他选好了。纯函数在
 * `features/taobao/lib/taobao-order-link.ts`。
 *
 * ⚠️ **拼不出来就退回商品页**(老行为永远留着):淘宝那个下单页是**内部 H5
 * 接口**,没公开文档 —— 形状变了、某个商品不支持、后台把那颗开关关了 ⇒ 一律
 * 退回普通商品页。退回的原因记在服务端日志里。
 *
 * ## 「配好了」是什么意思
 *
 * `isConfigured()` = **后台至少配了一条淘宝链接**(`/admin/taobao-links`)。
 * 没配之前这个选项是灰的、标着「暂未开放」。
 *
 * ⚠️ **不是「每一件设计都配了」** —— 某一件没配 ⇒ 结算时单独拦下(那句话要
 * 说清楚是哪一件),而不是把整个通道灰掉。
 *
 * ## 退款
 *
 * **不实现 `refund`** —— 退钱在淘宝那边退(工作室在淘宝后台操作),退完回本站
 * 点「标记已退款」。退款那条路对没有 `refund` 的 provider 已经有话说
 * (「这个通道没有实现退款接口 —— 请在商家后台手工退款」)。
 *
 * ## 环境变量
 *
 * **一个都没有** —— 这个通道不碰任何密钥。链接配在后台的
 * `product_taobao_link` 表里。
 */

import {
  PaymentNotConfiguredError,
  type PaymentProvider,
  PaymentProviderError,
  type PaymentRequest,
  type PaymentSession,
} from "@/features/payments/lib/types";
import { pickTaobaoTarget } from "@/features/taobao/lib/taobao-link";
import {
  countActiveTaobaoLinks,
  getActiveTaobaoLink,
} from "@/features/taobao/lib/taobao-link-store";
import { buildTaobaoCheckoutUrl } from "@/features/taobao/lib/taobao-order-link";

/**
 * 淘宝通道
 *
 * `isConfigured()` 决定界面显不显示这个选项 —— 让用户点一个注定失败的按钮,
 * 比不给他这个选项更糟。
 */
export const taobaoPayProvider: PaymentProvider = {
  channel: "taobao",

  /**
   * 「配好了没」= 后台**至少配了一条**淘宝链接
   *
   * ⚠️ **读失败当「没配好」** —— 这一条不在收钱的链路上(钱在淘宝那边收),
   * 读不到就别让它把整个清单接口带崩。
   */
  async isConfigured(): Promise<boolean> {
    try {
      return (await countActiveTaobaoLinks()) > 0;
    } catch (error) {
      console.error("[payments] 读淘宝链接配置失败(当成没配好)", error);
      return false;
    }
  },

  /**
   * 找一个跳转地址 —— **没有任何网络请求**
   *
   * 跳转目标是「这一单里那件设计」对应的淘宝链接。判据在
   * `taobao-link.ts` 的 `pickTaobaoTarget()`:
   *
   * - 车里**一件设计** ⇒ 跳它的链接
   * - 车里**多件设计** ⇒ 没法跳(淘宝那边一个链接只对应一件货)⇒ 报错
   *
   * `request.items[].sku` 装的是**设计 handle** —— 结算那条路
   * (`checkout.ts` 的 `buildPaymentRequest`)跟「重新获取付款入口」那条路
   * (`payment-request.ts` 的 `buildStorefrontPaymentRequest`)都塞的是
   * handle,两边一致。
   */
  async createSession(request: PaymentRequest): Promise<PaymentSession> {
    const handles = request.items
      .map((item) => item.sku)
      .filter((sku): sku is string => Boolean(sku));

    const target = pickTaobaoTarget(handles);
    if (!target.ok) {
      throw new PaymentProviderError(
        "taobao",
        target.problem === "MULTIPLE_DESIGNS"
          ? "这一单里有好几件不同的设计,淘宝下单一次只能对应一件 —— 请分开下单"
          : "这一单里没有货,没法跳淘宝"
      );
    }

    const link = await getActiveTaobaoLink(target.handle);
    if (!link) {
      // 「没配链接」是**配置问题** —— 重试没用,得去后台配
      throw new PaymentNotConfiguredError(
        "taobao",
        "这件商品还没配淘宝链接(后台「淘宝链接」那一页)"
      );
    }

    // 直接下单(2026-11-18)—— 跳淘宝的**下单确认页**,不是商品详情页
    //
    // 工作室报的是「用户跳到淘宝后没有自动创建订单」—— 本站**确实**建了单,
    // 缺的是**淘宝那边的那一单**。以前跳的是商品详情页,买家到了还得自己
    // 挑规格 → 点「立即购买」⇒ 看起来就是「没自动创建订单」。
    //
    // 拼不出直连地址时**永远退回商品页**(老行为)—— 淘宝那个下单页是内部
    // H5 接口,没公开文档,不许把这条路走死。
    const quantity = request.items.reduce(
      (sum, item) => sum + (item.quantity ?? 0),
      0
    );
    const sizeIds = request.items.map((item) => item.sizeId ?? null);

    const checkout = buildTaobaoCheckoutUrl({
      url: link.url,
      itemId: link.itemId,
      skuMap: link.skuMap,
      directOrder: link.directOrder,
      quantity,
      sizeIds,
    });

    if (checkout.fallback) {
      // 服务端记一条 —— 界面不摆(买家不需要知道),但工作室要能查到
      // 「为什么这一单没有直接下单」
      console.warn(
        `[payments] taobao ${request.orderNo}:退回普通商品页(${checkout.fallback})`
      );
    }

    return {
      channel: "taobao",
      // 淘宝那边的订单号是工作室从商家后台**抄**进来的 —— 这里没有
      providerOrderId: null,
      redirectUrl: checkout.url,
      qrCodeUrl: null,
      expiresAt: null,
    };
  },
};

export default taobaoPayProvider;
