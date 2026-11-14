import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listProductEffectsAdminAction } from "@/features/image-gen/admin/actions";
import { ProductEffectsAdminView } from "@/features/image-gen/admin/components/product-effects-admin-view";
import { getCatalogDictionaryView } from "@/features/image-gen/lib/catalog-dictionary-store";
import { auth } from "@/lib/auth";

export default async function ProductEffectsAdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  const result = await listProductEffectsAdminAction();
  const effects = result?.data?.effects ?? [];

  // 商品目录字典（型号 / 尺寸 / 配件）—— 列表页里的「编辑」弹窗要交给表单，
  // 而表单是客户端组件读不了 DB ⇒ 服务端读好当 props 逐层传下去。
  const catalog = await getCatalogDictionaryView();

  return (
    <div className="space-y-6">
      <ProductEffectsAdminView effects={effects} catalog={catalog} />
    </div>
  );
}
