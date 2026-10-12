import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ModelsManagerView } from "@/features/image-gen/components/models-manager-view";
import { auth } from "@/lib/auth";

export default async function ModelsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  return (
    <div className="space-y-6">
      <ModelsManagerView />
    </div>
  );
}
