import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listImageJobsAction } from "@/features/image-gen/actions";
import { EffectsHistoryView } from "@/features/image-gen/components/effects-history-view";
import { auth } from "@/lib/auth";

export default async function EffectsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  const result = await listImageJobsAction({ limit: 100 });
  const jobs = result?.data?.jobs ?? [];

  return (
    <div className="space-y-6">
      <EffectsHistoryView initialJobs={jobs} />
    </div>
  );
}
