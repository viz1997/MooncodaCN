import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ImageModelsAdminView } from "@/features/image-gen/admin/components/image-models-admin-view";
import { auth } from "@/lib/auth";

export default async function ImageModelsAdminPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  return (
    <div className="space-y-6">
      <ImageModelsAdminView />
    </div>
  );
}
