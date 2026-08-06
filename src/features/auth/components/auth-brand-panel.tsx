import { AuthLogo } from "@/features/auth/components/auth-logo";

/**
 * Auth 页面品牌面板
 *
 * 用于登录/注册页左侧的深色品牌分屏。
 */
export function AuthBrandPanel() {
  return (
    <div className="relative hidden flex-col justify-between bg-slate-900 p-10 text-slate-100 lg:flex">
      <div className="z-10">
        <AuthLogo />
      </div>

      <div className="z-10 max-w-md space-y-4">
        <h2 className="text-3xl font-bold tracking-tight">
          启动你的下一个 SaaS 产品
        </h2>
        <p className="text-slate-400">
          内置认证、支付、积分、异步任务、国际化与管理后台，开箱即用。
        </p>
        <ul className="space-y-2 text-sm text-slate-400">
          <li className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            多提供商 OAuth 与邮箱密码登录
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            订阅与一次性支付（Creem）
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            双式记账积分与 FIFO 过期机制
          </li>
          <li className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            异步任务处理（Inngest）
          </li>
        </ul>
      </div>

      <div className="z-10 text-xs text-slate-500">
        © {new Date().getFullYear()} Mooncoda. 保留所有权利。
      </div>

      {/* 装饰背景 */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-slate-950" />
    </div>
  );
}
