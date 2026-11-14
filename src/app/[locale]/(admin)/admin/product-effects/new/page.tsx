import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProductEffectForm } from "@/features/image-gen/admin/components/product-effect-form";
import { getCatalogDictionaryView } from "@/features/image-gen/lib/catalog-dictionary-store";
import { auth } from "@/lib/auth";

export default async function NewProductEffectPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  // 商品目录字典（型号 / 尺寸 / 配件）—— 表单是客户端组件，读不了 DB
  // ⇒ 服务端读好当 props 传下去。
  const catalog = await getCatalogDictionaryView();

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">新建效果模板</h2>
      <ProductEffectForm catalog={catalog} />
    </div>
  );
}
