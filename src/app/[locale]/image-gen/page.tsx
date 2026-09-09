/**
 * /image-gen —— 用户维度 workbench 入口
 *
 * 2026-09-08：原公开 demo（localStorage 历史 + /api/public/generate）完全
 * 删除。代理商业模式砍掉后，/image-gen 改为登录用户的个人生图工作台。
 *
 * 流程：
 *   1. 未登录 → 重定向到 /sign-in?callbackUrl=/image-gen
 *   2. 登录后 → server-side 并行 fetch 模板 / 草稿 / 历史订单，渲染 UserWorkbenchView
 *
 * 详细 workbench 步骤（TemplateSelectStep / SpecSelectStep / ResultStep）
 * 在 UserWorkbenchView 客户端组件里展开；本页只负责 RSC 数据装配 + 登录 gate。
 *
 * 设计参考 [[snoopy-wiggling-volcano.md]] plan 第 5 节。
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import {
  createUserDraftOrderAction,
  listUserOrderHistoryAction,
  listUserWorkbenchAction,
  submitUserDraftOrderAction,
  updateUserDraftSpecAction,
} from "@/features/image-gen/actions/workbench";

import { UserWorkbenchView } from "@/features/image-gen/components/user-workbench-view";

export const dynamic = "force-dynamic";

export default async function ImageGenPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    // 未登录：回 sign-in 并保留返回路径
    redirect("/sign-in?callbackUrl=/image-gen");
  }

  // 并行拉数据：workbench 入口 + 用户订单历史。
  // 两个 action 都返回 SafeActionResult，需要 .data 拿负载；schema 为
  // z.object({}).optional()，调用时直接传 undefined。
  const [workbenchRes, historyRes] = await Promise.all([
    listUserWorkbenchAction(undefined),
    listUserOrderHistoryAction(undefined),
  ]);
  const workbench = workbenchRes?.data ?? { templates: [], draftOrder: null };
  const history = historyRes?.data ?? { orders: [] };

  return (
    <UserWorkbenchView
      user={{
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
      }}
      templates={workbench.templates}
      draftOrder={workbench.draftOrder}
      historyOrders={history.orders}
      // 把 server actions 透传到客户端组件，避免在 client 里手写 fetch /api/...
      // 三个 action 全部为 protectedAction（需登录），可放心传给 client。
      actions={{
        createDraft: createUserDraftOrderAction,
        submitDraft: submitUserDraftOrderAction,
        updateSpec: updateUserDraftSpecAction,
      }}
    />
  );
}
