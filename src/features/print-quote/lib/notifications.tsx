/**
 * 打印工单的邮件通知
 *
 * ## 谁在什么时候收到信
 *
 * | 触发                | 收件人   | 语言        |
 * |---------------------|----------|-------------|
 * | 下单成功            | 用户     | 订单的 locale |
 * | 下单成功            | 工作室   | 中文        |
 * | 工作室改状态(含取消)| 用户     | 订单的 locale |
 * | 用户自助取消        | 用户     | 订单的 locale |
 * | 用户自助取消        | 工作室   | 中文        |
 *
 * 工作室的邮件永远是中文:工作室就一个团队,后台界面本身也还是中文的
 * (后台全量 i18n 化是另一个 PR)。
 *
 * ## 邮件挂了绝不能影响下单 / 改状态
 *
 * 所以这一层**吞掉所有异常**,只 `logger.error` 记一笔。时间线才是权威的
 * 状态源 —— 邮件只是「顺手告诉用户一声」,丢了顶多少一封信,不能把工单搞坏。
 *
 * ## 为什么不直接用 `useTranslations()`
 *
 * 邮件是 Node 侧渲染的(Resend + React Email),没有 request、没有
 * `NextIntlClientProvider`。这里用 `getTranslations({locale, namespace})` ——
 * 它接受显式的 locale,可以在 request scope 之外用(已实测:route handler 里
 * 传 "en" 拿到的是英文)。
 */

import { getTranslations } from "next-intl/server";
import { FALLBACK_SUPPORT_EMAIL, siteConfig } from "@/config/site";
import type { PrintOrderRow } from "@/db/schema";
import { PrintOrderEmail } from "@/features/mail/templates";
import { sendEmail } from "@/features/mail/utils";
import { logger } from "@/lib/logger";

import { formatCents } from "./format";
import type { PrintOrderLocale, PrintOrderStatus } from "./quote-types";

/** 通知里用到的订单信息 */
export type PrintOrderMailInfo = {
  orderNo: string;
  contactName: string;
  contactEmail: string;
  totalPriceCents: number;
  modelFileName: string;
  /** 这单的邮件语言 */
  locale: PrintOrderLocale;
};

/**
 * 工作室收件地址
 *
 * **永远返回一个能收信的地址** —— 环境变量没配就落到兜底地址。
 *
 * 这里以前是「没配就返回 null,静默不发工作室那几封」。但工作室要的是
 * 「每张工单都有人收到通知」—— 环境变量漏配的时候静默不发,等于工单躺在
 * 后台没人知道。兜底地址在 `src/config/site.ts` 里。
 */
function getStudioEmail(): string {
  const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
  return email?.includes("@") ? email : FALLBACK_SUPPORT_EMAIL;
}

/** DB 行 → 通知用的订单信息 */
export function toPrintOrderMailInfo(row: PrintOrderRow): PrintOrderMailInfo {
  return {
    orderNo: row.orderNo,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    totalPriceCents: row.totalPriceCents,
    modelFileName: row.modelFileName,
    locale: row.locale === "en" ? "en" : "zh",
  };
}

/** 工单详情页的绝对链接(邮件里的按钮) */
function buildOrderUrl(locale: PrintOrderLocale, orderNo: string): string {
  return `${siteConfig.url}/${locale}/dashboard/print-orders/${orderNo}`;
}

/** 按订单语言格式化金额(仓库统一用美元) */
function formatAmount(cents: number, locale: PrintOrderLocale): string {
  return formatCents(cents, locale === "en" ? "en-US" : "zh-CN");
}

/** 内部:发一封打印工单邮件(不吞异常 —— 由外层统一吞) */
async function deliverPrintOrderMail(params: {
  to: string;
  locale: PrintOrderLocale;
  subject: string;
  preview: string;
  heading: string;
  paragraphs: string[];
  facts: { label: string; value: string }[];
  statusLabel: string | null;
  note: string | null;
  noteLabel: string | null;
  actionLabel: string;
  actionUrl: string;
}): Promise<void> {
  await sendEmail({
    to: params.to,
    subject: params.subject,
    react: (
      <PrintOrderEmail
        preview={params.preview}
        heading={params.heading}
        paragraphs={params.paragraphs}
        facts={params.facts}
        statusLabel={params.statusLabel}
        note={params.note}
        noteLabel={params.noteLabel}
        actionLabel={params.actionLabel}
        actionUrl={params.actionUrl}
      />
    ),
  });
}

/**
 * 下单成功 —— 用户一封 + 工作室一封
 *
 * 用户那封用订单的语言,工作室那封用中文。
 */
export async function notifyPrintOrderCreated(
  order: PrintOrderMailInfo
): Promise<void> {
  try {
    const t = await getTranslations({
      locale: order.locale,
      namespace: "PrintQuote",
    });
    const actionUrl = buildOrderUrl(order.locale, order.orderNo);

    // ---- 用户 ----
    await deliverPrintOrderMail({
      to: order.contactEmail,
      locale: order.locale,
      subject: t("email.created.subject", { orderNo: order.orderNo }),
      preview: t("email.created.preview", { orderNo: order.orderNo }),
      heading: t("email.created.heading"),
      paragraphs: [
        t("email.common.greeting", { name: order.contactName }),
        t("email.created.body"),
        t("email.created.body2"),
      ],
      facts: [
        { label: t("email.common.orderNo"), value: order.orderNo },
        {
          label: t("email.common.total"),
          value: formatAmount(order.totalPriceCents, order.locale),
        },
        { label: t("email.common.model"), value: order.modelFileName },
      ],
      statusLabel: t("status.PENDING"),
      note: null,
      noteLabel: null,
      actionLabel: t("email.common.action"),
      actionUrl,
    });

    // ---- 工作室 ----
    const studio = getStudioEmail();
    const ts = await getTranslations({
      locale: "zh",
      namespace: "PrintQuote",
    });
    await deliverPrintOrderMail({
      to: studio,
      locale: "zh",
      subject: ts("email.studioNewOrder.subject", {
        orderNo: order.orderNo,
      }),
      preview: ts("email.studioNewOrder.preview", {
        orderNo: order.orderNo,
      }),
      heading: ts("email.studioNewOrder.heading"),
      paragraphs: [
        ts("email.studioNewOrder.body", {
          name: order.contactName,
          orderNo: order.orderNo,
        }),
        ts("email.studioNewOrder.body2"),
      ],
      facts: [
        { label: ts("email.common.orderNo"), value: order.orderNo },
        {
          label: ts("email.common.total"),
          value: formatAmount(order.totalPriceCents, "zh"),
        },
        { label: ts("email.common.model"), value: order.modelFileName },
        { label: ts("email.common.customer"), value: order.contactName },
      ],
      statusLabel: ts("status.PENDING"),
      note: null,
      noteLabel: null,
      actionLabel: ts("email.common.action"),
      actionUrl: `${siteConfig.url}/zh/admin/print-orders`,
    });
  } catch (error) {
    logger.error(
      { err: error, orderNo: order.orderNo },
      "打印工单下单通知发送失败"
    );
  }
}

/**
 * 工作室改了状态 —— 用户一封
 *
 * 回退时会带上工作室写的备注(用户得知道为什么被退回来)。
 */
export async function notifyPrintOrderStatusChanged(params: {
  order: PrintOrderMailInfo;
  /** 目标状态 —— 邮件里的「{status}」用订单语言渲染 */
  toStatus: PrintOrderStatus;
  /** 工作室写的备注(可选) */
  note: string | null;
}): Promise<void> {
  try {
    const { order } = params;
    const t = await getTranslations({
      locale: order.locale,
      namespace: "PrintQuote",
    });
    const statusLabel = t(`status.${params.toStatus}`);

    await deliverPrintOrderMail({
      to: order.contactEmail,
      locale: order.locale,
      subject: t("email.statusChanged.subject", {
        orderNo: order.orderNo,
        status: statusLabel,
      }),
      preview: t("email.statusChanged.preview", {
        orderNo: order.orderNo,
        status: statusLabel,
      }),
      heading: t("email.statusChanged.heading"),
      paragraphs: [
        t("email.statusChanged.body", {
          orderNo: order.orderNo,
          status: statusLabel,
        }),
        t("email.statusChanged.body2"),
      ],
      facts: [
        { label: t("email.common.orderNo"), value: order.orderNo },
        {
          label: t("email.common.total"),
          value: formatAmount(order.totalPriceCents, order.locale),
        },
      ],
      statusLabel: t("email.common.status", { status: statusLabel }),
      note: params.note,
      noteLabel: params.note ? t("email.common.noteLabel") : null,
      actionLabel: t("email.common.action"),
      actionUrl: buildOrderUrl(order.locale, order.orderNo),
    });
  } catch (error) {
    logger.error(
      { err: error, orderNo: params.order.orderNo },
      "打印工单状态变更通知发送失败"
    );
  }
}

/**
 * 用户自助取消 —— 用户一封 + 工作室一封
 *
 * 用户那封是「确认」性质的(不是工作室干的),工作室那封是「告警」性质的。
 */
export async function notifyPrintOrderCancelledByUser(params: {
  order: PrintOrderMailInfo;
  /** 用户填的取消原因(选填) */
  note: string | null;
}): Promise<void> {
  try {
    const { order } = params;
    const t = await getTranslations({
      locale: order.locale,
      namespace: "PrintQuote",
    });

    // ---- 用户 ----
    await deliverPrintOrderMail({
      to: order.contactEmail,
      locale: order.locale,
      subject: t("email.cancelled.subject", { orderNo: order.orderNo }),
      preview: t("email.cancelled.preview", { orderNo: order.orderNo }),
      heading: t("email.cancelled.heading"),
      paragraphs: [
        t("email.cancelled.body", { orderNo: order.orderNo }),
        t("email.cancelled.body2"),
      ],
      facts: [{ label: t("email.common.orderNo"), value: order.orderNo }],
      statusLabel: t("status.CANCELLED"),
      note: params.note,
      noteLabel: params.note ? t("email.common.customerNoteLabel") : null,
      actionLabel: t("email.common.action"),
      actionUrl: buildOrderUrl(order.locale, order.orderNo),
    });

    // ---- 工作室 ----
    const studio = getStudioEmail();
    const ts = await getTranslations({
      locale: "zh",
      namespace: "PrintQuote",
    });
    await deliverPrintOrderMail({
      to: studio,
      locale: "zh",
      subject: ts("email.studioCancelled.subject", {
        orderNo: order.orderNo,
      }),
      preview: ts("email.studioCancelled.preview", {
        orderNo: order.orderNo,
      }),
      heading: ts("email.studioCancelled.heading"),
      paragraphs: [
        ts("email.studioCancelled.body", {
          name: order.contactName,
          orderNo: order.orderNo,
        }),
        ...(params.note
          ? [
              ts("email.studioCancelled.bodyWithNote", {
                note: params.note,
              }),
            ]
          : []),
      ],
      facts: [
        { label: ts("email.common.orderNo"), value: order.orderNo },
        { label: ts("email.common.customer"), value: order.contactName },
      ],
      statusLabel: ts("status.CANCELLED"),
      note: params.note,
      noteLabel: params.note ? ts("email.common.customerNoteLabel") : null,
      actionLabel: ts("email.common.action"),
      actionUrl: `${siteConfig.url}/zh/admin/print-orders`,
    });
  } catch (error) {
    logger.error(
      { err: error, orderNo: params.order.orderNo },
      "打印工单取消通知发送失败"
    );
  }
}

/**
 * 收到付款 —— **只发工作室**
 *
 * 用户那边自己能看到支付状态(详情页轮询),不用再收一封「我们收到你的钱
 * 了」的邮件 —— 他刚刚在 Stripe 上付完款,再收一封邮件只会觉得啰嗦。
 *
 * 工作室那封是刚需:「这单收款了,可以开工了」是工作室下一步动作的触发
 * 信号。
 */
export async function notifyPrintOrderPaid(
  order: PrintOrderMailInfo
): Promise<void> {
  try {
    const studio = getStudioEmail();

    const ts = await getTranslations({
      locale: "zh",
      namespace: "PrintQuote",
    });
    await deliverPrintOrderMail({
      to: studio,
      locale: "zh",
      subject: ts("email.studioPaid.subject", { orderNo: order.orderNo }),
      preview: ts("email.studioPaid.preview", { orderNo: order.orderNo }),
      heading: ts("email.studioPaid.heading"),
      paragraphs: [
        ts("email.studioPaid.body", {
          name: order.contactName,
          orderNo: order.orderNo,
        }),
        ts("email.studioPaid.body2"),
      ],
      facts: [
        { label: ts("email.common.orderNo"), value: order.orderNo },
        {
          label: ts("email.common.total"),
          value: formatAmount(order.totalPriceCents, "zh"),
        },
        { label: ts("email.common.customer"), value: order.contactName },
      ],
      statusLabel: ts("payment.status.paid"),
      note: null,
      noteLabel: null,
      actionLabel: ts("email.common.action"),
      actionUrl: `${siteConfig.url}/zh/admin/print-orders`,
    });
  } catch (error) {
    logger.error(
      { err: error, orderNo: order.orderNo },
      "打印工单收款通知发送失败"
    );
  }
}
