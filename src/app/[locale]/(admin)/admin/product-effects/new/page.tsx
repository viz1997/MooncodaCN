import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProductEffectForm } from "@/features/image-gen/admin/components/product-effect-form";
import { auth } from "@/lib/auth";

export default async function NewProductEffectPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium">新建效果模板</h2>
      <ProductEffectForm />
    </div>
  );
}
