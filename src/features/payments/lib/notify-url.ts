/**
 * 通知地址(`notify_url`)的**解析与诊断** —— 纯函数,零 import
 *
 * ## 为什么单独拎出来
 *
 * 线上真踩过:支付宝沙箱那一单**付款成功了**,订单却永远停在 `unpaid`,
 * 用户盯着「正在确认支付…」转圈到超时(单号 `SO-20261114-657E4A`)。
 *
 * 最常见的原因不是代码,是**通知地址配错了** —— 而配错了之后**没有任何报错**:
 *
 * | 配错的方式 | 现象 |
 * |---|---|
 * | 站点地址还是 `http://localhost:3000` | 支付宝/微信的服务器根本推不到 ⇒ **没有任何日志** |
 * | 地址是 `http://` 不是 `https://` | 平台拒收 ⇒ 静默失败 |
 * | 地址少写了 `/api/webhooks/alipay` | 平台推到一个 404 ⇒ 静默失败 |
 *
 * ⇒ 后台「支付设置」那一页要**一眼看出**通知地址有没有问题 —— 这一层就是
 * 那个「一眼」。
 *
 * ## 通知地址从哪儿来(两个通道一个口径)
 *
 * ```
 * 显式配的通知地址  →  用它
 * 站点地址 + 通知路径 →  拼一个
 * 都没有            →  拼不出来(通道判「没配好」)
 * ```
 *
 * 站点地址 = `NEXT_PUBLIC_APP_URL` 或 `BETTER_AUTH_URL`
 * (见 `providers/alipay/env.ts` 的 `readAlipaySiteUrl()`)。
 *
 * ## 为什么诊断逻辑是**纯函数**
 *
 * 这一层要能进 `unit` project 跑单测 —— 不起数据库、不读环境变量。
 * 取值那半边(`actions.ts` / `config.ts`)负责把值喂进来。
 */

/** 通知地址的问题码 */
export type NotifyUrlProblem =
  /** 拼不出通知地址(站点地址没配,也没显式配) */
  | "MISSING"
  /** 不是个合法的 URL */
  | "INVALID_URL"
  /** 不是 https */
  | "NOT_HTTPS"
  /**
   * 指向本机 —— **平台推不到**
   *
   * `localhost` / `127.0.0.1` / `0.0.0.0` / `::1` / `*.local`
   */
  | "LOCAL_ADDRESS";

/** 通知地址是从哪儿来的 */
export type NotifyUrlSource =
  /** 显式配的(DB 里那一行,或正式模式的环境变量) */
  | "explicit"
  /** 用站点地址拼的 */
  | "site"
  /** 拼不出来 */
  | "none";

/** 通知地址的解析结果 */
export interface NotifyUrlDiagnosis {
  /** 生效的通知地址 —— `null` = 拼不出来 */
  notifyUrl: string | null;
  /** 从哪儿来的 */
  source: NotifyUrlSource;
  /** 站点地址 —— 拼通知地址用的那个(`null` = 没配) */
  siteUrl: string | null;
  /** 通知路径(`/api/webhooks/alipay` 那一段) */
  notifyPath: string;
  /**
   * 有哪些问题 —— **空数组 = 没问题**
   *
   * 界面按这个摆黄字 / 红字。
   */
  problems: NotifyUrlProblem[];
  /** 能不能收钱 —— 通知地址这一项上 */
  usable: boolean;
}

/** 去掉尾部斜杠 —— 拼路径时 `//api/...` 会 404 */
function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/** 本机地址的 host —— 平台推不到的那些 */
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

/** 是不是本机地址 */
function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOCAL_HOSTS.has(host)) return true;
  // `.local` 是局域网(mDNS)域名 —— 平台一样推不到
  return host.endsWith(".local") || host.endsWith(".localhost");
}

/**
 * 解析通知地址 + 诊断
 *
 * @param explicitNotifyUrl 显式配的通知地址 —— 空串 / null = 没配
 * @param siteUrl 站点地址 —— 空串 / null = 没配
 * @param notifyPath 通知路径 —— `/api/webhooks/alipay` 那一段
 */
export function resolveNotifyUrl(input: {
  explicitNotifyUrl?: string | null;
  siteUrl?: string | null;
  notifyPath: string;
}): NotifyUrlDiagnosis {
  const siteUrl = (input.siteUrl ?? "").trim();
  const normalizedSite = siteUrl ? stripTrailingSlash(siteUrl) : null;
  const explicit = (input.explicitNotifyUrl ?? "").trim();

  let notifyUrl: string | null;
  let source: NotifyUrlSource;

  if (explicit) {
    notifyUrl = explicit;
    source = "explicit";
  } else if (normalizedSite) {
    notifyUrl = `${normalizedSite}${input.notifyPath}`;
    source = "site";
  } else {
    notifyUrl = null;
    source = "none";
  }

  const problems: NotifyUrlProblem[] = [];

  if (!notifyUrl) {
    problems.push("MISSING");
  } else {
    let parsed: URL;
    try {
      parsed = new URL(notifyUrl);
    } catch {
      problems.push("INVALID_URL");
      parsed = null as unknown as URL;
    }
    if (parsed) {
      if (parsed.protocol !== "https:") {
        problems.push("NOT_HTTPS");
      }
      if (isLocalHost(parsed.hostname)) {
        problems.push("LOCAL_ADDRESS");
      }
    }
  }

  return {
    notifyUrl,
    source,
    siteUrl: normalizedSite,
    notifyPath: input.notifyPath,
    problems,
    usable: problems.length === 0,
  };
}

/**
 * 通知地址的**人话诊断** —— 每个问题一句话
 *
 * 界面按 code 查这张表(中英文各一份)。查不到就退回笼统那句。
 */
export const NOTIFY_URL_PROBLEM_MESSAGES: Record<NotifyUrlProblem, string> = {
  MISSING:
    "拼不出通知地址 —— 请填通知地址,或者配 NEXT_PUBLIC_APP_URL / BETTER_AUTH_URL(支付宝推不到这个地址就收不到钱)",
  INVALID_URL: "通知地址不是一个合法的网址",
  NOT_HTTPS: "通知地址必须是 https —— 平台只接受 https 的回调地址",
  LOCAL_ADDRESS:
    "通知地址指向的是本机 —— 支付宝/微信的服务器推不到,钱付了订单也不会变已付",
};
