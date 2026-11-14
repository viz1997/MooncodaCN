#!/usr/bin/env -S npx tsx

/**
 * 支付通道自检 —— `pnpm payment:check-sandbox`
 *
 * 工作室 2026-11-13 的要求:**「支付宝、微信支付先用沙盒测试验证」**。
 *
 * ## 这个脚本干什么
 *
 * 1. **打印横幅** —— 沙箱 / 正式。正式模式是**红字**「会真的扣钱」。
 * 2. **逐个通道列变量** —— 配没配 / 掩码 / 缺哪几个。
 * 3. **打印解析出来的确切端点** —— 微信连 path 一起打(path **是签名的一部分**)。
 * 4. **微信路径探针** —— 两个候选 path 各发一次**真实签名**的真实请求,靠
 *    返回码区分路径对不对,最后给一行**可以直接贴进后台**的建议值。
 * 5. **建一笔 ¥0.01 的沙盒单** —— 走**生产的同一条代码路径**,打印微信的
 *    `code_url` 和支付宝的完整跳转地址。
 * 6. **退出码** —— 全绿 0,有红 1。
 *
 * ## 脚本里绝不重新实现签名 / 拼 URL
 *
 * 签名、端点解析、字段清单、订单号**全部 import 生产模块**。
 * 另写一份等于「探针通了但生产签名是错的」—— 那种错要等到真收钱那天才炸。
 *
 * | 要的 | 从哪儿来 |
 * |---|---|
 * | 端点解析 | `@/features/payments/lib/sandbox` |
 * | 微信签名 + 发请求 | `@/features/payments/providers/wechat/native` |
 * | 微信下单参数 | `@/features/payments/providers/wechat/env` |
 * | 通道(建支付会话) | `@/features/payments/lib/registry` |
 * | 1 分钱的自检单 | `@/features/payments/lib/test-order` |
 *
 * ## dotenv 必须第一个 import
 *
 * `src/db/index.ts` 在模块顶层就查 `DATABASE_URL` —— 静态 import 会先把它
 * 求值完 ⇒ `import "./lib/load-env"` **必须排 import 列表第一个**,
 * `import "./lib/require-database-url"` 排第二个(缺 DATABASE_URL 时说人话)。
 *
 * ## 退出码
 *
 * - `0` —— 两个通道都全绿(只有黄灯也算绿:正式模式下没加 `--allow-production`,
 *   测试单被跳过了)。
 * - `1` —— 有红:模式认不出来 / 端点解析失败 / 缺下单字段 / 探针没找到可用
 *   路径 / 测试单失败。
 */

import "./lib/load-env";
import "./lib/require-database-url";

import type { PemFix, PemProblem } from "@/features/payments/lib/pem";
import { getPaymentProvider } from "@/features/payments/lib/registry";
import {
  ALIPAY_REQUIREMENTS,
  ALIPAY_SANDBOX_GATEWAY_LEGACY,
  allChannelFields,
  type ChannelRequirements,
  type FieldGroup,
  PAYMENT_SETTING_KEYS,
  type PaymentRuntimeMode,
  resolveWechatEndpointParts,
  type SandboxChannel,
  WECHAT_REQUIREMENTS,
  WECHAT_SANDBOX_NATIVE_PATH,
  WECHAT_SANDBOX_NATIVE_PATH_ALT,
} from "@/features/payments/lib/sandbox";
import {
  getPaymentChannelRawValues,
  getPaymentSettingsOverview,
  type PaymentChannelRawValues,
  type PaymentChannelRuntime,
  type PaymentModeStatus,
} from "@/features/payments/lib/sandbox-store";
import { buildTestPaymentRequest } from "@/features/payments/lib/test-order";
import { PaymentNotConfiguredError } from "@/features/payments/lib/types";
import { readAlipaySiteUrl } from "@/features/payments/providers/alipay/env";
import {
  buildWechatNativeParams,
  readWechatSiteUrl,
  WECHAT_PAY_NOTIFY_PATH,
  type WechatNativeParams,
} from "@/features/payments/providers/wechat/env";
import {
  postNativeOrderRequest,
  type WechatNativeOrderResponse,
} from "@/features/payments/providers/wechat/native";

/* -------------------------------------------------------------------------- */
/*  输出                                                                        */
/* -------------------------------------------------------------------------- */

const useColor = Boolean(process.stdout.isTTY);

const ANSI = {
  reset: "[0m",
  red: "[31m",
  green: "[32m",
  yellow: "[33m",
  cyan: "[36m",
  gray: "[90m",
  bold: "[1m",
} as const;

type ColorKey = keyof typeof ANSI;

function paint(color: ColorKey, text: string): string {
  return useColor ? `${ANSI[color]}${text}${ANSI.reset}` : text;
}

const red = (text: string) => paint("red", text);
const green = (text: string) => paint("green", text);
const yellow = (text: string) => paint("yellow", text);
const cyan = (text: string) => paint("cyan", text);
const gray = (text: string) => paint("gray", text);
const bold = (text: string) => paint("bold", text);

/**
 * 显示宽度 —— **中文算两格**
 *
 * 对齐要按「眼睛看到的宽度」算,不是按字符个数 —— 否则中文标签那一列参差不齐。
 */
function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      code >= 0x1100 &&
      (code <= 0x115f ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6));
    width += wide ? 2 : 1;
  }
  return width;
}

/** 按显示宽度补空格 */
function pad(text: string, width: number): string {
  const diff = width - displayWidth(text);
  return diff > 0 ? `${text}${" ".repeat(diff)}` : text;
}

/** 一条小节标题 */
function section(title: string): void {
  const head = `── ${title} `;
  const width = Math.max(4, 62 - displayWidth(head));
  console.log("");
  console.log(cyan(head + "─".repeat(width)));
}

/** 缩进的一行 */
function say(text: string): void {
  console.log(`   ${text}`);
}

/* -------------------------------------------------------------------------- */
/*  字段                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * 一个字段的显示状态
 *
 * **密钥**显示掩码(「已配置(RSA PRIVATE KEY)」/「已配置(…abcd)」)——
 * 原文一个字都不打。**非密钥**显示原值(端点路径、通知地址这类,掩码了
 * 就没意义了)。
 */
function fieldState(
  field: FieldGroup,
  status: PaymentModeStatus
): { filled: boolean; display: string } {
  if (field.secret) {
    const masked = status.masked[field.key] ?? null;
    return { filled: masked !== null, display: masked ?? "没配" };
  }
  const raw = (status.values[field.key] ?? "").trim();
  return { filled: raw !== "", display: raw === "" ? "没配" : raw };
}

/**
 * 一个字段的**显示标签**
 *
 * 正式模式下,「沙箱 API 根地址」「沙箱 Native 下单路径」这两个字段摆的是
 * **正式端点**(生产环境变量的原文 / 写死的正式常量)—— 标签还写着「沙箱」
 * 会误导:工作室可能把 `/v3/pay/transactions/native` 抄进后台的沙箱 path 里。
 *
 * ⇒ 正式模式下把「沙箱 」前缀换成「(正式)」。
 */
function displayLabel(field: FieldGroup, mode: PaymentRuntimeMode): string {
  if (mode !== "production") return field.label;
  if (!field.label.startsWith("沙箱 ")) return field.label;
  return `${field.label.slice("沙箱 ".length)}(正式)`;
}

/** 打印一个通道的全部字段 */
function printFields(
  requirements: ChannelRequirements,
  status: PaymentModeStatus,
  mode: PaymentRuntimeMode
): void {
  for (const field of allChannelFields(requirements)) {
    const { filled, display } = fieldState(field, status);
    const mark = filled ? green("✔") : red("✘");
    say(`${mark} ${pad(displayLabel(field, mode), 26)} ${display}`);
  }
}

/** 一组字段的标签 */
function labels(fields: FieldGroup[]): string {
  return fields.map((field) => field.label).join("、");
}

/* -------------------------------------------------------------------------- */
/*  密钥体检                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 密钥的问题 —— 中文说法
 *
 * 跟后台那一页(`AdminPaymentSettings.status.keyProblem.*`)是同一套口径 ——
 * 两边各写一份的话,工作室在后台看到一句、自检脚本看到另一句,又得猜。
 */
function keyProblemLabel(problem: PemProblem): string {
  switch (problem) {
    case "public-key":
      return "贴的是公钥 —— 这一栏要私钥";
    case "private-key":
      return "贴的是私钥 —— 这一栏要公钥";
    case "no-header":
      return "缺 PEM 头尾两行(BEGIN / END)";
    case "mislabeled":
      return "PEM 标签跟内容对不上";
    case "unparseable":
      return "解析不了 —— 不是一把能用的 PEM";
    default:
      return "没问题";
  }
}

/** 做了什么修复 —— 中文说法 */
function keyFixLabel(fix: PemFix): string {
  switch (fix) {
    case "wrapped":
      return "已自动补上头尾行";
    case "relabeled":
      return "已自动改正标签";
    default:
      return "没修";
  }
}

/* -------------------------------------------------------------------------- */
/*  微信路径探针                                                                */
/* -------------------------------------------------------------------------- */

/** 探针的结论 */
type ProbeVerdict =
  /** 路径对了 —— 单子建出来了 */
  | "path-ok"
  /** 路径存在,但卡在参数 */
  | "params"
  /** 路径大概存在,但卡在验签 / 鉴权 */
  | "auth"
  /** 路径不存在 */
  | "missing"
  /** 上游自己的错 —— 不是路径的问题 */
  | "server"
  /** 网络层就挂了 */
  | "network";

interface ProbeResult {
  path: string;
  endpoint: string;
  status: number;
  code: string | null;
  verdict: ProbeVerdict;
  detail: string;
}

/**
 * 靠**返回码**判断路径对不对
 *
 * 微信的错误体里只有 `code` / `message`,**没有 HTTP 状态** ⇒ 光看 `code`
 * 分不出「404 了」和「400 了」。⇒ 必须看状态码。
 *
 * | 状态 | 意思 |
 * |---|---|
 * | `200` + `code_url` | 路径对了 |
 * | `400` | 路径对了,卡在参数 |
 * | `401` / `403` | 路径大概对了,卡在验签 |
 * | `404` | **路径不存在** ⇒ 换下一个候选 |
 */
function classifyProbe(res: WechatNativeOrderResponse): {
  verdict: ProbeVerdict;
  detail: string;
} {
  if (res.status === 0) {
    return {
      verdict: "network",
      detail: res.message ?? "网络层就挂了(没拿到 HTTP 响应)",
    };
  }
  if (res.status === 200) {
    return res.codeUrl
      ? { verdict: "path-ok", detail: "路径对了 —— 单子建出来了" }
      : { verdict: "params", detail: "路径对了,但响应里没有 code_url" };
  }
  if (res.status === 400) {
    return {
      verdict: "params",
      detail: `路径对了,卡在参数(${res.code ?? "PARAM_ERROR"})`,
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      verdict: "auth",
      detail: `路径大概对了,卡在验签 / 鉴权(${res.code ?? String(res.status)})`,
    };
  }
  if (res.status === 404) {
    return { verdict: "missing", detail: "路径不存在(404)—— 换下一个候选" };
  }
  return {
    verdict: "server",
    detail: `上游 ${res.status}(${res.code ?? "未知"})—— 不是路径的问题`,
  };
}

/**
 * 候选路径 —— **先去后台配的那个**,再两个内置的
 *
 * 后台配的那个排第一:工作室可能已经试出来一个能用的了,不该每次都从头探。
 */
function probeCandidates(configuredPath: string | null): string[] {
  const list: string[] = [];
  const push = (value: string | null | undefined): void => {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return;
    if (!list.includes(trimmed)) list.push(trimmed);
  };
  push(configuredPath);
  push(WECHAT_SANDBOX_NATIVE_PATH);
  push(WECHAT_SANDBOX_NATIVE_PATH_ALT);
  return list;
}

/**
 * 探针的候选里,哪些**说明路径是存在的**
 *
 * `200` / `400` / `401` / `403` 都只可能来自一个**存在的**接口(不存在的
 * 路径一律 404)。⇒ 这几种都能确认路径没填错。
 */
function confirmsPath(verdict: ProbeVerdict): boolean {
  return verdict === "path-ok" || verdict === "params" || verdict === "auth";
}

/* -------------------------------------------------------------------------- */
/*  通道检查                                                                    */
/* -------------------------------------------------------------------------- */

interface ChannelReport {
  channel: SandboxChannel;
  title: string;
  mode: PaymentRuntimeMode;
  /** 全绿 */
  green: boolean;
  /** 红 —— 这些是「有问题」 */
  problems: string[];
  /** 黄 —— 「注意」但不是错 */
  warnings: string[];
  /** 一句话摘要(给最后的结果表) */
  summary: string;
}

/** 通道的中文名 */
function channelTitle(channel: SandboxChannel): string {
  return channel === "wechat" ? "微信支付" : "支付宝";
}

/**
 * 检查一个通道
 *
 * 打印它的现状 + 探针(微信)+ 测试单,顺带把「有哪些问题」收回来。
 */
async function checkChannel(input: {
  channel: SandboxChannel;
  runtime: PaymentChannelRuntime;
  requirements: ChannelRequirements;
  allowProduction: boolean;
}): Promise<ChannelReport> {
  const { channel, runtime, requirements, allowProduction } = input;
  const title = channelTitle(channel);
  const problems: string[] = [];
  const warnings: string[] = [];

  section(title);

  /* ---- 模式 ---- */
  if (runtime.modeInvalid) {
    say(
      `${red("✘")} 模式认不出来(开关存的是 ${JSON.stringify(
        runtime.modeRaw ?? "空"
      )})—— 只认 true / false`
    );
    problems.push("沙箱开关存的值认不出来");
  } else {
    say(
      `模式 ${bold(runtime.mode === "sandbox" ? "沙箱" : "正式")}  ` +
        gray(
          runtime.mode === "sandbox"
            ? "(凭据来自后台「支付设置」那一页)"
            : "(凭据来自环境变量)"
        )
    );
  }

  /* ---- 端点 ---- */
  if (runtime.endpoint.ok) {
    say(`确切端点 ${runtime.endpoint.endpoint}`);
  } else {
    say(
      `${red("✘")} 端点不合法 ${runtime.endpoint.code} —— ${runtime.endpoint.message}`
    );
    problems.push(`端点不合法(${runtime.endpoint.code})`);
  }

  // 原始值(含密钥)—— 探针要真的私钥才能签名
  const raw = await getPaymentChannelRawValues(channel);

  // 微信:path 要单独打一行 —— **它是签名串的一部分**
  if (channel === "wechat") {
    const parts = resolveWechatEndpointParts({
      mode: runtime.mode,
      sandboxApiBase:
        raw.sandbox[PAYMENT_SETTING_KEYS.wechatSandboxApiBase] ?? null,
      sandboxNativePath:
        raw.sandbox[PAYMENT_SETTING_KEYS.wechatSandboxNativePath] ?? null,
    });
    if (parts.ok) {
      say(
        `签名 path ${bold(parts.nativePath)}  ${gray("(path 是签名的一部分)")}`
      );
    }
  }

  // 支付宝:旧沙箱网关的提醒(新旧沙箱的 APPID **不通用**)
  if (channel === "alipay" && runtime.sandbox.endpoint.ok) {
    const gateway = runtime.sandbox.endpoint.endpoint;
    if (isLegacyAlipaySandbox(gateway)) {
      say(
        `${yellow("⚠")}  你用的是**旧沙箱**网关(${gateway})—— 沙箱 APPID 必须跟它配套,新沙箱的 APPID 在这儿会报 40002`
      );
      warnings.push("支付宝用的是旧沙箱网关(APPID 必须配套)");
    }
  }

  /* ---- 字段 ---- */
  const current =
    runtime.mode === "sandbox" ? runtime.sandbox : runtime.production;
  say("");
  say(gray("当前模式下的字段:"));
  printFields(requirements, current, runtime.mode);

  if (runtime.missing.length > 0) {
    say("");
    say(`${red("✘")} 缺下单字段:${labels(runtime.missing)}`);
    problems.push(`缺下单字段:${labels(runtime.missing)}`);
  }
  if (runtime.missingVerify.length > 0) {
    say(
      `${yellow("⚠")} 缺验签材料:${labels(runtime.missingVerify)}  ${gray("(不影响下单,但收不到通知)")}`
    );
    warnings.push(`缺验签材料:${labels(runtime.missingVerify)}`);
  }

  /* ---- 密钥体检 ---- */
  //
  // 线上真踩过(`SO-20261114-657E4A`):私钥贴错 ⇒ OpenSSL 报的是一句
  // `error:1E08010C:DECODER routines::unsupported` —— **一个字都看不出「你贴错了」**。
  //
  // ⇒ 这里在**发请求之前**就把话说清楚:哪一栏、什么问题、能不能用。
  // 体检结果是**生产模块**算好的(`sandbox-store.ts` 的 `collectKeyIssues`)——
  // 脚本**不重新实现**一遍(另写一份 = 两边迟早漂)。
  if (runtime.keyIssues.length > 0) {
    say("");
    say(gray("密钥体检:"));
    for (const issue of runtime.keyIssues) {
      const verdict = issue.usable
        ? yellow("已自动修好,能用") + gray(`(${keyFixLabel(issue.fix)})`)
        : red("用不了,支付会直接失败");
      say(
        `   ${pad(issue.label, 26)} ${keyProblemLabel(issue.problem)}  ${verdict}`
      );
    }
    const unusable = runtime.keyIssues.filter((issue) => !issue.usable);
    if (unusable.length > 0) {
      problems.push(`密钥用不了:${unusable.map((i) => i.label).join("、")}`);
    } else {
      warnings.push(
        `密钥贴错了(已自动修好):${runtime.keyIssues
          .map((i) => i.label)
          .join("、")}`
      );
    }
  }

  // 另一模式缺什么 —— 工作室「拨开关之前」最想看的就是这个
  const other =
    runtime.mode === "sandbox" ? runtime.production : runtime.sandbox;
  const otherName = runtime.mode === "sandbox" ? "正式" : "沙箱";
  if (other.missing.length > 0) {
    say(gray(`(${otherName}模式缺:${labels(other.missing)})`));
  }

  /* ---- 微信路径探针 ---- */
  if (channel === "wechat" && runtime.mode === "sandbox") {
    if (runtime.missing.length > 0) {
      say("");
      say(gray("路径探针跳过了 —— 下单用的凭据还没配齐,配齐了再跑一次。"));
    } else {
      await probeWechatPaths({ raw, problems, warnings });
    }
  } else if (channel === "wechat") {
    say("");
    say(
      gray("路径探针只对沙箱跑 —— 正式模式的 path 是写死的,没有第二个候选。")
    );
  }

  /* ---- ¥0.01 测试单 ---- */
  const order = await runTestOrder({
    channel,
    runtime,
    allowProduction,
  });

  say("");
  if (order.skipped) {
    say(
      `${yellow("⚠")}  测试单**跳过了** —— 正式模式下这一笔会真的扣 1 分钱,要加 --allow-production 才跑`
    );
    warnings.push("正式模式下没跑测试单(没验过)");
  } else if (order.ok) {
    say(`${green("✔")}  ¥0.01 测试单建单成功`);
    if (order.qrCodeUrl) {
      say(`   二维码内容 ${order.qrCodeUrl}`);
      say(
        gray(
          "   (这不是图片地址 —— 用微信沙箱客户端扫这一串,或者贴到画码组件里)"
        )
      );
    }
    if (order.redirectUrl) {
      say(`   跳转地址 ${order.redirectUrl}`);
      say(gray("   (贴到浏览器里直接打开付)"));
    }
  } else {
    say(`${red("✘")}  ¥0.01 测试单失败:${order.error}`);
    problems.push(`测试单失败:${order.error}`);
  }

  const summary = order.ok
    ? `${runtime.mode} · 测试单通了`
    : order.skipped
      ? `${runtime.mode} · 测试单没跑`
      : `${runtime.mode} · 有问题`;

  return {
    channel,
    title,
    mode: runtime.mode,
    green: problems.length === 0,
    problems,
    warnings,
    summary,
  };
}

/**
 * 微信路径探针
 *
 * 对每个候选 path 发一次**真实签名**的真实请求 —— 签名和 URL 都用生产模块
 * 那一份(`postNativeOrderRequest`),所以「探针通了但生产签名是错的」这种
 * 事不可能发生。
 */
async function probeWechatPaths(input: {
  raw: PaymentChannelRawValues;
  problems: string[];
  warnings: string[];
}): Promise<void> {
  const { raw, problems, warnings } = input;

  section("微信路径探针(沙箱)");

  const sandbox = raw.sandbox;
  const candidates = probeCandidates(
    sandbox[PAYMENT_SETTING_KEYS.wechatSandboxNativePath] ?? null
  );

  const siteUrl = readWechatSiteUrl();
  const notifyUrl =
    (sandbox[PAYMENT_SETTING_KEYS.wechatSandboxNotifyUrl] ?? "").trim() ||
    (siteUrl
      ? `${siteUrl}${WECHAT_PAY_NOTIFY_PATH}`
      : "https://example.com/api/webhooks/wechat");

  let confirmed: ProbeResult | null = null;

  for (const path of candidates) {
    const endpoint = resolveWechatEndpointParts({
      mode: "sandbox",
      sandboxApiBase:
        sandbox[PAYMENT_SETTING_KEYS.wechatSandboxApiBase] ?? null,
      sandboxNativePath: path,
    });
    if (!endpoint.ok) {
      say(
        `${red("✘")} ${pad(path, 42)} 这个路径不合法(${endpoint.code})—— ${endpoint.message}`
      );
      continue;
    }

    let params: WechatNativeParams;
    try {
      params = buildWechatNativeParams({
        mode: "sandbox",
        values: sandbox,
        apiBase: endpoint.apiBase,
        nativePath: endpoint.nativePath,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      say(`${red("✘")} 探针跑不了:${message}`);
      problems.push("探针跑不了(缺下单用的凭据)");
      return;
    }

    const res = await postNativeOrderRequest({
      ...params,
      outTradeNo: buildProbeOrderNo(),
      description: "沙箱自检",
      totalCents: 1,
      notifyUrl,
    });

    const { verdict, detail } = classifyProbe(res);
    const result: ProbeResult = {
      path: endpoint.nativePath,
      endpoint: endpoint.endpoint,
      status: res.status,
      code: res.code,
      verdict,
      detail,
    };

    const mark = verdict === "missing" ? red("✘") : green("✔");
    say(
      `${mark}  ${pad(endpoint.nativePath, 42)} HTTP ${res.status} —— ${detail}`
    );

    if (confirmed === null && confirmsPath(verdict)) {
      confirmed = result;
      break;
    }
  }

  say("");
  if (confirmed) {
    say(
      `${green("建议贴进后台的值")}  ${bold(
        `wechat_sandbox_native_path = ${confirmed.path}`
      )}`
    );
  } else {
    say(
      `${red("两个候选路径都不通")} —— 微信的沙箱 path 没有权威文档,拿这个结果去问微信客服`
    );
    problems.push("两个候选路径都不通");
    warnings.push("微信沙箱 path 需要人工确认");
  }
}

/** 探针用的订单号 —— 每次都不一样(同一个单号微信会回 ORDERPAID) */
function buildProbeOrderNo(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SBX${stamp}${rand}`;
}

/**
 * 是不是**旧沙箱**网关
 *
 * 支付宝有两套沙箱,**APPID 完全不通用** —— 新沙箱的 APPID 打到旧沙箱会报
 * `40002 invalid-app-id`。
 */
function isLegacyAlipaySandbox(gateway: string): boolean {
  try {
    return (
      new URL(gateway).hostname.toLowerCase() ===
      new URL(ALIPAY_SANDBOX_GATEWAY_LEGACY).hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*  测试单                                                                      */
/* -------------------------------------------------------------------------- */

interface TestOrderOutcome {
  ok: boolean;
  /** 正式模式下没加 `--allow-production` ⇒ 跳过 */
  skipped: boolean;
  qrCodeUrl: string | null;
  redirectUrl: string | null;
  error: string | null;
}

/**
 * 建一笔 **¥0.01** 的单子 —— **走生产的同一条代码路径**
 *
 * `provider.createSession()` —— 结算页调的就是它。另写一份「测试实现」
 * 等于什么都没验(签名拼错了照样能跑通)。
 */
async function runTestOrder(input: {
  channel: SandboxChannel;
  runtime: PaymentChannelRuntime;
  allowProduction: boolean;
}): Promise<TestOrderOutcome> {
  const { channel, runtime, allowProduction } = input;

  if (runtime.mode === "production" && !allowProduction) {
    return {
      ok: false,
      skipped: true,
      qrCodeUrl: null,
      redirectUrl: null,
      error: null,
    };
  }

  const provider = getPaymentProvider(channel);
  if (!provider) {
    return {
      ok: false,
      skipped: false,
      qrCodeUrl: null,
      redirectUrl: null,
      error: "这个通道没有实现",
    };
  }

  const siteUrl =
    channel === "wechat" ? readWechatSiteUrl() : readAlipaySiteUrl();

  const request = buildTestPaymentRequest({
    siteUrl,
    note: "命令行自检(payment:check-sandbox)的沙盒单",
  });

  try {
    const session = await provider.createSession(request);
    return {
      ok: true,
      skipped: false,
      qrCodeUrl: session.qrCodeUrl,
      redirectUrl: session.redirectUrl,
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof PaymentNotConfiguredError
        ? `通道没配好:${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      ok: false,
      skipped: false,
      qrCodeUrl: null,
      redirectUrl: null,
      error: message,
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  主流程                                                                      */
/* -------------------------------------------------------------------------- */

function printBanner(): void {
  console.log("");
  console.log(
    bold("════════════════════════════════════════════════════════════")
  );
  console.log(bold(" 支付通道自检(微信 / 支付宝)"));
  console.log(
    bold("════════════════════════════════════════════════════════════")
  );
}

async function main(): Promise<number> {
  const allowProduction = process.argv.includes("--allow-production");

  printBanner();

  const overview = await getPaymentSettingsOverview();
  if (overview.missingRelation) {
    console.log(
      red(" ❌ 支付设置的表还不存在 —— 先跑 pnpm migrate:apply-payment-setting")
    );
  } else if (overview.readError) {
    console.log(red(` ❌ 读支付设置失败:${overview.readError}`));
  }

  const reports: ChannelReport[] = [];
  for (const channel of ["wechat", "alipay"] as const) {
    const runtime = channel === "wechat" ? overview.wechat : overview.alipay;
    const requirements =
      channel === "wechat" ? WECHAT_REQUIREMENTS : ALIPAY_REQUIREMENTS;
    reports.push(
      await checkChannel({ channel, runtime, requirements, allowProduction })
    );
  }

  /* ---- 正式模式的红字横幅 ---- */
  const production = reports.filter((report) => report.mode === "production");
  if (production.length > 0) {
    console.log("");
    console.log(
      red(
        ` ⚠  正式模式 —— 下面的测试单会真的扣钱(${production
          .map((report) => report.title)
          .join("、")})`
      )
    );
  }

  /* ---- 结果 ---- */
  section("结果");
  for (const report of reports) {
    const mark = report.green ? green("✔") : red("✘");
    say(`${mark} ${pad(report.title, 10)} ${report.summary}`);
    for (const problem of report.problems) {
      say(`    ${red("→")} ${problem}`);
    }
    for (const warning of report.warnings) {
      say(`    ${yellow("→")} ${warning}`);
    }
  }

  const broken = reports.filter((report) => !report.green);
  console.log("");
  if (broken.length === 0) {
    console.log(green(" 全绿 ✅"));
    return 0;
  }
  console.log(
    red(
      ` 有 ${broken.length} 个通道有问题 ❌ —— 上面每一行都写了缺什么 / 怎么修`
    )
  );
  return 1;
}

/**
 * 退出
 *
 * stdout 是**管道**时写入是异步的 ⇒ 直接 `process.exit()` 会把最后几行吞掉
 * (微信那个 `code_url` 很长,正好在最后)。⇒ 先等 stdout 排空再退。
 */
function exitWith(code: number): void {
  process.exitCode = code;
  const done = () => process.exit(code);
  if (process.stdout.writableLength === 0) {
    setImmediate(done);
    return;
  }
  process.stdout.once("drain", done);
}

main()
  .then((code) => exitWith(code))
  .catch((error) => {
    console.error(red("❌ 自检脚本自己挂了:"));
    console.error(error);
    exitWith(1);
  });
