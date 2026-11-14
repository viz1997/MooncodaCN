"use client";

/**
 * 支付设置后台 —— `/admin/payment-settings`
 *
 * 工作室 2026-11-13 的要求:**「支付宝、微信支付先用沙盒测试验证」**,外加
 * **「可以后台配置」**。
 *
 * 这一页四块(工作室的口味:**配置界面在页面上直接处理,不开弹窗**):
 *
 * 1. **当前生效状态**(只读卡)—— 每个通道:当前模式 / **确切端点** / 凭据从
 *    哪儿来 / 配好了没 / **缺哪几个**(精确列名字)。两个模式都摆出来。
 * 2. **凭据表单** —— 微信 + 支付宝各一块:沙箱开关 + 端点 + 凭据。
 * 3. **测试** —— 「跑一笔 ¥0.01 测试单」按钮。
 * 4. **查单自检** —— 贴一个订单号,当场问支付宝「这单到底付了没」。
 *
 * ## ④ 查单自检为什么必须有(2026-11-14)
 *
 * 线上真踩过(`SO-20261114-137332`):支付宝那边**已经付款成功**,我们这边因为
 * **验签那一步没过**(`signature_invalid`)核不上 ⇒ 订单永远是 `unpaid` ⇒
 * 买家以为没付、**再付一次**;工作室看到的是一张没付的单。
 *
 * 那条链路上**什么日志都没有** —— 通知验签失败回 401,支付宝重投 8 次之后
 * 放弃;查单那一腿同样验不过 ⇒ 结论永远是笼统的「查单没查成」。
 *
 * ⇒ 这一块把**原始事实**摆出来:每套凭据打了哪个网关、支付宝回了什么
 * (`code` / `sub_code` / `trade_status` / `total_amount`)、**签名验过没有**
 * (`verified === false` ⇒ 签名没验过 —— **别急着去重贴公钥**,也可能是我们
 * 拼错了待签字符串,见 `alipay/response-sign.ts`)。工作室照着这张表一眼就能
 * 看出是「公钥不对」/「APPID 跟私钥不是一套」/「用户还没付」。
 *
 * ## 沙箱字段**只在开关拨到「开」的时候才出现**
 *
 * 工作室 2026-11-14 的原话:**「开启后才展示沙箱字段内容,而不是全部直接
 * 展示」**;「关闭后不展示」。
 *
 * 开关关着 = 这个通道走**正式模式**(环境变量那套凭据)⇒ 沙箱的端点 / 凭据
 * 一格都不显示,只摆一句「当前是正式模式」。
 *
 * **关掉不删数据** —— 表单里没有的键,服务端拿到 `undefined` ⇒
 * `adminSavePaymentSettingsAction` 的 `if (raw === undefined) continue;`
 * 直接跳过 ⇒ **DB 里那行沙箱配置一个字都不动**(下次拨到「开」还在)。
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

import type { FormInstance } from "antd";
import { App, Button, Form, Input, Switch, Tag } from "antd";
import {
  AlertTriangle,
  CircleDot,
  CreditCard,
  FlaskConical,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";

import {
  adminDeletePaymentSettingAction,
  adminGetPaymentSettingsAction,
  adminReconcileStorefrontOrderAction,
  adminSavePaymentSettingsAction,
  adminTestPaymentChannelAction,
} from "@/features/payments/admin/actions";
import type {
  AdminPaymentChannelView,
  AdminPaymentFieldView,
  AdminPaymentReconcileResult,
  AdminPaymentSettingsView,
  AdminPaymentTestResult,
} from "@/features/payments/admin/types";
import { PaymentQrCode } from "@/features/payments/components/payment-qr";
import type {
  PaymentSettingKey,
  SandboxChannel,
} from "@/features/payments/lib/sandbox";
import { shouldShowSandboxFields } from "@/features/payments/lib/sandbox";
import { formatCents } from "@/lib/money";

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
  /** 查单自检:贴进来的订单号 */
  const [reconcileOrderNo, setReconcileOrderNo] = useState("");
  /** 查单自检:最近一次的结果 */
  const [reconcile, setReconcile] = useState<
    AdminPaymentReconcileResult | undefined
  >(undefined);

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

  /**
   * 查单自检
   *
   * **诊断**,不是「跑通 / 没跑通」——
   *
   * - 查出来「不是付款成功」= **一个结论**(用户还没付完)⇒ `ok: true`
   * - 查出来「签名验不过」= **一个结论**(签名没验过)⇒ `ok: true`
   * - 订单号不存在 / 调用整个挂了 = **这次调用没成** ⇒ `ok: false`
   */
  const { execute: runReconcile, isPending: isReconciling } = useAction(
    adminReconcileStorefrontOrderAction,
    {
      onSuccess: ({ data }) => {
        if (!data) return;
        if (data.ok === false) {
          message.error(t(`errors.${data.code}`));
          return;
        }
        setReconcile(data);
      },
      onError: ({ error }) => {
        message.error(error.serverError ?? t("errors.RECONCILE_FAILED"));
      },
    }
  );

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

  /**
   * 查一次单 —— **只查,不写任何配置**
   *
   * 这一步**不动任何开关、不动任何凭据** —— 它只是拿订单号去问支付宝
   * 「这单到底付了没」。查出来已付的会**顺带把订单标成已付**(那是查单那条
   * 腿本来就要做的事)。
   */
  const onReconcile = async () => {
    const orderNo = reconcileOrderNo.trim();
    if (!orderNo) return;
    setReconcile(undefined);
    await runReconcile({ orderNo });
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

  /**
   * 通知地址的问题 —— 两个通道**当前模式**上的
   *
   * 通知地址配错 = **钱付了、订单永远是 `unpaid`**,而且**没有任何报错**
   * (线上真踩过:`SO-20261114-657E4A`)。⇒ 摆成页面顶部的横幅,别埋在卡片里。
   */
  const notifyProblems = [
    { channel: wechat, label: t("channels.wechat") },
    { channel: alipay, label: t("channels.alipay") },
  ].flatMap(({ channel, label }) =>
    channel.notifyUrlProblems.map((problem) => ({
      key: `${channel.channel}-${problem}`,
      channelLabel: label,
      problem,
    }))
  );

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

      {/* 通知地址配错 = 钱付了、订单永远不标已付 —— 摆到最上面 */}
      {notifyProblems.length > 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs leading-relaxed">
          <p className="mb-1 flex items-center gap-1 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            {t("banner.notifyUrlTitle")}
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
            {notifyProblems.map((item) => (
              <li key={item.key}>
                <span className="font-medium text-foreground">
                  {item.channelLabel}
                </span>
                {": "}
                {t(`status.notifyUrlProblem.${item.problem}`)}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-muted-foreground">
            {t("banner.notifyUrlDetail")}
          </p>
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
            form={form}
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
              form={form}
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

      {/* ④ 查单自检 —— 贴一个订单号,当场问支付宝「这单到底付了没」 */}
      <section className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Search className="h-4 w-4 text-sky-600" />
          {t("reconcile.title")}
        </h3>
        <p className="text-xs text-muted-foreground">{t("reconcile.help")}</p>

        <ReconcilePanel
          orderNo={reconcileOrderNo}
          onOrderNoChange={setReconcileOrderNo}
          onCheck={() => void onReconcile()}
          isChecking={isReconciling}
          result={reconcile}
        />
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

      {/* 通知地址 —— 平台推过来的那个地址 */}
      {/* */}
      {/* 配错了 = 钱付了、订单永远不标已付,而且**没有任何报错** */}
      {/* */}
      {/* ⇒ 这一块要能一眼看出「平台推不推得到」 */}
      <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
        <p className="text-[11px] text-muted-foreground">
          {t("status.notifyUrl")}
        </p>
        <p className="mt-0.5 break-all font-medium">
          {channel.notifyUrl ?? (
            <span className="text-destructive">
              {t("status.notifyUrlMissing")}
            </span>
          )}
        </p>

        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("status.notifyUrlSource")}:{" "}
          {channel.notifyUrlSource === "explicit"
            ? t("status.notifyUrlSourceExplicit")
            : channel.notifyUrlSource === "site"
              ? t("status.notifyUrlSourceSite")
              : t("status.notifyUrlSourceNone")}
          {" · "}
          {t("status.siteUrl")}: {channel.siteUrl ?? "—"}
        </p>

        {channel.notifyUrlProblems.length > 0 ? (
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-destructive">
            {channel.notifyUrlProblems.map((problem) => (
              <li key={problem}>{t(`status.notifyUrlProblem.${problem}`)}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-emerald-700">{t("status.notifyUrlOk")}</p>
        )}
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

      {/* 密钥体检 —— 贴错了密钥 = 支付**直接失败**(不是「重试一下」能解决的) */}
      {channel.keyIssues.length > 0 ? (
        <div className="mb-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium text-amber-800">{t("status.keyHealth")}</p>
          <p className="mt-0.5 text-muted-foreground">
            {t("status.keyHealthDetail")}
          </p>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5">
            {channel.keyIssues.map((issue) => (
              <li key={issue.key}>
                <span className="font-medium">{t(`fields.${issue.key}`)}</span>
                <span className="ml-1">
                  {t(`status.keyProblem.${issue.problem}`)}
                </span>
                <span className="ml-1 text-muted-foreground">
                  {issue.usable
                    ? t(`status.keyFix.${issue.fix}`)
                    : t("status.keyUnusable")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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
  form,
}: {
  channelKey: "wechatSandboxEnabled" | "alipaySandboxEnabled";
  title: string;
  help: string;
  fields: AdminPaymentFieldView[];
  disabled: boolean;
  onDelete: (key: PaymentSettingKey) => void;
  isRemoving: boolean;
  form: FormInstance<PaymentSettingsFormValues>;
}) {
  const t = useTranslations("AdminPaymentSettings");

  /**
   * 沙箱字段**只在开关拨到「开」的时候才出现**
   *
   * 工作室 2026-11-14 的原话:**「开启后才展示沙箱字段内容,而不是全部直接
   * 展示」**;「关闭后不展示」。
   *
   * 为什么要藏 —— 开关关着 = 这个通道走**正式模式**(环境变量那套凭据)。
   * 那一档一个沙箱字段都用不上,摆一屏输入框在那儿只会让人以为「这些要填」,
   * 或者把沙箱的私钥填进正式那套配置里。**关着 = 那些字段压根不存在。**
   *
   * **藏起来不会丢数据** —— 表单里没有的键,服务端拿到的是 `undefined`,
   * `adminSavePaymentSettingsAction` 那句 `if (raw === undefined) continue;`
   * 直接跳过 ⇒ **DB 里那行沙箱配置一个字都不动**(下次拨到「开」还在)。
   *
   * 判定本身是纯函数(`shouldShowSandboxFields`)—— 视图只负责接线。
   */
  const sandboxOn = shouldShowSandboxFields(Form.useWatch(channelKey, form));

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

      {sandboxOn ? (
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
                    <span className="text-amber-700">
                      {t("form.secretHint")}
                    </span>
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
      ) : (
        <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t("form.productionOnly")}
        </p>
      )}
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

/* -------------------------------------------------------------------------- */
/*  查单自检面板                                                                */
/* -------------------------------------------------------------------------- */

/**
 * 「贴一个订单号,当场问支付宝这单到底付了没」
 *
 * ## 为什么要把**原始事实**摆出来
 *
 * 线上真踩过(`SO-20261114-137332`):支付宝那边**已经付款成功**,我们这边因为
 * **验签那一步没过**(`signature_invalid`)核不上 ⇒ 订单永远是 `unpaid` ⇒
 * 买家以为没付、**再付一次**(点「重新支付」跳到支付宝,支付宝回一句
 * `TRADE_HAS_SUCCESS` —— 一个死循环:点一次跳一次,每一跳都是那句
 * 「该订单已付款」)。
 *
 * 那条链路上**什么日志都没有** ⇒ 工作室只能靠猜。
 *
 * ⇒ 这一块摆三样东西:
 *
 * 1. **本地状态** —— 我们这边记的是什么
 * 2. **结论** —— 查单判定层给的码(`paid` / `reportedPaid` / `settled`)
 * 3. **每一套凭据的原始事实** —— 打了哪个网关、支付宝回了什么、**签名验过没有**
 *
 * 第 3 条是关键:`verified === false` ⇒ **签名没验过**(多半是公钥贴错了 ——
 * 但也可能是我们拼错了待签字符串,见 `alipay/response-sign.ts`)。
 *
 * ## 为什么**不弹窗**
 *
 * 工作室的口味 —— 配置界面在页面上直接处理(跟打印定价 / 优惠码 / 站点设置
 * 后台一个路子)。
 */
function ReconcilePanel({
  orderNo,
  onOrderNoChange,
  onCheck,
  isChecking,
  result,
}: {
  orderNo: string;
  onOrderNoChange: (value: string) => void;
  onCheck: () => void;
  isChecking: boolean;
  result: AdminPaymentReconcileResult | undefined;
}) {
  const t = useTranslations("AdminPaymentSettings");

  const paid = result?.ok === true ? result.paid : false;
  const reportedPaid = result?.ok === true ? result.reportedPaid : false;
  const settled = result?.ok === true ? result.settled : false;

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="min-w-[240px] flex-1"
          size="small"
          placeholder={t("reconcile.orderNoPlaceholder")}
          value={orderNo}
          onChange={(e) => onOrderNoChange(e.target.value)}
          onPressEnter={onCheck}
        />
        <Button
          size="small"
          type="primary"
          icon={<Search className="h-3.5 w-3.5" />}
          loading={isChecking}
          onClick={onCheck}
        >
          {isChecking ? t("reconcile.checking") : t("reconcile.check")}
        </Button>
      </div>

      {result?.ok ? (
        <div className="mt-4 space-y-3 text-xs">
          {/* ① 本地状态 —— 我们这边记的是什么 */}
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="mb-2 text-[11px] font-medium text-muted-foreground">
              {t("reconcile.localTitle")}
            </p>
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <ReconcileFact
                label={t("reconcile.localStatus")}
                value={result.localStatus}
              />
              <ReconcileFact
                label={t("reconcile.localPaymentStatus")}
                value={result.localPaymentStatus}
              />
              <ReconcileFact
                label={t("reconcile.localChannel")}
                value={result.localPaymentChannel}
              />
              <ReconcileFact
                label={t("reconcile.localTotal")}
                value={formatCents(result.totalCents)}
              />
            </div>
          </div>

          {/* ② 结论 */}
          <div
            className={
              reportedPaid && !paid
                ? "rounded-md border border-destructive/40 bg-destructive/5 p-3"
                : "rounded-md border bg-muted/30 p-3"
            }
          >
            <p className="mb-2 text-[11px] font-medium text-muted-foreground">
              {t("reconcile.verdictTitle")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Tag color="default">{result.code}</Tag>
              {paid ? <Tag color="green">{t("reconcile.paidTag")}</Tag> : null}
              {reportedPaid && !paid ? (
                <Tag color="red">{t("reconcile.reportedPaidTag")}</Tag>
              ) : null}
              {settled ? (
                <Tag color="green">{t("reconcile.settledTag")}</Tag>
              ) : null}
              <ReconcileFact
                label={t("reconcile.tradeNoLabel")}
                value={result.tradeNo}
              />
            </div>
            <p className="mt-2 leading-relaxed">{result.message}</p>
            <p className="mt-1 text-muted-foreground">
              {t(`reconcile.code.${result.code}`)}
            </p>
          </div>

          {/* ③ 每一套凭据的原始事实 —— 诊断的关键就在这儿 */}
          {result.attempts.length > 0 ? (
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                {t("reconcile.attemptsTitle")}
              </p>
              <div className="space-y-2">
                {result.attempts.map((attempt, index) => (
                  <div
                    key={`${attempt.gateway}-${index}`}
                    className="rounded-md border bg-background p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag color={attempt.sandbox ? "orange" : "red"}>
                        {attempt.sandbox
                          ? t("reconcile.attemptSandbox")
                          : t("reconcile.attemptProduction")}
                      </Tag>
                      {/* 验签没通过 —— 这条最要紧(不一定是公钥的错) */}
                      <Tag color={attempt.verified ? "green" : "red"}>
                        {attempt.verified
                          ? t("reconcile.verifiedOk")
                          : t("reconcile.verifiedBad")}
                      </Tag>
                      <Tag color={attempt.ok ? "green" : "default"}>
                        {attempt.ok
                          ? t("reconcile.okYes")
                          : t("reconcile.okNo")}
                      </Tag>
                    </div>
                    <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                      <ReconcileFact
                        label={t("reconcile.gatewayLabel")}
                        value={attempt.gateway}
                      />
                      <ReconcileFact
                        label={t("reconcile.codeLabel")}
                        value={attempt.code}
                      />
                      <ReconcileFact
                        label={t("reconcile.subCodeLabel")}
                        value={attempt.subCode}
                      />
                      <ReconcileFact
                        label={t("reconcile.tradeStatusLabel")}
                        value={attempt.tradeStatus}
                      />
                      <ReconcileFact
                        label={t("reconcile.totalAmountLabel")}
                        value={attempt.totalAmount}
                      />
                      <ReconcileFact
                        label={t("reconcile.tradeNoLabel")}
                        value={attempt.tradeNo}
                      />
                      <ReconcileFact
                        label={t("reconcile.messageLabel")}
                        value={attempt.message}
                      />
                      <ReconcileFact
                        label={t("reconcile.errorLabel")}
                        value={attempt.error}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 一行「标签 + 值」—— 值是空的就**整行不摆**(别摆一个空标签) */
function ReconcileFact({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex min-w-0 gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all font-mono text-[11px]">{value}</span>
    </div>
  );
}
