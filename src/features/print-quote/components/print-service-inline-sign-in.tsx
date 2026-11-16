"use client";

/**
 * 报价弹窗里的**就地登录**(2026-11-16)
 *
 * ## 为什么是「就地」
 *
 * 工作室 2026-11-16 的要求:
 *
 * > 「用户不登陆也可以使用工具检测模型、克重等等,但是用户点击报价下单需要
 * > 引导用户登录」
 *
 * 访客可以随便量 —— 检查、克重、预估报价都不需要登录。**只有下单那一步**
 * 需要账号(工单挂在账号名下,模型文件也落到用户自己的 R2 分区)。
 *
 * 以前这一格摆的是「去登录」链接,点过去是**整页跳转** ⇒ 用户量了半天的
 * 模型、尺寸、姿态全没了 ⇒ 于是以前的文案只能写「先登录再量」。那是
 * **被整页跳转逼出来的妥协**,不是业务要求。
 *
 * ## 现在怎么把模型保住
 *
 * 就地登录调的是 `signIn.email({ email, password })` —— **不传
 * `callbackURL`**:
 *
 * - 传了 ⇒ Better Auth 的客户端插件会 `window.location.href = url`
 *   ⇒ **整页跳转** ⇒ 模型没了
 * - 不传 ⇒ 服务端**照样**种会话 cookie,但不跳转;我们接着
 *   `router.refresh()` ⇒ 页面的 RSC 重跑一遍 ⇒ 新的登录态 / 地址簿 /
 *   称呼流下来 ⇒ 弹窗自动换成下单表单,**模型还在内存里**
 *
 * 详见 `lib/auth/client.ts` 的 `signInWithEmailInPlace`。
 *
 * ## 这一层只管「把 cookie 种下」
 *
 * 不自己判登录态、不自己拉地址簿 —— 那些是**服务端**的事(工单要挂在账号
 * 名下,地址归属校验在数据层)。这一层登录完只做两件事:让 RSC 重跑 +
 * 告诉父组件一声。
 *
 * ## 手机号 + 验证码 / 忘了密码
 *
 * 那两条路**只能走完整登录页**(要收验证码邮件 / 要重置密码)。所以旁边还
 * 留着一个「去登录」链接 —— 弹窗里写清楚**那一跳会离开这一页**。
 */

import { Loader2, LogIn } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/routing";
import { signInWithEmailInPlace } from "@/lib/auth/client";

export type PrintServiceInlineSignInProps = {
  /**
   * 登录成功了 —— 父组件可以收一收(关掉那个「去登录」链接那一块)
   *
   * 不用它也能工作:登录态是靠 `router.refresh()` 换回来的。
   */
  onSignedIn?: () => void;
};

export function PrintServiceInlineSignIn({
  onSignedIn,
}: PrintServiceInlineSignInProps) {
  const t = useTranslations("PrintQuote.entry.signIn");
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<"idle" | "signing-in">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || !password) {
      setError(t("errors.missingFields"));
      return;
    }

    setPhase("signing-in");
    setError(null);

    try {
      const result = await signInWithEmailInPlace(email.trim(), password);

      if (result.error) {
        setError(mapSignInError(result.error.code, t));
        setPhase("idle");
        return;
      }

      /**
       * 会话 cookie 已经种下 —— 让页面那层的 RSC 重跑一遍
       *
       * 新的 `isLoggedIn` / `addresses` / `user` 下来之后,弹窗里那个
       * 「没登录」的分支就被下单表单换掉了。**客户端状态不动** ⇒ 模型
       * 还在内存里。
       */
      router.refresh();
      onSignedIn?.();
      setPhase("idle");
    } catch {
      setError(t("errors.invalidCredentials"));
      setPhase("idle");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-sm font-medium">{t("title")}</p>

      {error ? (
        <p className="text-[11px] leading-relaxed text-destructive">{error}</p>
      ) : null}

      <div className="space-y-2">
        <label htmlFor="quote-sign-in-email" className="sr-only">
          {t("emailLabel")}
        </label>
        <Input
          id="quote-sign-in-email"
          type="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={phase === "signing-in"}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="quote-sign-in-password" className="sr-only">
          {t("passwordLabel")}
        </label>
        <Input
          id="quote-sign-in-password"
          type="password"
          autoComplete="current-password"
          placeholder={t("passwordPlaceholder")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={phase === "signing-in"}
        />
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={phase === "signing-in"}
      >
        {phase === "signing-in" ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {t("submitting")}
          </>
        ) : (
          <>
            <LogIn className="size-4" />
            {t("submit")}
          </>
        )}
      </Button>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("hint")}
      </p>
    </form>
  );
}

/**
 * 错误码 → 一句人话
 *
 * 认不出来的 code 退回笼统那句 —— **原始报错留在 console 里**,不摆给用户
 * (Better Auth 的报错可能带着内部信息)。
 */
function mapSignInError(
  code: string | undefined | null,
  t: (key: string) => string
): string {
  switch (code) {
    case "EMAIL_NOT_VERIFIED":
      return t("errors.emailNotVerified");
    case "USER_NOT_FOUND":
    case "INVALID_EMAIL_OR_PASSWORD":
    case "CREDENTIAL_ACCOUNT_NOT_FOUND":
      return t("errors.invalidCredentials");
    default:
      return t("errors.invalidCredentials");
  }
}
