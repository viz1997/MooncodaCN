import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ExternalImageGenCard } from "@/features/image-gen/components/external-image-gen-card";
import { GenerateWorkbenchView } from "@/features/image-gen/components/generate-workbench-view";
import { getActivePromptTemplates } from "@/features/image-gen/lib/prompt-template-source";
import { auth } from "@/lib/auth";

export default async function GeneratePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  // Phase C：image-gen 工作台改读 promptTemplate（与 gpt-image 共用单一数据源）
  const templates = await getActivePromptTemplates();

  return (
    <div className="space-y-6">
      <ExternalImageGenCard />
      <GenerateWorkbenchView templates={templates} />
    </div>
  );
}
