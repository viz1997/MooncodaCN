/**
 * 退款的邮件通知
 *
 * ## 谁收到信
 *
 * | 触发 | 收件人 | 语言 |
 * |---|---|---|
 * | 买家提交退款申请 | **工作室** | 中文 |
 *
 * 买家自己**不收这封信** —— 申请提交后买家页面上的状态条已经告诉他了。
 * 工作室那边要的是「**有人申请退款了**」这个信号,不然申请躺在后台没人知道。
 *
 * ## 工作室的邮件永远是中文
 *
 * 跟打印工单那一套一个口径 —— 工作室就一个团队,后台界面本身也还是中文的。
 *
 * ## 邮件挂了绝不能影响申请
 *
 * 这一层**吞掉所有异常**,只 `logger.error` 记一笔。
 *
 * ⚠️ **申请已经落库了** —— 工作室在后台那个列表里一定看得到。
 * 邮件只是「顺手告诉一声」,寄不出去顶多少一封信,不能把买家的申请搞没。
 */

import { Text } from "@react-email/components";

import { siteConfig } from "@/config/site";
import { PrimaryActionEmail } from "@/features/mail/templates";
import { sendEmail } from "@/features/mail/utils";
import { getStudioEmail } from "@/features/print-quote/lib/notifications";
import { logger } from "@/lib/logger";
import { formatCents } from "@/lib/money";

import type { RefundOrderKind } from "./types";

/** 通知里用到的信息 */
export type RefundRequestMailInfo = {
  orderKind: RefundOrderKind;
  orderNo: string;
  /** 申请金额(分) */
  amountCents: number;
  /** 买家填的原因 */
  reason: string;
  /** 收款通道(退款要走的那条路) */
  paymentChannel: string | null;
  /** 买家邮箱 —— 工作室要联系买家 */
  buyerEmail: string | null;
  /** 买家昵称 */
  buyerName: string | null;
};

/** 后台退款管理页的地址(工作室在中文后台里干活) */
function buildAdminRefundsUrl(): string {
  return `${siteConfig.url}/zh/admin/refunds`;
}

/** 订单类型的中文说法 */
function orderKindLabel(orderKind: RefundOrderKind): string {
  return orderKind === "print" ? "打印工单" : "商城订单";
}

/**
 * 买家提交了退款申请 —— 通知工作室
 *
 * **吞掉所有异常** —— 见文件头的「邮件挂了绝不能影响申请」。
 */
export async function notifyRefundRequestCreated(
  info: RefundRequestMailInfo
): Promise<void> {
  try {
    const amount = formatCents(info.amountCents, { locale: "zh-CN" });
    const buyer = info.buyerName || info.buyerEmail || "—";

    await sendEmail({
      to: getStudioEmail(),
      subject: `新的退款申请:${info.orderNo}(${amount})`,
      react: (
        <PrimaryActionEmail
          preview={`买家申请退款:${info.orderNo} · ${amount}`}
          actionLabel="去后台处理"
          actionUrl={buildAdminRefundsUrl()}
        >
          <Text className="mb-4 text-base leading-relaxed text-gray-600">
            有一笔退款申请待处理。
          </Text>
          <Text className="mb-2 text-sm leading-relaxed text-gray-700">
            订单号:{info.orderNo}
          </Text>
          <Text className="mb-2 text-sm leading-relaxed text-gray-700">
            订单类型:{orderKindLabel(info.orderKind)}
          </Text>
          <Text className="mb-2 text-sm leading-relaxed text-gray-700">
            申请金额:{amount}
          </Text>
          <Text className="mb-2 text-sm leading-relaxed text-gray-700">
            收款通道:{info.paymentChannel || "—"}
          </Text>
          <Text className="mb-2 text-sm leading-relaxed text-gray-700">
            买家:{buyer}
            {info.buyerEmail ? `(${info.buyerEmail})` : ""}
          </Text>
          <Text className="mb-2 text-sm leading-relaxed text-gray-700">
            申请原因:{info.reason}
          </Text>
        </PrimaryActionEmail>
      ),
    });
  } catch (error) {
    logger.error(
      { err: error, orderNo: info.orderNo },
      "退款申请通知邮件发送失败"
    );
  }
}
