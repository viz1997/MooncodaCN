import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getProductEffectAdminAction } from "@/features/image-gen/admin/actions";
import { ProductEffectForm } from "@/features/image-gen/admin/components/product-effect-form";
import { auth } from "@/lib/auth";

interface EditProductEffectPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductEffectPage({
  params,
}: EditProductEffectPageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  const { id } = await params;
  const result = await getProductEffectAdminAction({ maskId: id });
  const effect = result?.data?.effect;

  if (!effect) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">编辑效果模板</h2>
      <ProductEffectForm initialData={effect} />
    </div>
  );
}
