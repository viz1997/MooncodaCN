/**
 * PEM 密钥的**体检 + 修复** —— 纯函数(只 import `node:crypto`)
 *
 * ## 为什么需要它
 *
 * 支付宝 / 微信的应用私钥都是从控制台里复制出来的 PEM。复制的时候最容易出的
 * 三种错,在 OpenSSL 那边**报的是同一句话**:
 *
 * | 错法 | 现象 |
 * |---|---|
 * | 只复制了 base64 正文(没有 `BEGIN` / `END` 两行) | `ERR_OSSL_UNSUPPORTED` |
 * | PKCS#1 的正文却标成了 `BEGIN PRIVATE KEY` | 同上 |
 * | 把**公钥**贴进了私钥那一栏 | 同上 |
 *
 * 那句 `error:1E08010C:DECODER routines::unsupported` 一个字都看不出「你贴错了」
 * —— 工作室只能对着一个 OpenSSL 错误码猜(线上真踩过:`SO-20261114-657E4A`)。
 *
 * ⇒ 这里把它拆成三件事:
 *
 * 1. **认出来** —— 贴的是公钥?没头?头尾行的标签跟内容对不上?
 * 2. **修好** —— 能修的当场修(补头、换标签)
 * 3. **分清「配错了」和「这次挂了」** —— 密钥不对是**配置问题**,重试没用
 *    (见 `storefront/lib/payment-issue.ts` 的 `PAYMENT_NOT_CONFIGURED`)
 *
 * ## 「修」不是「猜」
 *
 * 每一个候选 PEM 都要**真的 `createPrivateKey()` 成功**才算数 ⇒ 修不出来就
 * **原样报错**,绝不拿一个「看起来像」的密钥去签名。
 *
 * ## 修好之后,原始那一栏还存着没修的版本
 *
 * 修复只发生在**这一次调用的内存里**。DB 里存的还是工作室贴进来的原文
 * (后台那一栏显示的是原文,不是修好的版本)—— 免得「界面上看着好好的,
 * 存进去的东西却被我们偷偷改过」。
 */

import { createPrivateKey, createPublicKey } from "node:crypto";

/* -------------------------------------------------------------------------- */
/*  规范化                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * 规范化 PEM 文本
 *
 * - 环境变量里一行写不下完整私钥,惯例是把换行写成 `\n` ⇒ 这里还原成真换行
 * - 补上结尾换行 —— PEM 规范要求最后一行带换行,缺了有些解析器会挑食
 *
 * **两个通道的 `normalizePemKey` 现在都委托给这里** —— 以前各写一份,
 * 改了一份忘了另一份,两边的密钥就长得不一样。
 */
export function normalizePemText(raw: string): string {
  const restored = raw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
  return restored.endsWith("\n") ? restored : `${restored}\n`;
}

/* -------------------------------------------------------------------------- */
/*  类型                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 体检结果 —— 问题出在哪儿
 *
 * - `none` —— 没问题
 * - `public-key` —— **私钥**那一栏里贴的是公钥
 * - `private-key` —— **公钥**那一栏里贴的是私钥
 * - `no-header` —— 没有 PEM 头尾两行(只有 base64 正文)
 * - `mislabeled` —— 头尾行的标签跟内容对不上(PKCS#1 的正文标成 `PRIVATE KEY`)
 * - `unparseable` —— 看不出来(多半是复制不全)
 */
export type PemProblem =
  | "none"
  | "public-key"
  | "private-key"
  | "no-header"
  | "mislabeled"
  | "unparseable";

/**
 * 做了什么修复
 *
 * - `none` —— 没修(本来就对)
 * - `wrapped` —— **补了** PEM 头尾两行
 * - `relabeled` —— **换了** PEM 头尾行的标签
 */
export type PemFix = "none" | "wrapped" | "relabeled";

/** 体检结果 */
export interface PemInspection {
  /** 这把密钥能直接用吗 */
  usable: boolean;
  /**
   * **能用的那一版** PEM —— `usable` 为真时非空
   *
   * `usable` 为假时是 `null` ⇒ 调用方**不许**拿它去签名。
   */
  pem: string | null;
  /** 做了什么修复 */
  fix: PemFix;
  /** 问题出在哪儿 */
  problem: PemProblem;
  /** 人话诊断(中文)—— 后台那一栏直接摆它 */
  detail: string;
}

/* -------------------------------------------------------------------------- */
/*  内部工具                                                                   */
/* -------------------------------------------------------------------------- */

/** PEM 头尾行 —— 只认 ASCII 字母数字和空格 */
const BEGIN_RE = /-----BEGIN ([A-Za-z0-9 ]+)-----/;
const END_RE = /-----END ([A-Za-z0-9 ]+)-----/;

/** 一行 base64(允许末尾的 `=` 填充) */
const BASE64_LINE_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * 私钥能用的标签 —— **按尝试顺序**
 *
 * `PRIVATE KEY` = PKCS#8,`RSA PRIVATE KEY` = PKCS#1。
 * 两种都试,谁先解析成功用谁。
 */
const PRIVATE_LABELS = ["PRIVATE KEY", "RSA PRIVATE KEY"] as const;

/**
 * 公钥能用的标签 —— **按尝试顺序**
 *
 * `PUBLIC KEY` = SPKI,`RSA PUBLIC KEY` = PKCS#1,`CERTIFICATE` = X.509
 * 平台证书(微信那套验签材料就是它)。
 */
const PUBLIC_LABELS = ["PUBLIC KEY", "RSA PUBLIC KEY", "CERTIFICATE"] as const;

/**
 * 从 PEM 文本里抽出 base64 **正文**
 *
 * 头尾标记**从行里摘掉**(不是整行扔掉)—— 有的复制方式会让标记跟正文粘在
 * 同一行(`-----BEGIN PRIVATE KEY-----MIIEvQ…`),整行扔掉就什么都读不到了。
 *
 * 「没有头尾」那个错法就是靠这里认出来的。
 */
function extractBody(text: string): string {
  const kept: string[] = [];
  for (const raw of text.split("\n")) {
    // base64 字母表里没有 `-`,所以这个替换**不会**伤到正文
    const line = raw.trim().replace(/-----[A-Za-z0-9 ]+-----/g, "");
    if (!line) continue;
    if (!BASE64_LINE_RE.test(line)) continue;
    kept.push(line);
  }
  return kept.join("");
}

/**
 * 给一段 base64 正文套上 PEM 头尾
 *
 * 64 字符一行 —— PEM 的惯例(不是硬性要求,解析器不看这个)。
 */
function wrapBody(body: string, label: string): string {
  const lines = body.match(/.{1,64}/g) ?? [];
  return [
    `-----BEGIN ${label}-----`,
    ...lines,
    `-----END ${label}-----`,
    "",
  ].join("\n");
}

/** 这一段能当私钥解析吗 */
function parsesAsPrivateKey(pem: string): boolean {
  try {
    createPrivateKey(pem);
    return true;
  } catch {
    return false;
  }
}

/** 这一段能当公钥解析吗 */
function parsesAsPublicKey(pem: string): boolean {
  try {
    createPublicKey(pem);
    return true;
  } catch {
    return false;
  }
}

/** 造一个「不能用」的体检结果 */
function unusable(problem: PemProblem, detail: string): PemInspection {
  return { usable: false, pem: null, fix: "none", problem, detail };
}

/* -------------------------------------------------------------------------- */
/*  私钥体检                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 体检一段**私钥** PEM —— 认错 + 能修的当场修
 *
 * 判定顺序(**顺序不能改**,前面的更具体):
 *
 * 1. **原样就能用** —— 什么都不动(`fix: "none"`)
 * 2. **头尾行的标签跟内容对不上** —— 换标签重试(`fix: "relabeled"`)
 * 3. **没有头尾两行** —— 补上再试(`fix: "wrapped"`)
 * 4. **贴的是公钥** —— 认出来,报错
 * 5. **看不出来** —— 报错
 */
export function inspectPrivateKeyPem(raw: string): PemInspection {
  const text = normalizePemText(raw);
  if (!text.trim()) {
    return unusable("unparseable", "这一栏是空的");
  }

  const body = extractBody(text);
  if (!body) {
    return unusable(
      "unparseable",
      "读不出内容 —— 复制的时候可能没复制全(PEM 的 BEGIN / END 两行都要在)"
    );
  }

  const label = text.match(BEGIN_RE)?.[1] ?? null;
  const endLabel = text.match(END_RE)?.[1] ?? null;
  /** 头尾两行的标签对不上 —— 也是「贴错了」的一种 */
  const labelMismatch =
    label !== null && endLabel !== null && label !== endLabel;

  // 1) 原样就能用
  if (label && parsesAsPrivateKey(text)) {
    return {
      usable: true,
      pem: text,
      fix: "none",
      problem: "none",
      detail: "格式正常",
    };
  }

  // 2) 标签跟内容对不上 ⇒ 换标签重试
  if (label?.includes("PRIVATE KEY")) {
    for (const candidate of PRIVATE_LABELS) {
      if (candidate === label) continue;
      const pem = wrapBody(body, candidate);
      if (parsesAsPrivateKey(pem)) {
        return {
          usable: true,
          pem,
          fix: "relabeled",
          problem: "mislabeled",
          detail: labelMismatch
            ? `PEM 头尾两行的标签对不上(BEGIN ${label} / END ${endLabel})—— 已自动纠正`
            : `PEM 头尾行标的是「${label}」,内容其实是别的格式 —— 已自动纠正`,
        };
      }
    }
  }

  // 3) 没有头尾两行 ⇒ 当成 base64 正文补上
  if (!label) {
    for (const candidate of PRIVATE_LABELS) {
      const pem = wrapBody(body, candidate);
      if (parsesAsPrivateKey(pem)) {
        return {
          usable: true,
          pem,
          fix: "wrapped",
          problem: "no-header",
          detail: "只有 base64 正文,缺 PEM 头尾两行 —— 已自动补上",
        };
      }
    }
  }

  // 4) 贴的是公钥?
  if (label && parsesAsPublicKey(text)) {
    return unusable(
      "public-key",
      "这一栏里贴的是**公钥** —— 应用私钥和平台公钥是两栏,别贴错"
    );
  }
  for (const candidate of PUBLIC_LABELS) {
    if (parsesAsPublicKey(wrapBody(body, candidate))) {
      return unusable(
        "public-key",
        "这一栏里贴的是**公钥** —— 应用私钥和平台公钥是两栏,别贴错"
      );
    }
  }

  // 5) 看不出来
  return unusable(
    "unparseable",
    "读不出私钥 —— 检查是不是复制全了(PEM 的 BEGIN / END 两行都要在)"
  );
}

/* -------------------------------------------------------------------------- */
/*  公钥体检                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * 体检一段**公钥** PEM —— 认错 + 能修的当场修
 *
 * 公钥那边多一种错法:**把私钥贴进公钥那一栏**(工作室经常把两栏贴反)。
 * 判定顺序跟私钥一样,只是候选标签换成 `PUBLIC KEY` / `RSA PUBLIC KEY` /
 * `CERTIFICATE`。
 *
 * ⚠️ **「贴的是私钥」必须先判** —— `createPublicKey()` 接受一把私钥并推出它的
 * 公钥。不先判的话,一把私钥会被当成「能用的公钥」,验签拿着**自己的**公钥去
 * 对平台的签名 —— 永远对不上,而界面一个字都不说。
 */
export function inspectPublicKeyPem(raw: string): PemInspection {
  const text = normalizePemText(raw);
  if (!text.trim()) {
    return unusable("unparseable", "这一栏是空的");
  }

  const body = extractBody(text);
  if (!body) {
    return unusable(
      "unparseable",
      "读不出内容 —— 复制的时候可能没复制全(PEM 的 BEGIN / END 两行都要在)"
    );
  }

  const label = text.match(BEGIN_RE)?.[1] ?? null;
  const endLabel = text.match(END_RE)?.[1] ?? null;
  /** 头尾两行的标签对不上 —— 也是「贴错了」的一种 */
  const labelMismatch =
    label !== null && endLabel !== null && label !== endLabel;

  // 1) 贴的是**私钥**? —— 必须**先**判
  //
  // ⚠️ `createPublicKey()` 接受一把私钥并**推出**它的公钥(Node 就是这么干的)
  // ⇒ 不先判的话,一把私钥贴进「平台公钥」那一栏会被当成「能用的公钥」,
  // 验签拿着**自己的**公钥去对支付宝/微信的签名 —— 永远对不上,
  // 而界面一个字都不说(验不过就是 false,没有别的线索)。
  if (parsesAsPrivateKey(text)) {
    return unusable(
      "private-key",
      "这一栏里贴的是**私钥** —— 私钥和平台公钥是两栏,别贴错"
    );
  }

  // 2) 原样就能用
  if (label && parsesAsPublicKey(text)) {
    return {
      usable: true,
      pem: text,
      fix: "none",
      problem: "none",
      detail: "格式正常",
    };
  }

  // 3) 标签跟内容对不上 ⇒ 换标签重试
  if (label) {
    for (const candidate of PUBLIC_LABELS) {
      if (candidate === label) continue;
      const pem = wrapBody(body, candidate);
      if (parsesAsPublicKey(pem)) {
        return {
          usable: true,
          pem,
          fix: "relabeled",
          problem: "mislabeled",
          detail: labelMismatch
            ? `PEM 头尾两行的标签对不上(BEGIN ${label} / END ${endLabel})—— 已自动纠正`
            : `PEM 头尾行标的是「${label}」,内容其实是别的格式 —— 已自动纠正`,
        };
      }
    }
  }

  // 4) 没有头尾两行 ⇒ 补上再试
  if (!label) {
    for (const candidate of PUBLIC_LABELS) {
      const pem = wrapBody(body, candidate);
      if (parsesAsPublicKey(pem)) {
        return {
          usable: true,
          pem,
          fix: "wrapped",
          problem: "no-header",
          detail: "只有 base64 正文,缺 PEM 头尾两行 —— 已自动补上",
        };
      }
    }
  }

  // 5) 贴的是私钥?(只有正文、没有头尾行的那种 —— 上面的判私钥够不着)
  for (const candidate of PRIVATE_LABELS) {
    if (parsesAsPrivateKey(wrapBody(body, candidate))) {
      return unusable(
        "private-key",
        "这一栏里贴的是**私钥** —— 私钥和平台公钥是两栏,别贴错"
      );
    }
  }

  // 6) 看不出来
  return unusable(
    "unparseable",
    "读不出公钥 —— 检查是不是复制全了(PEM 的 BEGIN / END 两行都要在)"
  );
}
