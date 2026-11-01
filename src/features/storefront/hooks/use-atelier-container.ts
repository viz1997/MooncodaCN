/**
 * useAtelierContainer —— 取 `.atelier-root` 作为 Dialog / Sheet 的 portal 挂载点
 *
 * ## 为什么需要它
 *
 * `(marketing-atelier)/layout.tsx` 把 atelier 的**颜色** token(`--primary` /
 * `--accent` / `--card` / `--radius` …)重定义在一个包裹 div 上:
 *
 *   <div className="atelier-root …">  ← token 只在这棵子树里生效
 *
 * 而 Radix 的 Dialog / Sheet 默认 portal 到 `document.body`,渲染结果落在
 * `.atelier-root` **外面**。结果是:页面本身是 atelier 配色,弹出的购物袋 /
 * 快速预览 / 定制工作台却是全站默认主题(Spruce + Geist + 1.25rem 圆角)——
 * 颜色和圆角对不上,像另一个产品的弹窗。
 *
 * 把 portal 指回 `.atelier-root` 即可。祖先链上没有 transform / filter /
 * will-change / contain,所以 `position: fixed` 的定位不受影响。
 *
 * 注意 `font-family` 变量本来就在 `<body>` 上(根 layout 注入),所以**字体**
 * 一直是 atelier 的,出问题的只有颜色和圆角。
 *
 * ## 为什么是 hook 而不是直接 querySelector
 *
 * SSR 阶段拿不到 DOM。首帧返回 null → portal 落回 body(hydrate 前本来也看不到
 * 弹窗),effect 跑完再切到 `.atelier-root`。弹窗都是用户点击才打开的,
 * 那时 effect 早执行完了,不会看到切换闪烁。
 *
 * 不在 atelier 路由组的页面(如 /dashboard)永远拿不到这个元素 —— 调用方就是
 * atelier 的 overlay,不存在这种用法,但即便如此 hook 也只是返回 null,退回
 * 默认的 body portal,不会崩。
 */

"use client";

import * as React from "react";

export function useAtelierContainer(): HTMLElement | null {
  const [container, setContainer] = React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    setContainer(document.querySelector<HTMLElement>(".atelier-root"));
  }, []);

  return container;
}
