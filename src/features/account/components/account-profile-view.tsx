"use client";

/**
 * AccountProfileView —— 「账户信息」页
 *
 * 电商首页头像下拉里那块「头像 + 姓名 + 邮箱」现在是**可点的菜单项**了 ——
 * 点进来就是这一页(2026-11-06)。所以这一页得真的能改东西,不然那一下点击
 * 是个死胡同。
 *
 * ## 这一页管什么
 *
 * - **姓名 / 头像** —— 能改(改完头部下拉里立刻跟着变)
 * - **邮箱 / 手机号 / 注册时间** —— 只读。邮箱是账号的主键(登录、找回、
 *   收款渠道都按 email 对人),换邮箱得走人工;手机号要 OTP 验证,那一套在
 *   `/dashboard/settings` 的「安全」里,不在这里重写一遍。
 *
 * ## 改完怎么让头部跟着变
 *
 * 头部那块读的是 `useSession()`(nanostore 里那份会话),不是本页传进来的
 * props —— 所以改完资料光 `router.refresh()` 没用,头部还拿着旧名字。
 * 必须 `refetch()` 一下会话(会话 atom 是**模块级单例**,页面里 refetch
 * 一次,所有 `useSession()` 的订阅者都会重新渲染)。
 *
 * ## 版式
 *
 * 跟 `/account/orders`、`/account/addresses` 一样走 atelier 那套共享骨架
 * (`features/shared/components/atelier-page.tsx`)—— 别再各写一遍。
 */

import { Camera, Check, Loader2, ShieldAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import * as React from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateProfileAction } from "@/features/settings/actions";
import {
  AtelierPageHeader,
  AtelierPageShell,
  AtelierPanel,
  AtelierSectionTitle,
} from "@/features/shared/components/atelier-page";
// 刻意**不**从 "@/features/storage" 那个桶文件导入 —— 桶文件 re-export 了
// providers/s3.ts,那里面是 AWS SDK,会被打进客户端 bundle。这三个文件都是
// 零依赖的纯模块。
import { getSignedUploadUrlAction } from "@/features/storage/actions";
import { ALLOWED_IMAGE_TYPES, MAX_FILE_SIZE } from "@/features/storage/types";
import { generateAvatarKey, getAvatarUrl } from "@/features/storage/utils";
import { Link, useRouter } from "@/i18n/routing";
import { useSession } from "@/lib/auth/client";

/** 页面要用的账号资料 —— 由服务端查好传进来 */
export interface AccountProfileUser {
  id: string;
  name: string;
  email: string;
  /** 头像 —— 可能是外链(OAuth),也可能是存储键名(自己上传的) */
  image: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
  /** 注册时间(ISO) */
  createdAt: string;
}

/** 头像里的缩写 —— 没有名字就退到邮箱首字母 */
function getInitials(name?: string | null, email?: string | null): string {
  const raw = (name ?? "").trim();
  if (raw) {
    return raw
      .split(/\s+/)
      .map((n) => n[0] ?? "")
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  const mail = (email ?? "").trim();
  return mail ? (mail[0] ?? "").toUpperCase() : "·";
}

export function AccountProfileView({ user }: { user: AccountProfileUser }) {
  const t = useTranslations("Account");
  const locale = useLocale();
  const router = useRouter();
  const { refetch } = useSession();

  const [name, setName] = React.useState(user.name);
  const [avatarPreview, setAvatarPreview] = React.useState<string | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [hint, setHint] = React.useState<{
    tone: "ok" | "err";
    text: string;
  } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  /**
   * 改完资料 —— 头部那块的会话也要刷新
   *
   * `refetch()` 会重取会话并写回**共享的会话 atom**,头部下拉(同一个
   * `useSession()`)跟着重渲染,名字立刻变。少了这一步,用户改完名字抬头
   * 看还是旧的那个,像是没存上。
   */
  const { execute: executeUpdateProfile, isPending } = useAction(
    updateProfileAction,
    {
      onSuccess: () => {
        setHint({ tone: "ok", text: t("saved") });
        void refetch?.();
        router.refresh();
      },
      onError: ({ error }) => {
        setHint({
          tone: "err",
          text: error.serverError ?? t("saveFailed"),
        });
      },
    }
  );

  const handleSaveName = () => {
    const trimmed = name.trim();
    // 长度在客户端先拦一道 —— 服务端的 zod 报错是中文的,英文站显示中文
    // 报错很奇怪
    if (trimmed.length < 2) {
      setHint({ tone: "err", text: t("nameTooShort") });
      return;
    }
    if (trimmed.length > 50) {
      setHint({ tone: "err", text: t("nameTooLong") });
      return;
    }
    executeUpdateProfile({ name: trimmed });
  };

  const handleAvatarChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type as never)) {
      setHint({ tone: "err", text: t("avatarTypeFailed") });
      event.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setHint({
        tone: "err",
        text: t("avatarTooLarge", { size: MAX_FILE_SIZE / 1024 / 1024 }),
      });
      event.target.value = "";
      return;
    }

    setIsUploading(true);
    try {
      // 键名带上 userId —— 服务端据此校验文件归属(见 storage/validation.ts)
      const key = generateAvatarKey(user.id, file);
      const upload = await getSignedUploadUrlAction({
        key,
        contentType: file.type as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp",
      });
      const uploadUrl = upload?.data?.uploadUrl;
      if (!uploadUrl) {
        throw new Error("no upload url");
      }

      const res = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!res.ok) {
        throw new Error("upload failed");
      }

      executeUpdateProfile({ image: key });
      // 先把新头像摆上去,不等服务端回来
      setAvatarPreview(getAvatarUrl(key) ?? null);
    } catch {
      setHint({ tone: "err", text: t("avatarFailed") });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const avatarSrc = avatarPreview ?? getAvatarUrl(user.image) ?? undefined;
  const memberSince = new Date(user.createdAt).toLocaleDateString(
    locale === "zh" ? "zh-CN" : "en-US"
  );

  return (
    <AtelierPageShell>
      <AtelierPageHeader title={t("title")} description={t("description")} />

      <div className="max-w-2xl">
        <AtelierSectionTitle>{t("section")}</AtelierSectionTitle>
        <AtelierPanel>
          {/* 头像 + 姓名 / 邮箱 */}
          <div className="flex items-center gap-5">
            <div className="relative shrink-0">
              <Avatar className="size-16">
                <AvatarImage src={avatarSrc} alt={user.name || user.email} />
                <AvatarFallback className="bg-primary text-sm text-primary-foreground">
                  {getInitials(user.name, user.email)}
                </AvatarFallback>
              </Avatar>
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_IMAGE_TYPES.join(",")}
                className="hidden"
                onChange={handleAvatarChange}
                disabled={isUploading}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                aria-label={t("avatarChange")}
                title={t("avatarChange")}
                className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
              >
                {isUploading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Camera className="size-3.5" />
                )}
              </button>
            </div>

            <div className="min-w-0">
              <p className="font-serif text-lg leading-tight">
                {user.name || user.email}
              </p>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {user.email}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {isUploading
                  ? t("avatarUploading")
                  : t("avatarHint", {
                      size: MAX_FILE_SIZE / 1024 / 1024,
                    })}
              </p>
            </div>
          </div>

          {/* 分隔线 */}
          <div className="my-6 border-t border-border" />

          {/* 姓名 */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label
                htmlFor="account-name"
                className="mb-1.5 block text-[11px] uppercase tracking-[0.2em] text-muted-foreground"
              >
                {t("name")}
              </label>
              <Input
                id="account-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("namePlaceholder")}
                maxLength={50}
                disabled={isPending}
                className="h-9 rounded-sm bg-background"
              />
            </div>
            <Button
              type="button"
              onClick={handleSaveName}
              disabled={isPending || name.trim() === user.name}
              className="rounded-full"
            >
              {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {isPending ? t("saving") : t("save")}
            </Button>
          </div>

          {/* 只读的几行 */}
          <dl className="mt-6 space-y-3 text-sm">
            <ReadOnlyRow label={t("email")}>
              <span className="truncate">{user.email}</span>
              <VerifiedBadge
                ok={user.emailVerified}
                okText={t("emailVerified")}
                noText={t("emailUnverified")}
              />
              {/* 邮箱是账号的主键 —— 换不了,得走人工 */}
              <span className="text-[11px] text-muted-foreground">
                {t("emailHint")}
              </span>
            </ReadOnlyRow>
            <ReadOnlyRow label={t("phone")}>
              {user.phoneNumber ? (
                <>
                  <span>{user.phoneNumber}</span>
                  <VerifiedBadge
                    ok={user.phoneNumberVerified}
                    okText={t("phoneVerified")}
                    noText={t("phoneUnverified")}
                  />
                </>
              ) : (
                <span className="text-muted-foreground">
                  {t("phoneNotBound")}
                </span>
              )}
            </ReadOnlyRow>
            <ReadOnlyRow label={t("memberSince")}>
              <span>{memberSince}</span>
            </ReadOnlyRow>
          </dl>

          {hint ? (
            <p
              className={`mt-4 text-xs ${
                hint.tone === "ok" ? "text-primary" : "text-destructive"
              }`}
            >
              {hint.text}
            </p>
          ) : null}

          {/* 密码 / 手机号验证 —— 那一套在控制台的账户设置里,不在这儿重写 */}
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-sm font-medium">{t("moreSettings")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("moreSettingsHint")}
            </p>
            <Link
              href="/dashboard/settings"
              className="mt-2 inline-flex items-center gap-1.5 text-xs underline text-muted-foreground hover:text-foreground"
            >
              <ShieldAlert className="size-3.5" />
              {t("moreSettings")}
            </Link>
          </div>
        </AtelierPanel>
      </div>
    </AtelierPageShell>
  );
}

/** 只读的一行 —— 左边标签,右边值 */
function ReadOnlyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <dt className="w-20 shrink-0 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {children}
      </dd>
    </div>
  );
}

/** 「已验证 / 未验证」小徽标 */
function VerifiedBadge({
  ok,
  okText,
  noText,
}: {
  ok: boolean;
  okText: string;
  noText: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        ok
          ? "border-border text-primary"
          : "border-border text-muted-foreground"
      }`}
    >
      {ok ? <Check className="size-3" /> : null}
      {ok ? okText : noText}
    </span>
  );
}
