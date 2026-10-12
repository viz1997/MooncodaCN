import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listPhotosAction } from "@/features/image-gen/actions";
import { PhotosManagerView } from "@/features/image-gen/components/photos-manager-view";
import { auth } from "@/lib/auth";

export default async function PhotosPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    redirect("/sign-in");
  }

  const result = await listPhotosAction({ limit: 100 });
  const photos = result?.data?.photos ?? [];

  return (
    <div className="space-y-6">
      <PhotosManagerView initialPhotos={photos} />
    </div>
  );
}
