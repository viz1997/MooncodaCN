import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";

import { siteConfig } from "@/config/site";

/**
 * 打印工单邮件模板
 *
 * ## 为什么模板里一个字都不硬编码
 *
 * 邮件是在 Node 侧渲染的(Resend + React Email),没有 request、没有
 * `NextIntlClientProvider`,`useTranslations()` 用不了。所以**所有句子都由
 * 服务端解析好当 props 传进来** —— 模板只负责排版。
 *
 * 现有的 `primary-action-email.tsx` 就是反面教材:整个模板写死英文,
 * 中文用户收到的重置密码邮件也是英文。打印工单的收件人是**付费客户**,
 * 而且下单语言可能是英文,写死英文等于给一半用户发错语言的信。
 *
 * 拼句子的活儿在 `src/features/print-quote/lib/notifications.ts`,文案来自
 * `messages/{zh,en}.json` 的 `PrintQuote.email.*`。
 */

export interface PrintOrderEmailFact {
  label: string;
  value: string;
}

export interface PrintOrderEmailProps {
  /** 收件箱预览文本 */
  preview?: string;
  /** 大标题 */
  heading: string;
  /** 正文段落 */
  paragraphs?: string[];
  /** 键值事实列表(订单号 / 金额 / 状态…) */
  facts?: PrintOrderEmailFact[];
  /** 当前状态标签 */
  statusLabel?: string | null;
  /** 人工备注(工作室回退原因等) */
  note?: string | null;
  /** 备注标题 */
  noteLabel?: string | null;
  /** 行动按钮文案 */
  actionLabel?: string | null;
  /** 行动按钮链接 */
  actionUrl?: string | null;
}

/**
 * 打印工单邮件组件
 */
export function PrintOrderEmail({
  preview,
  heading,
  paragraphs,
  facts,
  statusLabel,
  note,
  noteLabel,
  actionLabel,
  actionUrl,
}: PrintOrderEmailProps) {
  return (
    <Html>
      <Head />
      {preview ? <Preview>{preview}</Preview> : null}
      <Tailwind>
        <Body className="mx-auto my-auto bg-white font-sans">
          <Container className="mx-auto my-10 max-w-xl rounded-lg border border-solid border-gray-200 p-8">
            <Section className="mb-8 text-center">
              <Heading className="m-0 text-2xl font-bold text-gray-900">
                {siteConfig.name}
              </Heading>
            </Section>

            <Heading className="mb-4 text-xl font-semibold text-gray-900">
              {heading}
            </Heading>

            {paragraphs?.map((paragraph) => (
              <Text
                key={paragraph}
                className="mb-3 text-base leading-relaxed text-gray-600"
              >
                {paragraph}
              </Text>
            ))}

            {facts && facts.length > 0 ? (
              <Section className="mb-6 rounded-lg bg-gray-50 p-4">
                {facts.map((fact) => (
                  <Text
                    key={`${fact.label}-${fact.value}`}
                    className="m-0 mb-1 flex justify-between text-sm text-gray-700 last:mb-0"
                  >
                    <span className="text-gray-500">{fact.label}</span>
                    <span className="font-medium text-gray-900">
                      {fact.value}
                    </span>
                  </Text>
                ))}
              </Section>
            ) : null}

            {statusLabel ? (
              <Section className="mb-6">
                <Text className="m-0 text-sm text-gray-500">{statusLabel}</Text>
              </Section>
            ) : null}

            {note ? (
              <Section className="mb-6 rounded-lg border border-solid border-amber-200 bg-amber-50 p-4">
                {noteLabel ? (
                  <Text className="m-0 mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
                    {noteLabel}
                  </Text>
                ) : null}
                <Text className="m-0 whitespace-pre-line text-sm leading-relaxed text-amber-900">
                  {note}
                </Text>
              </Section>
            ) : null}

            {actionUrl && actionLabel ? (
              <Section className="mb-6 text-center">
                <Button
                  href={actionUrl}
                  className="inline-block rounded-md bg-violet-600 px-6 py-3 text-center text-sm font-semibold text-white no-underline"
                >
                  {actionLabel}
                </Button>
              </Section>
            ) : null}

            <Hr className="my-6 border-gray-200" />

            <Text className="m-0 text-center text-xs text-gray-400">
              © {new Date().getFullYear()} {siteConfig.name}. All rights
              reserved.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

PrintOrderEmail.PreviewProps = {
  preview: "Your print order has been updated",
  heading: "Your print order has been updated",
  paragraphs: ["The studio moved your order to a new stage."],
  facts: [
    { label: "Order", value: "PO-20261101-3F7K2A" },
    { label: "Total", value: "¥128.00" },
  ],
  statusLabel: "Status: In production",
  note: "The model needed a thinner support layer.",
  noteLabel: "Note from the studio",
  actionLabel: "View order",
  actionUrl: "https://example.com/dashboard/print-orders",
} satisfies PrintOrderEmailProps;

export default PrintOrderEmail;
