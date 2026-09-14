import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { previewShare, promptOrder } from "@/db/schema";
import { InvalidLinkScreen } from "@/features/gpt-image/user/components/invalid-link-screen";
import { PreviewOrderView } from "@/features/gpt-image/user/components/preview-order-view";
import { UserOrderView } from "@/features/gpt-image/user/components/user-order-view";

export const dynamic = "force-dynamic";

/**
 * 公共访问 - 通过 token 查看订单或预览凭证（免登录）
 *
 * 2026-09-14：preview 流升级为完整 6 步工作台（upload → generate → select →
 * regenerate → configure → confirm）。PreviewShareView 替换为 PreviewOrderView，
 * 数据源走 preview_share 表（service 层通过 /api/orders/[token] 路由把 preview_share
 * 投影成 OrderView 形状）。preview 流状态机 9 态全部进 PreviewOrderView：
 *   pending / uploaded / generating / candidates_ready / selected / failed /
 *   cancelled 全部走 PreviewOrderView（UI 内部按状态切换步骤）；
 *   confirmed + linkedOrderId → redirect 到新建 promptOrder token 的 SELECTED 视图；
 *   expired → InvalidLinkScreen。
 *
 * token 校验由 page 内部分发（preview_share / promptOrder 各自校验），
 * 无效 token 显示 InvalidLinkScreen。
 */
export default async function PublicOrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // 1. 先查 preview_share（独立表，分享链接实体）
  const share = await db.query.previewShare.findFirst({
    where: eq(previewShare.token, token),
    with: {
      template: {
        columns: {
          id: true,
          name: true,
          candidateCount: true,
          outputMode: true,
        },
      },
    },
  });

  if (share) {
    // 1a. status='confirmed' → 跳转到新建 promptOrder 的 SELECTED 视图
    if (share.status === "confirmed" && share.linkedOrderId) {
      const linked = await db.query.promptOrder.findFirst({
        where: eq(promptOrder.id, share.linkedOrderId),
        columns: { token: true },
      });
      if (linked) {
        redirect(`/p/${linked.token}`);
      }
      // linked_order_id 孤儿（订单被删）→ 显示 InvalidLinkScreen
      return <InvalidLinkScreen />;
    }

    // 1b. status='expired' 或 pending 但已过期 → 链接失效
    if (
      share.status === "expired" ||
      (share.expiresAt && share.expiresAt.getTime() < Date.now())
    ) {
      return <InvalidLinkScreen />;
    }

    // 1c. 其余 7 态全部进 PreviewOrderView（6 步工作台）
    return <PreviewOrderView token={token} previewOrderNo={share.orderNo} />;
  }

  // 2. 没有 preview_share → 走 promptOrder 老路径
  return <UserOrderView token={token} />;
}
