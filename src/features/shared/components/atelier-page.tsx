"use client";

/**
 * atelier 页面骨架 —— 电商首页那一套版式
 *
 * 样式抄的是 `/cart`(购物袋详情页):页面留白、衬线大标题、分隔线列表、
 * 空状态。买家的三样东西(商城订单 / 打印订单 / 收货地址)从控制台搬到
 * 电商首页头像下拉之后,长相要跟商城一致 —— 规则写在这一个文件里,
 * 四个页面共用,别再各写一遍。
 *
 * ## 为什么是「共享」而不是每个页面各写
 *
 * 之前这三页长的是控制台的样子(`rounded-xl` + `shadow-sm` 的卡片、方角
 * 输入框、居中的空盒子)。用户看到的却是从**电商首页头像**点进来的 ——
 * 点之前是 atelier,点之后是控制台,风格断成两截。这里把版式抽出来,
 * 三页统一走它。
 *
 * 只有版式,没有业务:金额、状态、口径都还在各自的服务端 / 组件里。
 */

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 页面留白 —— 宽度跟 `/cart`、`/checkout` 一致
 *
 * `py-10` 是有内容的时候;空状态用 `py-20`(见 `AtelierEmptyState`),
 * 跟购物袋空的时候一模一样。
 */
export function AtelierPageShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("atelier-container py-10", className)}>{children}</div>
  );
}

/**
 * 页面标题 —— 衬线大标题 + 一句说明,右边可以摆一个动作
 *
 * 标题用 `font-serif text-3xl`:atelier 子树里 h1-h4 走 Playfair →
 * Noto Serif SC(见 `(marketing-atelier)/layout.tsx` 的 `<style>` 块)。
 */
export function AtelierPageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  /** 右上角的动作(按钮 / 链接) */
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-8">
      <div>
        <h1 className="font-serif text-3xl">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/**
 * 空状态 —— icon 圆牌 + 衬线标题 + 一句说明 + 圆形 CTA
 *
 * 版式抄 `/cart` 空购物袋那一屏:整页留白、圆牌图标、居中。
 *
 * `action` 由调用方给 —— 多数是「去商城逛逛」这种链接,但地址簿那边是
 * 「新建地址」按钮(点了要展开表单),所以这里收节点而不是收 href。
 */
export function AtelierEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** 底部动作(按钮 / 链接) */
  action?: React.ReactNode;
}) {
  return (
    <div className="atelier-container py-20 text-center">
      <div className="size-16 rounded-full bg-secondary flex items-center justify-center mx-auto mb-5">
        <Icon className="size-7 text-muted-foreground" />
      </div>
      <h1 className="font-serif text-3xl mb-3">{title}</h1>
      <p className="text-sm text-muted-foreground mb-8 max-w-xs mx-auto text-pretty">
        {description}
      </p>
      {action}
    </div>
  );
}

/**
 * 分区标题 —— 小号大写字母间距那套
 *
 * atelier 的 `.eyebrow`(定义在 `(marketing-atelier)/layout.tsx`):
 * 11px / 0.22em 字距 / 大写。商城那边用它标「金额」这类分区名。
 */
export function AtelierSectionTitle({
  children,
  icon: Icon,
}: {
  children: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <h2 className="eyebrow text-muted-foreground mb-4 flex items-center gap-2">
      {Icon ? <Icon className="size-3.5" /> : null}
      {children}
    </h2>
  );
}

/**
 * 面板 —— 详情页那种「一块一块的信息」
 *
 * `border + rounded-sm + bg-card`,**不带阴影** —— 商城那边靠留白和细线
 * 分层,不靠投影。
 */
export function AtelierPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("border border-border rounded-sm p-6 bg-card", className)}
    >
      {children}
    </section>
  );
}
