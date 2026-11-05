/**
 * /dashboard/addresses —— 「收货地址」
 *
 * 地址簿整个在本仓库(Sellbase 的 `customer.addresses` 是只读的,没有创建
 * 地址的路由)。见 `src/features/address/types.ts` 的文件头。
 */

import { redirect } from "next/navigation";

import { AddressBook } from "@/features/address/components/address-book";
import { listUserAddresses } from "@/features/address/queries";
import { getServerSession } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

export default async function AddressesPage() {
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/sign-in?callbackUrl=/dashboard/addresses");
  }

  const addresses = await listUserAddresses(session.user.id);

  return <AddressBook initialAddresses={addresses} />;
}
