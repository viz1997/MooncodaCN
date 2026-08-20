"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  App,
  Avatar,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Tabs,
} from "antd";
import { Camera } from "lucide-react";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useRef, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";

import { CreditUsageSection } from "@/features/credits/components";
import {
  deleteAccountAction,
  updateProfileAction,
} from "@/features/settings/actions";
import { updateProfileSchema } from "@/features/settings/schemas";
import {
  ALLOWED_IMAGE_TYPES,
  generateAvatarKey,
  getAvatarUrl,
  getSignedUploadUrlAction,
  MAX_FILE_SIZE,
} from "@/features/storage";
import { usePathname, useRouter } from "@/i18n/routing";
import { signOut } from "@/lib/auth/client";

import { BillingSection } from "./billing-section";
import { SecuritySection } from "./security-section";

interface SettingsProfileViewProps {
  user: {
    id: string;
    name: string;
    email: string;
    image?: string | null | undefined;
  };
}

type FormValues = z.infer<typeof updateProfileSchema>;

export function SettingsProfileView({ user }: SettingsProfileViewProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { message } = App.useApp();

  const t = useTranslations("Settings");
  const tTabs = useTranslations("Settings.tabs");

  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [isChangingLocale, startLocaleTransition] = useTransition();

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const handleLanguageChange = (newLocale: string) => {
    startLocaleTransition(() => {
      router.replace(
        // @ts-expect-error Current route params always match the current pathname.
        { pathname, params },
        { locale: newLocale }
      );
    });
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const currentAvatarUrl = avatarPreview ?? getAvatarUrl(user.image);

  const form = useForm<FormValues>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      name: user.name,
    },
  });

  const { execute: executeUpdateProfile, isPending } = useAction(
    updateProfileAction,
    {
      onSuccess: ({ data }) => {
        if (data?.message) {
          message.success(data.message);
        }
      },
      onError: ({ error }) => {
        if (error.serverError) {
          message.error(error.serverError);
        }
        if (error.validationErrors) {
          const errors = Object.values(error.validationErrors).flat();
          message.error(errors.join(", ") || t("errors.validationFailed"));
        }
      },
    }
  );

  const { execute: executeDeleteAccount, isPending: isDeletingAccount } =
    useAction(deleteAccountAction, {
      onSuccess: async ({ data }) => {
        setIsDeleteDialogOpen(false);

        if (data?.message) {
          message.success(data.message);
        }

        try {
          await signOut({
            fetchOptions: {
              onSuccess: () => {
                router.replace("/");
                router.refresh();
              },
            },
          });
        } catch {
          router.replace("/");
          router.refresh();
        }
      },
      onError: ({ error }) => {
        message.error(error.serverError || t("deleteAccount.error"));
      },
    });

  const onSubmit = (values: FormValues) => {
    executeUpdateProfile(values);
  };

  const handleAvatarClick = () => {
    if (!isUploadingAvatar) {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !ALLOWED_IMAGE_TYPES.includes(
        file.type as (typeof ALLOWED_IMAGE_TYPES)[number]
      )
    ) {
      message.error(
        t("errors.unsupportedFileType", {
          types: ALLOWED_IMAGE_TYPES.join(", "),
        })
      );
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      message.error(
        t("errors.fileTooLarge", { size: MAX_FILE_SIZE / 1024 / 1024 })
      );
      return;
    }

    setIsUploadingAvatar(true);

    try {
      const localPreviewUrl = URL.createObjectURL(file);
      setAvatarPreview(localPreviewUrl);

      const key = generateAvatarKey(user.id, file);

      const uploadUrlResult = await getSignedUploadUrlAction({
        key,
        contentType: file.type as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp",
      });

      if (!uploadUrlResult?.data?.uploadUrl) {
        throw new Error(t("errors.uploadFailed"));
      }

      const uploadResponse = await fetch(uploadUrlResult.data.uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(t("errors.fileUploadFailed"));
      }

      executeUpdateProfile({ image: uploadUrlResult.data.key });
      message.success(t("success.avatarUpdated"));
    } catch (error) {
      console.error("Avatar upload error:", error);
      message.error(
        error instanceof Error ? error.message : t("errors.avatarUploadError")
      );
      setAvatarPreview(null);
    } finally {
      setIsUploadingAvatar(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDeleteAccount = () => {
    executeDeleteAccount({ confirm: true as const });
  };

  // Account Tab 内容
  const accountTab = (
    <div className="mt-8 space-y-10 pl-4">
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">{t("general.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("general.description")}
            </p>
          </div>
          <Button
            type="primary"
            htmlType="submit"
            size="small"
            loading={isPending}
            onClick={form.handleSubmit(onSubmit)}
          >
            {t("general.save")}
          </Button>
        </div>

        <Form
          layout="vertical"
          onFinish={form.handleSubmit(onSubmit)}
          component={false}
        >
          <Controller
            control={form.control}
            name="name"
            render={({ field, fieldState }) => (
              <Form.Item
                label={t("general.name")}
                validateStatus={fieldState.error ? "error" : ""}
                help={fieldState.error?.message}
                className="!max-w-md"
              >
                <Input
                  placeholder={t("general.namePlaceholder")}
                  disabled={isPending}
                  {...field}
                />
              </Form.Item>
            )}
          />

          <Form.Item
            label={t("general.email")}
            className="!max-w-md"
            help={t("general.emailDescription")}
          >
            <Input
              type="email"
              value={user.email}
              disabled
              className="!bg-muted"
            />
          </Form.Item>
        </Form>
      </section>

      {/* 头像 */}
      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">{t("avatar.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("avatar.description")}
          </p>
        </div>

        <div className="flex flex-col items-center space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_IMAGE_TYPES.join(",")}
            className="hidden"
            onChange={handleFileChange}
            disabled={isUploadingAvatar}
          />

          <button
            type="button"
            onClick={handleAvatarClick}
            disabled={isUploadingAvatar}
            className="group relative cursor-pointer disabled:cursor-not-allowed"
          >
            <Avatar
              src={currentAvatarUrl}
              alt={user.name}
              size={96}
              className="transition-opacity group-hover:opacity-80 group-disabled:opacity-60 bg-primary text-primary-foreground text-2xl"
            >
              {getInitials(user.name)}
            </Avatar>
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 group-disabled:opacity-100">
              {isUploadingAvatar ? (
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Camera className="h-6 w-6 text-white" />
              )}
            </div>
          </button>

          <p className="text-sm text-muted-foreground">
            {isUploadingAvatar
              ? t("avatar.uploading")
              : t("avatar.supportedFormats", {
                  size: MAX_FILE_SIZE / 1024 / 1024,
                })}
          </p>
        </div>
      </section>

      {/* 语言切换 */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">{t("language.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("language.description")}
            </p>
          </div>

          <Select
            value={locale}
            onChange={handleLanguageChange}
            disabled={isChangingLocale}
            style={{ width: 160 }}
            options={[
              { value: "en", label: "English" },
              { value: "zh", label: "中文" },
            ]}
          />
        </div>
      </section>

      {/* 删除账户 */}
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-destructive">
              {t("deleteAccount.title")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("deleteAccount.description")}
            </p>
          </div>

          <Button
            type="default"
            danger
            onClick={() => setIsDeleteDialogOpen(true)}
            disabled={isDeletingAccount}
          >
            {t("deleteAccount.button")}
          </Button>
        </div>
      </section>

      {/* 删除账户确认 Modal */}
      <Modal
        open={isDeleteDialogOpen}
        onCancel={() => {
          if (!isDeletingAccount) setIsDeleteDialogOpen(false);
        }}
        title={t("deleteAccount.confirmTitle")}
        footer={[
          <Button
            key="cancel"
            type="default"
            onClick={() => setIsDeleteDialogOpen(false)}
            disabled={isDeletingAccount}
          >
            {t("deleteAccount.cancel")}
          </Button>,
          <Button
            key="confirm"
            type="primary"
            danger
            loading={isDeletingAccount}
            onClick={handleDeleteAccount}
          >
            {t("deleteAccount.confirm")}
          </Button>,
        ]}
      >
        <Alert
          type="warning"
          message={t("deleteAccount.confirmDescription")}
          showIcon
          className="!mb-0"
        />
      </Modal>
    </div>
  );

  return (
    <div className="max-w-4xl space-y-8">
      <Tabs
        defaultActiveKey="account"
        items={[
          {
            key: "account",
            label: tTabs("account"),
            children: accountTab,
          },
          {
            key: "security",
            label: tTabs("security"),
            children: (
              <div className="mt-8 pl-4">
                <SecuritySection />
              </div>
            ),
          },
          {
            key: "billing",
            label: tTabs("billing"),
            children: (
              <div className="mt-8 pl-4">
                <BillingSection />
              </div>
            ),
          },
          {
            key: "usage",
            label: tTabs("usage"),
            children: (
              <div className="mt-8 pl-4">
                <CreditUsageSection />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
