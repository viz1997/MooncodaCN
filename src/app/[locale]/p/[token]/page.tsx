import { UserOrderView } from "@/features/gpt-image/user/components/user-order-view";

export const dynamic = "force-dynamic";

/**
 * 公共访问 - 通过 token 查看订单（免登录）
 *
 * 不在 middleware 的 protectedRoutes 中，自动放行。
 * token 校验由 page 内部的 useOrder hook 处理（无效 token 显示 InvalidLinkScreen）。
 */
export default async function PublicOrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <UserOrderView token={token} />;
}
