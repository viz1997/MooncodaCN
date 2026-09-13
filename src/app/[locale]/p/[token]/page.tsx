import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { previewShare, promptOrder } from "@/db/schema";
import { InvalidLinkScreen } from "@/features/gpt-image/user/components/invalid-link-screen";
import { PreviewShareView } from "@/features/gpt-image/user/components/preview-share-view";
import { UserOrderView } from "@/features/gpt-image/user/components/user-order-view";

export const dynamic = "force-dynamic";

/**
 * 公共访问 - 通过 token 查看订单或预览凭证（免登录）
 *
 * 2026-09-13：分享链接 ≠ 下单。preview_share 独立表后，本入口按 token 先查
 * preview_share 优先：
 *
 *   - preview_share 命中 + status='pending' → PreviewShareView（客人预览确认）
 *   - preview_share 命中 + status='confirmed' + linkedOrderId →
 *       查 promptOrder by id → redirect 到其 token 走 SELECTED 视图
 *   - preview_share 命中 + status='expired' 或过期 → InvalidLinkScreen
 *   - preview_share 查不到 → 走 promptOrder 老路径（UserOrderView）
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

    // 1c. status='pending' → 渲染 PreviewShareView
    return (
      <PreviewShareView
        token={token}
        previewOrderNo={share.orderNo}
        updatedAt={share.updatedAt.toISOString()}
        candidateCount={share.template.candidateCount ?? 1}
        outputMode={
          (share.template.outputMode ?? "grid") as "grid" | "separate"
        }
        templateName={share.template.name}
        productTypeCode={share.productTypeCode}
        productSize={share.productSize}
        accessoryCode={share.accessoryCode}
        engravingText={share.engravingText}
        engravingExposed={share.engravingExposed}
        leatherColor={share.leatherColor}
        leatherExposed={share.leatherExposed}
        pvcProtection={share.pvcProtection}
        remarks={share.remarks}
        platform={share.platform}
      />
    );
  }

  // 2. 没有 preview_share → 走 promptOrder 老路径
  return <UserOrderView token={token} />;
}
