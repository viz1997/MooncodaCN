"use client";

/**
 * 站点设置后台 —— `/admin/site-settings`
 *
 * 工作室 2026-11-11 的要求:**「不需要环境变量,在后台设置」** —— 海外独立站
 * 的顾客访问地址改成后台可配,改完**不用重新部署**。
 *
 * 2026-11-13 加了**第二项设置**:客服微信二维码的图片地址(页脚「客服」那一
 * 栏,点开弹二维码)。
 *
 * 这一页两块:
 *
 * 1. **当前生效值**(只读卡)—— 先让人看见「现在到底按什么在生效」,再动
 *    下面的表单。每项设置**各自一张卡**、各自一个「删掉这一行」按钮。
 * 2. **表单**—— **一张表单两个字段**,一个「保存」按钮。
 *
 * ## 为什么保存是一个按钮,重置是两个
 *
 * 两项设置**共用一个事务**(要么都写进去,要么都不写)⇒ 一次「保存」把两项
 * 都写掉是对的。
 *
 * 但「重置」是**按项**的 —— 「把独立站退回环境变量」不该顺手把二维码也
 * 退回去。⇒ 两颗重置按钮,一颗管一项。
 *
 * ## 配置界面在页面上直接处理,不开弹窗
 *
 * 工作室的口味(跟打印定价 / 优惠码后台一个套路)。
 *
 * ## 三档状态,后台要能分清
 *
 * | 状态 | 含义 |
 * |---|---|
 * | **后台配置** | DB 里有这一行 ⇒ 它说了算 |
 * | **环境变量兜底** | DB 里没存过 ⇒ 看环境变量 |
 * | **内置默认** | 也没有环境变量 ⇒ 走代码里的静态默认值(只有二维码有) |
 * | **未配置** | 哪儿都没配 ⇒ 入口不出现 |
 *
 * 另加一个「**明确关掉**」:DB 里存了**空串** ⇒ 入口不出现,哪怕环境变量还
 * 配着(那正是「在后台设置」的意义)。
 *
 * ## 「删掉这一行」是另一回事
 *
 * 「关掉」= 存空串;「删掉」= 退回兜底那一档。两个按钮分开摆,别让工作室
 * 以为「恢复默认」是把入口关掉。
 */

import { App, Button, Form, Input, Tag } from "antd";
import {
  AlertTriangle,
  CircleDot,
  Globe,
  MessageCircle,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";

import {
  adminGetSiteSettingsAction,
  adminResetSiteSettingsAction,
  adminSaveSiteSettingsAction,
} from "@/features/site-settings/admin/actions";
import type { AdminSiteSettingsView } from "@/features/site-settings/admin/types";
import { SITE_SETTING_KEYS } from "@/features/site-settings/lib/site-setting";

/* -------------------------------------------------------------------------- */
/*  表单形状                                                                    */
/* -------------------------------------------------------------------------- */

type SettingsFormValues = {
  /** 海外独立站(Shopify)的顾客访问地址 —— 空串 = 明确关掉 */
  internationalStoreUrl: string;
  /** 客服微信二维码的图片地址 —— 空串 = 明确关掉 */
  serviceWechatQrUrl: string;
};

/* -------------------------------------------------------------------------- */
/*  组件                                                                       */
/* -------------------------------------------------------------------------- */

export function SiteSettingsAdminView() {
  const t = useTranslations("AdminSiteSettings");
  const { message } = App.useApp();

  const [overview, setOverview] = useState<AdminSiteSettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form] = Form.useForm<SettingsFormValues>();

  /* ---------------------------------------------------------------- 读 ---- */

  const load = useCallback(async () => {
    try {
      const res = await adminGetSiteSettingsAction();
      if (res?.data) {
        setOverview(res.data);
        setLoadError(null);
        // 表单里摆的是**后台存的那个值** —— 没存过就摆兜底那一档,
        // 让工作室看到「现在生效的是这个」。
        form.setFieldsValue({
          internationalStoreUrl: res.data.dbValue ?? res.data.envValue ?? "",
          serviceWechatQrUrl:
            res.data.serviceQrDbValue ?? res.data.serviceQrEnvValue ?? "",
        });
      }
    } catch {
      setLoadError(t("messages.loadFailed"));
    }
  }, [t, form]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------------------------------------------------------------- 写 ---- */

  const { execute: save, isPending: isSaving } = useAction(
    adminSaveSiteSettingsAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(t(`errors.${data.code}`));
          return;
        }
        message.success(t("messages.saveSuccess"));
        void load();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("errors.SAVE_FAILED"));
      },
    }
  );

  // 两颗重置按钮 ⇒ 两个 hook(各自独立的 loading 状态)
  //
  // 「use server」那个 action 的入参是 `{ key }` —— **按项**重置。
  const { execute: resetStore, isPending: isResettingStore } = useAction(
    adminResetSiteSettingsAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(t(`errors.${data.code}`));
          return;
        }
        message.success(t("messages.resetSuccess"));
        void load();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("errors.SAVE_FAILED"));
      },
    }
  );

  const { execute: resetQr, isPending: isResettingQr } = useAction(
    adminResetSiteSettingsAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(t(`errors.${data.code}`));
          return;
        }
        message.success(t("messages.resetQrSuccess"));
        void load();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("errors.SAVE_FAILED"));
      },
    }
  );

  /* ------------------------------------------------------------ 表单动作 -- */

  const onSave = async (values: SettingsFormValues) => {
    await save({
      internationalStoreUrl: values.internationalStoreUrl ?? "",
      serviceWechatQrUrl: values.serviceWechatQrUrl ?? "",
    });
  };

  /* -------------------------------------------------------- 渲染 --------- */

  if (loadError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-sm">
        {loadError}
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <RotateCcw className="h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Globe className="h-5 w-5 text-emerald-600" />
          {t("title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* ① 当前生效值 —— 每项设置一张卡 */}
      <section className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <CircleDot className="h-4 w-4 text-emerald-600" />
          {t("current.title")}
        </h3>

        {/* 海外独立站 */}
        <SettingStatus
          title={t("current.storeTitle")}
          icon={<Globe className="h-4 w-4 text-emerald-600" />}
          source={overview.source}
          sourceLabels={{
            db: t("current.sourceDb"),
            env: t("current.sourceEnv"),
            default: t("current.sourceDefault"),
            none: t("current.sourceNone"),
          }}
          effectiveUrl={overview.effectiveUrl}
          envValue={overview.envValue}
          invalid={overview.invalid}
          invalidText={t("current.invalid")}
          emptyText={t("current.empty")}
          effectiveLabel={t("current.effectiveUrl")}
          envLabel={t("current.envUrl")}
          readError={overview.readError}
          readFailedText={t("current.readFailed")}
          banner={
            overview.readError
              ? null
              : overview.source === "env"
                ? t("banner.envFallback")
                : overview.source === "none"
                  ? t("banner.notConfigured")
                  : null
          }
          resetLabel={t("actions.reset")}
          onReset={() =>
            void resetStore({ key: SITE_SETTING_KEYS.internationalStoreUrl })
          }
          isResetting={isResettingStore}
        />

        {/* 客服微信二维码 */}
        <SettingStatus
          title={t("current.serviceTitle")}
          icon={<MessageCircle className="h-4 w-4 text-emerald-600" />}
          source={overview.serviceQrSource}
          sourceLabels={{
            db: t("current.sourceDb"),
            env: t("current.sourceEnv"),
            default: t("current.sourceDefault"),
            none: t("current.sourceNone"),
          }}
          effectiveUrl={overview.serviceQrUrl}
          envValue={overview.serviceQrEnvValue}
          invalid={overview.serviceQrInvalid}
          invalidText={t("current.invalid")}
          emptyText={t("current.empty")}
          effectiveLabel={t("current.effectiveUrl")}
          envLabel={t("current.envUrl")}
          readError={null}
          readFailedText={t("current.readFailed")}
          banner={
            overview.serviceQrSource === "env"
              ? t("banner.envFallbackQr")
              : overview.serviceQrSource === "default"
                ? t("banner.defaultQr")
                : null
          }
          resetLabel={t("actions.resetQr")}
          onReset={() =>
            void resetQr({ key: SITE_SETTING_KEYS.serviceWechatQrUrl })
          }
          isResetting={isResettingQr}
        />
      </section>

      {/* ② 表单 —— 一张表单两个字段,一个「保存」
          两项**分两组摆**(各带自己的小标题)—— 两项不是一回事:
          ① 境外 Shopify 店铺的地址 ② 页脚客服那张二维码图的地址。 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Globe className="h-4 w-4 text-emerald-600" />
          {t("form.title")}
        </h3>
        <p className="mb-4 text-xs text-muted-foreground">{t("form.help")}</p>

        <Form form={form} layout="vertical" onFinish={onSave}>
          <Form.Item
            name="internationalStoreUrl"
            label={t("form.label")}
            extra={t("form.extra")}
          >
            <Input
              placeholder={t("form.placeholder")}
              disabled={isSaving || isResettingStore || isResettingQr}
            />
          </Form.Item>

          {/* 第二项 —— 客服二维码,跟上面那项不是一回事 ⇒ 分组 */}
          <div className="mt-6 border-t pt-5">
            <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <MessageCircle className="h-4 w-4 text-emerald-600" />
              {t("form.qrTitle")}
            </h4>
            <p className="mb-3 text-xs text-muted-foreground">
              {t("form.serviceHelp")}
            </p>
            <Form.Item
              name="serviceWechatQrUrl"
              label={t("form.serviceLabel")}
              extra={t("form.serviceExtra")}
            >
              <Input
                placeholder={t("form.servicePlaceholder")}
                disabled={isSaving || isResettingStore || isResettingQr}
              />
            </Form.Item>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="primary"
              htmlType="submit"
              icon={<Save className="h-4 w-4" />}
              loading={isSaving}
            >
              {t("actions.save")}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t("form.saveNote")}
            </span>
          </div>
        </Form>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  小工具                                                                      */
/* -------------------------------------------------------------------------- */

/** 一项设置的「当前生效值」卡 —— 两项设置**共用这一个组件** */
function SettingStatus({
  title,
  icon,
  source,
  sourceLabels,
  effectiveUrl,
  envValue,
  invalid,
  invalidText,
  emptyText,
  effectiveLabel,
  envLabel,
  readError,
  readFailedText,
  banner,
  resetLabel,
  onReset,
  isResetting,
}: {
  title: string;
  icon: React.ReactNode;
  source: "db" | "env" | "default" | "none";
  sourceLabels: Record<"db" | "env" | "default" | "none", string>;
  effectiveUrl: string;
  envValue: string;
  invalid: boolean;
  invalidText: string;
  emptyText: string;
  effectiveLabel: string;
  envLabel: string;
  readError: string | null;
  readFailedText: string;
  banner: string | null;
  resetLabel: string;
  onReset: () => void;
  isResetting: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </h4>
        <div className="flex items-center gap-2">
          {source === "db" ? (
            <Tag color="green">{sourceLabels.db}</Tag>
          ) : source === "env" ? (
            <Tag color="orange">{sourceLabels.env}</Tag>
          ) : source === "default" ? (
            <Tag color="blue">{sourceLabels.default}</Tag>
          ) : (
            <Tag color="default">{sourceLabels.none}</Tag>
          )}
          <Button
            size="small"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            loading={isResetting}
            onClick={onReset}
          >
            {resetLabel}
          </Button>
        </div>
      </div>

      {readError ? (
        /* 读失败跟「还没存过」是两回事 —— 前者得先跑迁移脚本,不然后台
           每个写操作都会撞同一个错。用红条摆出来。 */
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs leading-relaxed">
          <p className="mb-1 flex items-center gap-1 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            {readFailedText}
          </p>
          <p className="text-muted-foreground">
            {readError}。现在页面上摆的是环境变量那一份,存不进去 —— 先把
            <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono">
              pnpm migrate:apply-site-setting
            </code>
            跑一遍,再回来保存。
          </p>
        </div>
      ) : banner ? (
        <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-relaxed">
          {banner}
        </div>
      ) : null}

      {invalid ? (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs leading-relaxed">
          {invalidText}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 text-xs md:grid-cols-2">
        <Readonly label={effectiveLabel} value={effectiveUrl || emptyText} />
        <Readonly label={envLabel} value={envValue || emptyText} />
      </div>
    </div>
  );
}

/** 只读的一格 —— 跟打印定价后台一个样式 */
function Readonly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-all font-medium">{value}</p>
    </div>
  );
}
