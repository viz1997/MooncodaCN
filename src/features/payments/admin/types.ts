/**
 * 支付设置后台的**视图模型** + 错误码
 *
 * ## 为什么类型不写在 `"use server"` 文件里
 *
 * `"use server"` 文件的**每一个导出**都会被 Turbopack 注册成一个 server
 * action —— 包括**类型**。运行时去引用一个不存在的类型绑定 ⇒
 * `ReferenceError` ⇒ **整个页面 500**(见
 * `src/test/repo/pure/use-server-exports.test.ts`)。
 *
 * ⇒ 类型放这个单独的文件,`actions.ts` 只 import 它。
 *
 * ## 密钥**不进**这个视图模型
 *
 * 后台那一页是**客户端组件** —— 它拿到的所有东西都要经过浏览器的 JSON。
 * ⇒ 密钥的原文**永远不出现**在这里:
 *
 * - 密钥字段只给 `masked`(「已配置(…abcd)」/「已配置(RSA PRIVATE KEY)」)
 * - 非密钥字段才给 `value`(拿来预填表单)
 *
 * `sandbox-store.ts` 里的 `PaymentModeStatus.values` 已经按这个口径过滤过了
 * —— 这一层只是**再筛一遍**,别把生产环境变量的原文发到浏览器。
 */

import type { NotifyUrlProblem, NotifyUrlSource } from "../lib/notify-url";
import type {
  PaymentKeyIssue,
  PaymentRuntimeMode,
  PaymentSettingKey,
  SandboxChannel,
} from "../lib/sandbox";
import type { AlipayQueryAttempt } from "../providers/alipay/reconcile";
import type { AlipayReconcileCode } from "../providers/alipay/reconcile-rules";

/**
 * 一个凭据字段的展示信息
 *
 * `key` / `label` / `envVar` 全部来自 `sandbox.ts` 的 `FieldGroup` ——
 * **表单照着它渲染**,不另写一份清单(少一个能漂掉的地方)。
 */
export interface AdminPaymentFieldView {
  /**
   * DB 里的键(表单字段名也是它)
   *
   * **类型收紧成 `PaymentSettingKey`** —— 键名表是接口,写错一个字母编译器
   * 就该拦下来(后台那一页按 `key` 读写,键名漂了就是写到没人认领的行上)。
   */
  key: PaymentSettingKey;
  /** 中文标签 */
  label: string;
  /** 正式模式下的环境变量名 —— 只用来显示,不参与取值 */
  envVar: string;
  /** 是不是密钥(不该明文回到浏览器) */
  secret: boolean;
  /** 是不是多行(PEM) */
  multiline: boolean;
  /** 是不是 PEM(存进 DB 之前会规范化换行) */
  pem: boolean;
  /** 是不是可选的(留空就走默认值) */
  optional: boolean;
  /** 掩码后的当前值 —— `null` = 没配过 */
  masked: string | null;
  /** 当前值 —— **只有非密钥字段才有这一项** */
  value: string;
}

/**
 * 一个通道在**某个模式**下的状态
 */
export interface AdminPaymentModeView {
  /** 这个状态说的是哪个模式 */
  mode: PaymentRuntimeMode;
  /** 确切端点 —— `null` = 解析失败了(看 `endpointMessage`) */
  endpoint: string | null;
  /** 端点解析失败的码 */
  endpointError: string | null;
  /** 端点解析失败的人话 */
  endpointMessage: string | null;
  /** 缺的下单字段 */
  missing: AdminPaymentFieldView[];
  /** 缺的验签字段(不影响下单,但收不到通知) */
  missingVerify: AdminPaymentFieldView[];
  /** 能不能收钱 */
  canTransact: boolean;
  /** 是不是完全配好了(能下单 **且** 验得了签) */
  configured: boolean;
  /** 每个字段**掩码后**的值 —— 密钥只给「已配置(…abcd)」这种 */
  masked: Record<string, string | null>;
  /**
   * **不是密钥**的字段的当前值 —— 拿来预填表单
   *
   * ⚠️ **正式模式这一份是空的** —— 生产环境变量的原文**不发到浏览器**。
   * 正式那一档只需要「配好了没 / 缺哪几个 / 掩码」这些信息。
   */
  values: Record<string, string>;
  /**
   * 密钥字段的**体检结果** —— 哪一栏贴错了 / 缺头尾行 / 标签不对
   *
   * **只带诊断,不带密钥本身** —— 密钥的原文永远不进 props。
   */
  keyIssues: PaymentKeyIssue[];
  /**
   * 这个模式下的**生效通知地址** —— `null` = 拼不出来
   *
   * 通知地址配错 = **钱付了、订单永远是 `unpaid`**,而且**没有任何报错**
   * (线上真踩过:`SO-20261114-657E4A`)。⇒ 后台要一眼看出它对不对。
   */
  notifyUrl: string | null;
  /** 通知地址是从哪儿来的(显式配的 / 用站点地址拼的 / 拼不出来) */
  notifyUrlSource: NotifyUrlSource;
  /** 通知地址的问题 —— **空数组 = 没问题** */
  notifyUrlProblems: NotifyUrlProblem[];
}

/**
 * 一个通道的完整状态(两个模式都摆出来)
 */
export interface AdminPaymentChannelView {
  /** 哪个通道 */
  channel: SandboxChannel;
  /** 当前生效的模式 */
  mode: PaymentRuntimeMode;
  /**
   * 开关存的值**认不出来** ⇒ 这个通道选不了
   *
   * **不猜** —— 「默默当正式」= 真收钱,「默默当沙箱」= 白测一次。
   */
  modeInvalid: boolean;
  /** 开关存着的原始值(界面要显示「你存的是这个,认不出来」) */
  modeRaw: string | null;
  /** 当前模式能不能收钱 */
  canTransact: boolean;
  /** 当前模式是不是完全配好了 */
  configured: boolean;
  /** 当前模式的端点 */
  endpoint: string | null;
  /** 当前模式的端点解析失败的码 */
  endpointError: string | null;
  /** 当前模式的端点解析失败的人话 */
  endpointMessage: string | null;
  /** 当前模式缺的下单字段 */
  missing: AdminPaymentFieldView[];
  /** 当前模式缺的验签字段 */
  missingVerify: AdminPaymentFieldView[];
  /**
   * 当前模式的**密钥体检结果** —— 哪一栏贴错了 / 缺头尾行 / 标签不对
   *
   * **只带诊断,不带密钥本身** —— 密钥的原文永远不进 props。
   */
  keyIssues: PaymentKeyIssue[];
  /**
   * **当前模式**的生效通知地址 —— `null` = 拼不出来
   *
   * 后台那一页最要紧的一行字:**通知地址配错 = 钱付了、订单永远不标已付**,
   * 而且没有任何报错。工作室要能一眼看出「这个地址平台推不到」。
   */
  notifyUrl: string | null;
  /** 当前模式的通知地址是从哪儿来的 */
  notifyUrlSource: NotifyUrlSource;
  /** 当前模式的通知地址有哪些问题 —— **空数组 = 没问题** */
  notifyUrlProblems: NotifyUrlProblem[];
  /**
   * 站点地址 —— 拼通知地址用的那个
   *
   * ⚠️ **生产环境如果还是 `http://localhost:3000`,通知地址就是推不到的** ——
   * 这正是「钱付了、订单不动」最常见的一个原因。
   */
  siteUrl: string | null;
  /** 沙箱那一档的状态 */
  sandbox: AdminPaymentModeView;
  /** 正式那一档的状态 */
  production: AdminPaymentModeView;
  /**
   * 沙箱凭据跟正式凭据**同值**的字段 —— 大概率贴错了
   *
   * 只是**提醒**,不是硬闸(极少数情况下两边真的一样)。
   */
  sameCredential: AdminPaymentFieldView[];
  /**
   * 这个通道的**全部字段** —— 表单照着它渲染
   *
   * 顺序 = `required` → 验签材料 → 设置。
   */
  fields: AdminPaymentFieldView[];
}

/** 后台那一页看到的全部东西 */
export interface AdminPaymentSettingsView {
  wechat: AdminPaymentChannelView;
  alipay: AdminPaymentChannelView;
  /** 读挂了 —— 人话(表还没建 / 连不上) */
  readError: string | null;
  /** 表还没建(迁移脚本没跑) */
  missingRelation: boolean;
}

/* -------------------------------------------------------------------------- */
/*  错误码                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 后台这一页的错误码
 *
 * **每个码都要有中英文文案** —— 界面按 code 查文案表,查不到才退回笼统那句。
 */
export type AdminPaymentSettingErrorCode =
  /** 参数不合法 */
  | "INVALID_INPUT"
  /** 表还没建(迁移脚本没跑) */
  | "MIGRATION_MISSING"
  /** 读支付设置失败 */
  | "LOAD_FAILED"
  /** 写支付设置失败 */
  | "SAVE_FAILED"
  /** 删掉某一行失败 */
  | "DELETE_FAILED"
  /** 这个通道没有实现(不可能发生,兜底) */
  | "TEST_CHANNEL_UNSUPPORTED"
  /** 通道压根没配好 —— 重试没用,得先把凭据配上 */
  | "TEST_NOT_CONFIGURED"
  /** 沙箱开关的值认不出来 */
  | "TEST_MODE_INVALID"
  /**
   * 通道现在跑在**正式**模式 —— 这一笔会**真的扣 1 分钱**
   *
   * ⇒ 要跑得再点一次「我确认」。这是**唯一**一个「钱可能真的没了」的码。
   */
  | "TEST_NEEDS_PRODUCTION_CONFIRM"
  /** 通道调用失败(网络 / 上游 / 证书) */
  | "TEST_PROVIDER_FAILED"
  /**
   * 查单自检:这个订单号在库里**查不到**
   *
   * —— 工作室贴错了单号,或者那不是一张商城订单。
   */
  | "RECONCILE_ORDER_NOT_FOUND"
  /**
   * 查单自检:整个调用挂了(网络 / 上游)
   *
   * 「查不成」跟「查出来不是这一档」是两件事 —— 前者是**这次调用挂了**
   * (重试有用),后者是**结论**(重试没用)。
   */
  | "RECONCILE_FAILED";

/** 写操作的结果 —— **不 throw**,throw 会被 next-safe-action 糊成「服务器错误」 */
export type AdminPaymentSettingWriteResult =
  | { ok: true }
  | { ok: false; code: AdminPaymentSettingErrorCode };

/** 跑测试单的结果 */
export interface AdminPaymentTestResult {
  /** 成了没 */
  ok: boolean;
  /** 哪个通道 */
  channel: SandboxChannel;
  /** 用的哪个模式 —— 界面要据此提醒「这笔会不会真扣钱」 */
  mode: PaymentRuntimeMode;
  /** 微信的 `code_url`(扫这个码付) */
  qrCodeUrl: string | null;
  /** 支付宝的**完整跳转地址**(贴到浏览器里就能打开) */
  redirectUrl: string | null;
  /** 失败时的码 */
  code: AdminPaymentSettingErrorCode | null;
  /** 失败时的人话 */
  message: string | null;
}

/* -------------------------------------------------------------------------- */
/*  查单自检                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 一次查单尝试的**原始事实** —— 给工作室看的
 *
 * 直接用 provider 那一份(`AlipayQueryAttempt`)**类型别名**,不另写一份 ——
 * 两份形状迟早漂(线上真踩过:通知那一腿和查单那一腿**用同一个支付宝公钥**,
 * 贴错了两条腿一起断)。
 *
 * ⚠️ **不含任何密钥** —— 只有网关地址和支付宝回的那些字段。
 */
export type AdminPaymentReconcileAttempt = AlipayQueryAttempt;

/**
 * 查单自检的结果
 *
 * ## 为什么「查出来不是这一档」也算 `ok: true`
 *
 * 这一页要做的是**诊断**,不是「跑通 / 没跑通」——
 *
 * - 查出来「不是付款成功」= **一个结论**(用户还没付完)⇒ `ok: true`
 * - 查出来「签名验不过」= **一个结论**(公钥贴错了)⇒ `ok: true`
 * - 订单号不存在 / 调用整个挂了 = **这次调用没成** ⇒ `ok: false`
 *
 * ⇒ 界面照着 `code` 摆不同的话,别把「没查成」和「查了,结论是不行」混成一句。
 */
export type AdminPaymentReconcileResult =
  | {
      ok: true;
      /** 订单号(回显,免得工作室看错是哪一张) */
      orderNo: string;
      /** 本地订单状态(`unpaid` / `paid` / `fulfilled` / …) */
      localStatus: string;
      /** 本地支付状态(`unpaid` / `paid` / `refunded`) */
      localPaymentStatus: string;
      /** 本地记的支付通道 */
      localPaymentChannel: string | null;
      /** 订单应付(分)—— 拿来跟支付宝记的实付对 */
      totalCents: number;
      /** 查单结论码 */
      code: AlipayReconcileCode | "skipped";
      /** 查单结论的人话 */
      message: string;
      /** 「我们核对过这笔已经付成功了」(验签过了 + 金额对得上) */
      paid: boolean;
      /** 「支付宝那边**说**这笔已经付款成功了」(可能我们核对不上) */
      reportedPaid: boolean;
      /** 有没有真的落库(把订单标成已支付) */
      settled: boolean;
      /** 支付宝的订单号 —— 工作室拿去支付宝后台对 */
      tradeNo: string | null;
      /** 每一套凭据的原始事实 */
      attempts: AdminPaymentReconcileAttempt[];
    }
  | { ok: false; code: AdminPaymentSettingErrorCode };
