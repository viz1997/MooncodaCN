/**
 * /account/addresses —— 「收货地址」
 *
 * 2026-11-06 从 `/dashboard/addresses` 搬过来(理由见
 * `/account/orders/page.tsx` 的文件头 —— 买家的东西不放控制台)。
 *
 * 地址簿整个在本仓库(Sellbase 的 `customer.addresses` 是只读的,没有创建
 * 地址的路由)。见 `src/features/address/types.ts` 的文件头。
 *
 * 鉴权在这一页自己做(`(marketing-atelier)` 是公开组,layout 里没有会话守卫)。
 */

import { redirect } from "next/navigation";

import { AddressBook } from "@/features/address/components/address-book";
import { listUserAddresses } from "@/features/address/queries";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function AccountAddressesPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/account/addresses");
  }

  const addresses = await listUserAddresses(session.user.id);

  return <AddressBook initialAddresses={addresses} />;
}
