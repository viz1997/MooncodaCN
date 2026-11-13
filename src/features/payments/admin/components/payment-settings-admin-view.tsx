"use client";

/**
 * 支付设置后台 —— `/admin/payment-settings`
 *
 * 工作室 2026-11-13 的要求:**「支付宝、微信支付先用沙盒测试验证」**,外加
 * **「可以后台配置」**。
 *
 * 这一页三块(工作室的口味:**配置界面在页面上直接处理,不开弹窗**):
 *
 * 1. **当前生效状态**(只读卡)—— 每个通道:当前模式 / **确切端点** / 凭据从
 *    哪儿来 / 配好了没 / **缺哪几个**(精确列名字)。两个模式都摆出来。
 * 2. **凭据表单** —— 微信 + 支付宝各一块:沙箱开关 + 端点 + 凭据。
 * 3. **测试** —— 「跑一笔 ¥0.01 测试单」按钮。
 *
 * ## 密钥不回显
 *
 * 已配的私钥只显示 `已配置(…abcd)`(PEM 显示 `已配置(RSA PRIVATE KEY)`)——
 * **原文永远不发到浏览器**。
 *
 * ## 密钥输入框**留空 = 保持原值**
 *
 * 表单提交时那个输入框**本来就是空的**(原文没回来)。如果空串 = 清空,工作室
 * 点一次「保存」就把私钥擦了 —— 而下一次支付以「签名错误」的形式炸出来,极难
 * 联想到「我刚才点了个保存」。
 *
 * ⇒ **空 = 不动这一行**。要清空一个密钥 ⇒ 用那一栏的「删掉这一行」按钮。
 *
 * ## 非密钥字段留空 = **清空**(退回默认值)
 *
 * 端点 / 通知地址这类字段留空是有意义的(「留空 = 用默认」)⇒ 空串要写进去。
 *
 * ## 测试按钮走**生产的同一条代码路径**
 *
 * `provider.createSession()` —— 结算页调的就是它。另写一份「测试实现」等于
 * 什么都没验:签名拼错了、端点拼错了,那份「测试实现」照样能跑通。
 *
 * ## 正式模式下要**再点一次**
 *
 * 一颗写着「跑一笔 ¥0.01 测试单」的按钮,在**正式模式**下会**真的扣 1 分钱**
 * ⇒ 服务端先回 `TEST_NEEDS_PRODUCTION_CONFIRM`,界面再问一次(仍然**不弹窗**,
 * 就地展开一块确认条)。
 */

import { App, Button, Form, Input, Switch, Tag } from "antd";
import {
  AlertTriangle,
  CircleDot,
  CreditCard,
  FlaskConical,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";

import {
  adminDeletePaymentSettingAction,
  adminGetPaymentSettingsAction,
  adminSavePaymentSettingsAction,
  adminTestPaymentChannelAction,
} from "@/features/payments/admin/actions";
import type {
  AdminPaymentChannelView,
  AdminPaymentFieldView,
  AdminPaymentSettingsView,
  AdminPaymentTestResult,
} from "@/features/payments/admin/types";
import { PaymentQrCode } from "@/features/payments/components/payment-qr";
import type {
  PaymentSettingKey,
  SandboxChannel,
} from "@/features/payments/lib/sandbox";

/* -------------------------------------------------------------------------- */
/*  表单形状                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 表单的值
 *
 * 文本字段收在一张 map 里 —— **键就是 DB 键**。字段清单住在 `sandbox.ts` 的
 * `FieldGroup` 里(表单、缺字段诊断、写入全靠那一份),这里再列一遍就是
 * **第二份清单**。
 */
type PaymentSettingsFormValues = {
  /** 微信沙箱开关 */
  wechatSandboxEnabled: boolean;
  /** 支付宝沙箱开关 */
  alipaySandboxEnabled: boolean;
  /** 文本字段 —— 键 = DB 键 */
  values: Record<string, string>;
};

/* -------------------------------------------------------------------------- */
/*  组件                                                                       */
/* -------------------------------------------------------------------------- */

export function PaymentSettingsAdminView() {
  const t = useTranslations("AdminPaymentSettings");
  const { message } = App.useApp();

  const [overview, setOverview] = useState<AdminPaymentSettingsView | null>(
    null
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form] = Form.useForm<PaymentSettingsFormValues>();

  /** 每个通道最近一次测试的结果 */
  const [tests, setTests] = useState<
    Partial<Record<SandboxChannel, AdminPaymentTestResult>>
  >({});
  /** 正在跑测试的通道 */
  const [testingChannel, setTestingChannel] = useState<SandboxChannel | null>(
    null
  );
  /** 等工作室再点一次确认的通道(正式模式 ⇒ 这一笔真扣钱) */
  const [confirming, setConfirming] = useState<SandboxChannel | null>(null);

  /* ---------------------------------------------------------------- 读 ---- */

  const load = useCallback(async () => {
    try {
      const res = await adminGetPaymentSettingsAction();
      if (!res?.data) return;

      setOverview(res.data);
      setLoadError(null);

      // 表单预填 —— **非密钥字段**摆当前值;密钥字段**留空**(原文没回来)
      const values: Record<string, string> = {};
      for (const channel of [res.data.wechat, res.data.alipay]) {
        for (const field of channel.fields) {
          values[field.key] = field.secret ? "" : (field.value ?? "");
        }
      }

      form.setFieldsValue({
        wechatSandboxEnabled: res.data.wechat.mode === "sandbox",
        alipaySandboxEnabled: res.data.alipay.mode === "sandbox",
        values,
      });
    } catch {
      setLoadError(t("messages.loadFailed"));
    }
  }, [t, form]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------------------------------------------------------------- 写 ---- */

  const { execute: save, isPending: isSaving } = useAction(
    adminSavePaymentSettingsAction,
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

  const { execute: removeRow, isPending: isRemoving } = useAction(
    adminDeletePaymentSettingAction,
    {
      onSuccess: ({ data }) => {
        if (data?.ok === false) {
          message.error(t(`errors.${data.code}`));
          return;
        }
        message.success(t("messages.deleteSuccess"));
        void load();
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("errors.DELETE_FAILED"));
      },
    }
  );

  const { execute: runTest } = useAction(adminTestPaymentChannelAction, {
    onSuccess: ({ data }) => {
      if (!data) return;
      setTests((prev) => ({ ...prev, [data.channel]: data }));

      // 正式模式 ⇒ 这一笔**真的扣钱** ⇒ 先问一次
      if (data.code === "TEST_NEEDS_PRODUCTION_CONFIRM") {
        setConfirming(data.channel);
        return;
      }
      if (data.ok) {
        message.success(t("messages.testSuccess"));
        return;
      }
      message.error(
        data.message ?? t(`errors.${data.code ?? "TEST_PROVIDER_FAILED"}`)
      );
    },
    onError: ({ error }) => {
      message.error(error.serverError ?? t("errors.TEST_PROVIDER_FAILED"));
    },
  });

  /* ------------------------------------------------------------ 表单动作 -- */

  const onSave = async (values: PaymentSettingsFormValues) => {
    await save({
      wechatSandboxEnabled: values.wechatSandboxEnabled === true,
      alipaySandboxEnabled: values.alipaySandboxEnabled === true,
      values: values.values ?? {},
    });
  };

  const onTest = async (channel: SandboxChannel, allowProduction: boolean) => {
    setTestingChannel(channel);
    setConfirming(null);
    try {
      await runTest({ channel, allowProduction });
    } finally {
      setTestingChannel(null);
    }
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
        <CircleDot className="h-4 w-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  const wechat = overview.wechat;
  const alipay = overview.alipay;
  const anySandbox = wechat.mode === "sandbox" || alipay.mode === "sandbox";
  const anyInvalid = wechat.modeInvalid || alipay.modeInvalid;
  const busy = isSaving || isRemoving;

  return (
    <div className="space-y-6">
      {/* 页头 */}
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <CreditCard className="h-5 w-5 text-emerald-600" />
          {t("title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* 表还没建 —— 每个写操作都会撞同一个错,先说清楚 */}
      {overview.missingRelation ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs leading-relaxed">
          <p className="mb-1 flex items-center gap-1 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            {t("banner.missingTable")}
          </p>
          <p className="text-muted-foreground">
            {t("banner.missingTableDetail")}
          </p>
        </div>
      ) : null}

      {/* 沙箱横幅 —— 上线忘了关 = 真客户的钱付进沙箱,收不到 */}
      {anySandbox ? (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs leading-relaxed">
          <p className="mb-1 flex items-center gap-1 font-medium">
            <FlaskConical className="h-3.5 w-3.5 text-amber-600" />
            {t("banner.sandboxTitle")}
          </p>
          <p className="text-muted-foreground">{t("banner.sandboxDetail")}</p>
        </div>
      ) : null}

      {/* 开关的值认不出来 ⇒ 那个通道选不了 */}
      {anyInvalid ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs leading-relaxed">
          <p className="mb-1 flex items-center gap-1 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            {t("banner.invalidTitle")}
          </p>
          <p className="text-muted-foreground">{t("banner.invalidDetail")}</p>
        </div>
      ) : null}

      {/* ① 当前生效状态 */}
      <section className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          {t("status.title")}
        </h3>

        <ChannelStatus
          channel={wechat}
          title={t("channels.wechat")}
          modeSandbox={t("status.modeSandbox")}
          modeProduction={t("status.modeProduction")}
          configuredText={t("status.configured")}
          notConfiguredText={t("status.notConfigured")}
          endpointLabel={t("status.endpoint")}
          endpointFailedText={t("status.endpointFailed")}
          sourceLabel={t("status.source")}
          sourceDbText={t("status.sourceDb")}
          sourceEnvText={t("status.sourceEnv")}
          missingLabel={t("status.missing")}
          missingVerifyLabel={t("status.missingVerify")}
          allPresentText={t("status.allPresent")}
          otherModeLabel={t("status.otherMode")}
          sameCredentialText={t("status.sameCredential")}
          modeInvalidText={t("status.modeInvalid")}
        />

        <ChannelStatus
          channel={alipay}
          title={t("channels.alipay")}
          modeSandbox={t("status.modeSandbox")}
          modeProduction={t("status.modeProduction")}
          configuredText={t("status.configured")}
          notConfiguredText={t("status.notConfigured")}
          endpointLabel={t("status.endpoint")}
          endpointFailedText={t("status.endpointFailed")}
          sourceLabel={t("status.source")}
          sourceDbText={t("status.sourceDb")}
          sourceEnvText={t("status.sourceEnv")}
          missingLabel={t("status.missing")}
          missingVerifyLabel={t("status.missingVerify")}
          allPresentText={t("status.allPresent")}
          otherModeLabel={t("status.otherMode")}
          sameCredentialText={t("status.sameCredential")}
          modeInvalidText={t("status.modeInvalid")}
        />
      </section>

      {/* ② 表单 —— 两个通道的沙箱凭据,一个「保存」 */}
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <CreditCard className="h-4 w-4 text-emerald-600" />
          {t("form.title")}
        </h3>
        <p className="mb-4 text-xs text-muted-foreground">{t("form.help")}</p>

        <Form form={form} layout="vertical" onFinish={onSave}>
          <ChannelForm
            channelKey="wechatSandboxEnabled"
            title={t("form.wechatTitle")}
            help={t("form.wechatHelp")}
            fields={wechat.fields}
            disabled={busy}
            onDelete={(key) => void removeRow({ key })}
            isRemoving={isRemoving}
          />

          <div className="mt-6 border-t pt-5">
            <ChannelForm
              channelKey="alipaySandboxEnabled"
              title={t("form.alipayTitle")}
              help={t("form.alipayHelp")}
              fields={alipay.fields}
              disabled={busy}
              onDelete={(key) => void removeRow({ key })}
              isRemoving={isRemoving}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 border-t pt-5">
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

      {/* ③ 测试 */}
      <section className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FlaskConical className="h-4 w-4 text-amber-600" />
          {t("test.title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("test.help")}</p>

        {(["wechat", "alipay"] as const).map((channel) => (
          <TestPanel
            key={channel}
            title={t(`channels.${channel}`)}
            result={tests[channel]}
            isTesting={testingChannel === channel}
            needsConfirm={confirming === channel}
            onTest={() => void onTest(channel, false)}
            onConfirm={() => void onTest(channel, true)}
            onCancel={() => setConfirming(null)}
            testLabel={t("actions.test")}
            confirmLabel={t("actions.confirmProduction")}
            cancelLabel={t("actions.cancel")}
            confirmTitle={t("test.confirmTitle")}
            confirmDetail={t("test.confirmDetail")}
            qrLabel={t("test.qrLabel")}
            qrHint={t("test.qrHint")}
            redirectLabel={t("test.redirectLabel")}
            openLabel={t("test.openLabel")}
            modeSandbox={t("status.modeSandbox")}
            modeProduction={t("status.modeProduction")}
          />
        ))}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  当前生效状态卡                                                              */
/* -------------------------------------------------------------------------- */

function ChannelStatus({
  channel,
  title,
  modeSandbox,
  modeProduction,
  configuredText,
  notConfiguredText,
  endpointLabel,
  endpointFailedText,
  sourceLabel,
  sourceDbText,
  sourceEnvText,
  missingLabel,
  missingVerifyLabel,
  allPresentText,
  otherModeLabel,
  sameCredentialText,
  modeInvalidText,
}: {
  channel: AdminPaymentChannelView;
  title: string;
  modeSandbox: string;
  modeProduction: string;
  configuredText: string;
  notConfiguredText: string;
  endpointLabel: string;
  endpointFailedText: string;
  sourceLabel: string;
  sourceDbText: string;
  sourceEnvText: string;
  missingLabel: string;
  missingVerifyLabel: string;
  allPresentText: string;
  otherModeLabel: string;
  sameCredentialText: string;
  modeInvalidText: string;
}) {
  const t = useTranslations("AdminPaymentSettings");
  // 「另一个模式」= 当前不是沙箱就是沙箱,不是沙箱就是正式
  const other =
    channel.mode === "sandbox" ? channel.production : channel.sandbox;
  const otherIsSandbox = channel.mode !== "sandbox";

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h4 className="mr-auto flex items-center gap-2 text-sm font-semibold">
          <CreditCard className="h-4 w-4 text-emerald-600" />
          {title}
        </h4>

        {channel.modeInvalid ? (
          <Tag color="red">{modeInvalidText}</Tag>
        ) : channel.mode === "sandbox" ? (
          <Tag color="orange">{modeSandbox}</Tag>
        ) : (
          <Tag color="default">{modeProduction}</Tag>
        )}

        {channel.modeInvalid ? (
          <Tag color="red">{notConfiguredText}</Tag>
        ) : channel.canTransact ? (
          <Tag color="green">{configuredText}</Tag>
        ) : (
          <Tag color="orange">{notConfiguredText}</Tag>
        )}
      </div>

      {/* 确切端点 —— 排查时一眼看出打到了哪个 URL */}
      <div className="mb-3 grid grid-cols-1 gap-x-4 gap-y-3 text-xs md:grid-cols-2">
        <div>
          <p className="text-[11px] text-muted-foreground">{endpointLabel}</p>
          <p className="mt-0.5 break-all font-medium">
            {channel.endpoint ?? (
              <span className="text-destructive">
                {channel.endpointMessage ?? endpointFailedText}
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">{sourceLabel}</p>
          <p className="mt-0.5 font-medium">
            {channel.mode === "sandbox" ? sourceDbText : sourceEnvText}
          </p>
        </div>
      </div>

      {/* 当前模式缺什么 */}
      <div className="mb-3 text-xs">
        <p className="text-[11px] text-muted-foreground">{missingLabel}</p>
        {channel.missing.length === 0 ? (
          <p className="mt-0.5 font-medium text-emerald-700">
            {allPresentText}
          </p>
        ) : (
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-destructive">
            {channel.missing.map((field) => (
              <li key={field.key}>
                {t(`fields.${field.key}`)}
                <span className="ml-1 text-muted-foreground">
                  ({field.envVar})
                </span>
              </li>
            ))}
          </ul>
        )}

        {channel.missingVerify.length > 0 ? (
          <>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {missingVerifyLabel}
            </p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-amber-700">
              {channel.missingVerify.map((field) => (
                <li key={field.key}>
                  {t(`fields.${field.key}`)}
                  <span className="ml-1 text-muted-foreground">
                    ({field.envVar})
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>

      {/* 另一个模式的状态 —— 工作室要能一眼看到「正式那边还缺什么」 */}
      <div className="border-t pt-3 text-xs">
        <p className="text-[11px] text-muted-foreground">{otherModeLabel}</p>
        <p className="mt-0.5 font-medium">
          {otherIsSandbox ? modeSandbox : modeProduction} ——{" "}
          {other.missing.length === 0
            ? allPresentText
            : other.missing.map((field) => t(`fields.${field.key}`)).join("、")}
        </p>
      </div>

      {/* 沙箱凭据跟正式凭据同值 ⇒ 大概率贴错了 */}
      {channel.sameCredential.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
          <p className="font-medium">{sameCredentialText}</p>
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {channel.sameCredential.map((field) => (
              <li key={field.key}>{t(`fields.${field.key}`)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  一个通道的表单                                                              */
/* -------------------------------------------------------------------------- */

function ChannelForm({
  channelKey,
  title,
  help,
  fields,
  disabled,
  onDelete,
  isRemoving,
}: {
  channelKey: "wechatSandboxEnabled" | "alipaySandboxEnabled";
  title: string;
  help: string;
  fields: AdminPaymentFieldView[];
  disabled: boolean;
  onDelete: (key: PaymentSettingKey) => void;
  isRemoving: boolean;
}) {
  const t = useTranslations("AdminPaymentSettings");

  return (
    <div>
      <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <CreditCard className="h-4 w-4 text-emerald-600" />
        {title}
      </h4>
      <p className="mb-3 text-xs text-muted-foreground">{help}</p>

      {/* 沙箱开关 */}
      <Form.Item
        name={channelKey}
        label={t("form.switchLabel")}
        valuePropName="checked"
        extra={t("form.switchExtra")}
      >
        <Switch disabled={disabled} />
      </Form.Item>

      <div className="space-y-3">
        {fields.map((field) => (
          <Form.Item
            key={field.key}
            name={["values", field.key]}
            label={
              <span className="text-xs">
                {t(`fields.${field.key}`)}
                {field.optional ? (
                  <span className="ml-1 text-[11px] text-muted-foreground">
                    ({t("form.optional")})
                  </span>
                ) : null}
              </span>
            }
            extra={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                <span>
                  {t("form.envVarHint")}:{" "}
                  <code className="rounded bg-muted px-1 font-mono">
                    {field.envVar}
                  </code>
                </span>
                {field.secret ? (
                  <span className="text-amber-700">{t("form.secretHint")}</span>
                ) : null}
                {/* 「删掉这一行」—— 清空一个密钥的唯一办法(输入框留空是「保持原值」) */}
                <Button
                  type="link"
                  size="small"
                  className="h-auto p-0 text-[11px]"
                  icon={<Trash2 className="h-3 w-3" />}
                  loading={isRemoving}
                  disabled={disabled}
                  onClick={() => onDelete(field.key)}
                >
                  {t("actions.deleteRow")}
                </Button>
              </span>
            }
          >
            {field.multiline ? (
              <Input.TextArea
                rows={6}
                disabled={disabled}
                placeholder={
                  field.secret
                    ? (field.masked ?? t("form.notSet"))
                    : t("form.placeholder")
                }
                className="font-mono text-xs"
              />
            ) : (
              <Input
                disabled={disabled}
                placeholder={
                  field.secret
                    ? (field.masked ?? t("form.notSet"))
                    : t("form.placeholder")
                }
              />
            )}
          </Form.Item>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  测试面板                                                                    */
/* -------------------------------------------------------------------------- */

function TestPanel({
  title,
  result,
  isTesting,
  needsConfirm,
  onTest,
  onConfirm,
  onCancel,
  testLabel,
  confirmLabel,
  cancelLabel,
  confirmTitle,
  confirmDetail,
  qrLabel,
  qrHint,
  redirectLabel,
  openLabel,
  modeSandbox,
  modeProduction,
}: {
  title: string;
  result: AdminPaymentTestResult | undefined;
  isTesting: boolean;
  needsConfirm: boolean;
  onTest: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  testLabel: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmTitle: string;
  confirmDetail: string;
  qrLabel: string;
  qrHint: string;
  redirectLabel: string;
  openLabel: string;
  modeSandbox: string;
  modeProduction: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="mr-auto flex items-center gap-2 text-sm font-semibold">
          <FlaskConical className="h-4 w-4 text-amber-600" />
          {title}
        </h4>
        {result?.ok ? (
          <Tag color={result.mode === "sandbox" ? "orange" : "red"}>
            {result.mode === "sandbox" ? modeSandbox : modeProduction}
          </Tag>
        ) : null}
        <Button
          size="small"
          icon={<FlaskConical className="h-3.5 w-3.5" />}
          loading={isTesting}
          onClick={onTest}
        >
          {testLabel}
        </Button>
      </div>

      {/* 正式模式 ⇒ 这一笔真扣钱 ⇒ 就地再确认一次(不开弹窗) */}
      {needsConfirm ? (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs leading-relaxed">
          <p className="mb-1 flex items-center gap-1 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            {confirmTitle}
          </p>
          <p className="mb-2 text-muted-foreground">{confirmDetail}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="small" danger type="primary" onClick={onConfirm}>
              {confirmLabel}
            </Button>
            <Button size="small" onClick={onCancel}>
              {cancelLabel}
            </Button>
          </div>
        </div>
      ) : null}

      {/* 结果 */}
      {result && !result.ok ? (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs leading-relaxed">
          <p className="font-medium">{result.code ?? "TEST_PROVIDER_FAILED"}</p>
          {result.message ? (
            <p className="mt-1 break-all text-muted-foreground">
              {result.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {result?.ok ? (
        <div className="mt-3 space-y-3 text-xs">
          {result.qrCodeUrl ? (
            <div className="flex flex-wrap items-start gap-4">
              <PaymentQrCode
                value={result.qrCodeUrl}
                size={180}
                hint={qrHint}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-muted-foreground">{qrLabel}</p>
                <p className="mt-0.5 break-all font-mono text-[11px]">
                  {result.qrCodeUrl}
                </p>
              </div>
            </div>
          ) : null}

          {result.redirectUrl ? (
            <div>
              <p className="text-[11px] text-muted-foreground">
                {redirectLabel}
              </p>
              <p className="mt-0.5 break-all font-mono text-[11px]">
                {result.redirectUrl}
              </p>
              <a
                href={result.redirectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs font-medium underline"
              >
                {openLabel}
              </a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
