// @ts-nocheck
/**
 * 画布内简易埋点（占位 stub）
 *
 * 真实接入方式：把 `trackPageview(path)` 接到你已经在用的 umami / plausible /
 * PostHog / Google Analytics 之一；本期为了先把路由打通，留空函数，等接好
 * analytics SDK 再把这里填上。
 *
 * 为什么独立一份而不是接 src/lib/analytics：画布是 CSS-in-JS 孤岛，不应该把
 * 站点的 analytics SDK 副作用带进来。等站点统一接入后再考虑合并。
 */

export function trackPageview(_path: string): void {
  // noop
}
