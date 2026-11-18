/**
 * 「新开页面」—— 跳外部通道(淘宝)用
 *
 * ## 为什么要这么绕
 *
 * 工作室的原话:**「进入淘宝是新开页面」**。
 *
 * 直觉写法是 `window.open(url, "_blank")` —— 但那样**跳不过去**:
 *
 * - 浏览器**拦截**这种「延迟打开」的弹窗(不是用户手势触发的)⇒ 弹窗被挡,
 *   用户点了没反应;
 * - 而且 `window.open(url)` 会把**淘宝**那个地址交给浏览器去加载 —— 万一
 *   淘宝那边要重定向、或者弹窗被拦,本站这一页就**卡在一个空白的弹窗**上,
 *   用户看到的是「点了按钮,什么都没发生」。
 *
 * ⇒ **两段式**:
 *
 * 1. **点击那一刻**同步开一个**空白标签页**(`window.open("", "_blank")`)——
 *    这一步在用户手势里,弹窗拦不住;
 * 2. **拿到付款地址之后**再把那个标签页导航过去。
 *
 * 失败(结算失败 / 通道没配好 / 订单被挡住)⇒ **把那个空白标签页关掉** ——
 * 留一个空白的标签页在用户屏幕上,比什么都不留更招人烦。
 *
 * ## 兜底:弹窗真被拦了 ⇒ 本页跳
 *
 * `window.open` 返回 null 就是被拦了 ⇒ 那就退回**整页跳转**(老行为)。
 * 用户宁可离开本页,也不能「点了没反应」。
 *
 * ## 只在**事件处理函数**里调用
 *
 * 这个模块碰 `window` —— 只在点击事件里用,**不在渲染里用**(渲染里分支会
 * 造成 hydration mismatch,见 MEMORY 那条「不许用 `typeof window` 分支」)。
 */

/**
 * 一个「待命」的外部标签页
 *
 * null = 没开出来(被拦了 / 没开)⇒ 调用方走**整页跳转**那条兜底。
 */
export type ExternalTab = Window | null;

/**
 * 开一个**空白**标签页
 *
 * ⚠️ **必须在用户手势里同步调用** —— 这就是它跟 `window.open(url)` 的
 * 全部区别。放在 `await` 之后就不算数了,浏览器会拦。
 *
 * @returns 标签页;被拦了(或不在浏览器里)返回 null
 */
export function openBlankTab(): ExternalTab {
  try {
    // SSR / 非浏览器环境 —— 引用 `window` 直接抛,被下面的 catch 接住
    return window.open("", "_blank");
  } catch {
    return null;
  }
}

/**
 * 把那个标签页导航到目标地址
 *
 * 标签页没了(用户自己关了 / 被浏览器回收)⇒ 退回**整页跳转**。
 */
export function navigateExternalTab(tab: ExternalTab, url: string): void {
  if (tab && !isClosed(tab)) {
    try {
      tab.location.href = url;
      return;
    } catch {
      // 落到下面 —— 整页跳转
    }
  }
  // 兜底:本页跳过去(老行为)
  window.location.href = url;
}

/**
 * 关掉那个空白标签页
 *
 * **失败路径上一定要调** —— 结算失败、通道没配好、订单被挡住……
 * 留一个空白标签页在用户屏幕上,比什么都不留更招人烦。
 */
export function closeExternalTab(tab: ExternalTab): void {
  if (!tab) return;
  try {
    if (!isClosed(tab)) tab.close();
  } catch {
    // 关不掉就算了 —— 顶多留一个空白页
  }
}

/**
 * 这个标签页关掉了吗
 *
 * 跨域的窗口读 `closed` 是允许的(这是个受限属性,浏览器专门留着)。
 */
function isClosed(tab: Window): boolean {
  try {
    return tab.closed;
  } catch {
    return true;
  }
}

/**
 * 这个通道是不是**淘宝**那一路
 *
 * 只有淘宝要「新开页面」—— 别的通道(支付宝)是整页跳转(跳转之后买家就
 * 付完了,本站这一页留着也没用;而且支付宝那边**必须**整页跳,扫码式的
 * 页面在弹窗里会被它的安全策略挡掉)。
 *
 * 淘宝不一样:钱在淘宝那边付,付完买家还要**回到本站**看订单 ⇒ 本站这一页
 * 必须留着。
 */
export function isTaobaoChannel(channel: string | null | undefined): boolean {
  return channel === "taobao";
}
