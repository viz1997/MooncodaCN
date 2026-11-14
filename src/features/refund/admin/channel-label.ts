/**
 * 收款通道的显示名 —— **一份实现,两个渲染处共用**
 *
 * 列表里要摆一列「收款通道」(工作室一眼看出这一单走哪条路),展开面板里也要
 * 摆一行 —— 写两遍的话,加一个通道就有一处会漏。
 *
 * ## 认不出来怎么办
 *
 * **原样摆出来,不猜。** 通道是**平台/支付方式**的标识(微信 / 支付宝 / 线下
 * 转账 / 已下线的 Shopify / 旧路 Stripe),不是订单状态 —— 猜错了会让工作室
 * 拿错通道去退钱。
 *
 * @param t 翻译函数(antd / next-intl 的都行,只要能接受一个键)
 * @param channel DB 里存的那个通道标识
 */
export function refundChannelLabel(
  t: (key: string) => string,
  channel: string | null | undefined
): string {
  const key = channel ?? "unknown";
  const known = ["wechat", "alipay", "offline", "shopify", "stripe"];
  return known.includes(key)
    ? t(`channel.${key}`)
    : (channel ?? t("channel.unknown"));
}
