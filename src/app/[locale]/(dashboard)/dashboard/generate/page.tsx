import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getActiveEffects } from "@/features/image-gen";
import { ExternalImageGenCard } from "@/features/image-gen/components/external-image-gen-card";
import { GenerateWorkbenchView } from "@/features/image-gen/components/generate-workbench-view";
import { auth } from "@/lib/auth";

export default async function GeneratePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  const effects = await getActiveEffects();

  return (
    <div className="space-y-6">
      <ExternalImageGenCard />
      <GenerateWorkbenchView effects={effects} userId={session.user.id} />
    </div>
  );
}
