/**
 * 认证页面 Logo 组件
 *
 * 用于登录、注册等认证页面的品牌标识展示
 * 图标 + 文字组合
 */

export function AuthLogo() {
  return (
    <div className="flex items-center gap-2">
      <img src="/logo.svg" alt="Mooncoda" className="h-7 w-7 shrink-0" />
      <span className="text-xl font-bold tracking-tight">
        Moon<span className="text-muted-foreground">coda</span>
      </span>
    </div>
  );
}
