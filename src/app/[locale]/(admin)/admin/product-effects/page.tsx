import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listProductEffectsAdminAction } from "@/features/image-gen/admin/actions";
import { ProductEffectsAdminView } from "@/features/image-gen/admin/components/product-effects-admin-view";
import { auth } from "@/lib/auth";

export default async function ProductEffectsAdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  const result = await listProductEffectsAdminAction();
  const effects = result?.data?.effects ?? [];

  return (
    <div className="space-y-6">
      <ProductEffectsAdminView effects={effects} />
    </div>
  );
}
