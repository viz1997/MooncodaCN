"use client";

/**
 * 站点设置后台 —— `/admin/site-settings`
 *
 * 工作室 2026-11-11 的要求:**「不需要环境变量,在后台设置」** —— 海外独立站
 * 的顾客访问地址改成后台可配,改完**不用重新部署**。
 *
 * 这一页两块:
 *
 * 1. **当前生效值**(只读卡)—— 先让人看见「现在到底按什么在生效」,再动
 *    下面的表单。还没在后台存过时挂一条横幅:还在走环境变量兜底。
 * 2. **海外独立站地址**(表单)—— 一个输入框 + 保存。
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
 * | **环境变量兜底** | DB 里没存过 ⇒ 看 `NEXT_PUBLIC_SHOPIFY_STOREFRONT_URL` |
 * | **未配置** | 哪儿都没配 ⇒ 入口不出现 |
 *
 * 另加一个「**明确关掉**」:DB 里存了**空串** ⇒ 入口不出现,哪怕环境变量还
 * 配着(那正是「在后台设置」的意义)。
 *
 * ## 「删掉这一行」是另一回事
 *
 * 「关掉」= 存空串;「删掉」= 退回环境变量那一档。两个按钮分开摆,别让
 * 工作室以为「恢复默认」是把入口关掉。
 */

import { App, Button, Form, Input, Tag } from "antd";
import {
  AlertTriangle,
  CircleDot,
  Globe,
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

/* -------------------------------------------------------------------------- */
/*  表单形状                                                                    */
/* -------------------------------------------------------------------------- */

type SettingsFormValues = {
  /** 海外独立站(Shopify)的顾客访问地址 —— 空串 = 明确关掉 */
  internationalStoreUrl: string;
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
        // 表单里摆的是**后台存的那个值** —— 没存过就摆环境变量那一档,
        // 让工作室看到「现在生效的是这个」。
        form.setFieldsValue({
          internationalStoreUrl: res.data.dbValue ?? res.data.envValue ?? "",
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

  const { execute: reset, isPending: isResetting } = useAction(
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

  /* ------------------------------------------------------------ 表单动作 -- */

  const onSave = async (values: SettingsFormValues) => {
    await save({ internationalStoreUrl: values.internationalStoreUrl ?? "" });
  };

  const onReset = async () => {
    await reset();
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

      {/* ① 当前生效值 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CircleDot className="h-4 w-4 text-emerald-600" />
            {t("current.title")}
          </h3>
          {overview.source === "db" ? (
            <Tag color="green">{t("current.sourceDb")}</Tag>
          ) : overview.source === "env" ? (
            <Tag color="orange">{t("current.sourceEnv")}</Tag>
          ) : (
            <Tag color="default">{t("current.sourceNone")}</Tag>
          )}
        </div>

        {overview.readError ? (
          /* 读失败跟「还没存过」是两回事 —— 前者得先跑迁移脚本,不然后台
             每个写操作都会撞同一个错。用红条摆出来。 */
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs leading-relaxed">
            <p className="mb-1 flex items-center gap-1 font-medium">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              {t("current.readFailed")}
            </p>
            <p className="text-muted-foreground">
              {overview.readError}。现在页面上摆的是环境变量那一份,存不进去 ——
              先把
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono">
                pnpm migrate:apply-site-setting
              </code>
              跑一遍,再回来保存。
            </p>
          </div>
        ) : overview.source === "env" ? (
          <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-relaxed">
            {t("banner.envFallback")}
          </div>
        ) : overview.source === "none" ? (
          <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs leading-relaxed">
            {t("banner.notConfigured")}
          </div>
        ) : null}

        {overview.invalid ? (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs leading-relaxed">
            {t("current.invalid")}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 text-xs md:grid-cols-2">
          <Readonly
            label={t("current.effectiveUrl")}
            value={overview.effectiveUrl || t("current.empty")}
          />
          <Readonly
            label={t("current.envUrl")}
            value={overview.envValue || t("current.empty")}
          />
        </div>
      </section>

      {/* ② 海外独立站地址 */}
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
              disabled={isSaving || isResetting}
            />
          </Form.Item>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="primary"
              htmlType="submit"
              icon={<Save className="h-4 w-4" />}
              loading={isSaving}
            >
              {t("actions.save")}
            </Button>
            <Button
              icon={<Trash2 className="h-4 w-4" />}
              loading={isResetting}
              onClick={() => void onReset()}
            >
              {t("actions.reset")}
            </Button>
          </div>
        </Form>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  小工具                                                                      */
/* -------------------------------------------------------------------------- */

/** 只读的一格 —— 跟打印定价后台一个样式 */
function Readonly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-all font-medium">{value}</p>
    </div>
  );
}
