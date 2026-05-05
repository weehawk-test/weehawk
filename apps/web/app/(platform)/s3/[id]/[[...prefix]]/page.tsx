import { S3BucketBrowser } from "@/components/s3/S3BucketBrowser";
import {
  fetchS3BucketObjectsSSR,
  fetchS3PrefixSummarySSR,
} from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import type { S3PrefixSummaryResponse } from "@/lib/s3-api";
import { s3PathSegmentsToPrefix } from "@/lib/s3-prefix-param";

export const dynamic = "force-dynamic";

export default async function S3BucketPage({
  params,
}: {
  params: Promise<{ id: string; prefix?: string[] }>;
}) {
  const p = await params;
  const profileId = decodeURIComponent((p.id ?? "").trim());
  const prefixParam = s3PathSegmentsToPrefix(p.prefix);
  const orgPid = await getServerActiveOrganizationPublicId();

  const initialList = profileId
    ? await fetchS3BucketObjectsSSR(profileId, prefixParam, orgPid)
    : null;
  const initialFolderSummaries: Record<string, S3PrefixSummaryResponse> = {};
  if (initialList?.folders?.length) {
    const results = await Promise.all(
      initialList.folders.map(async (f) => {
        const s = await fetchS3PrefixSummarySSR(profileId, f.prefix, orgPid);
        return [f.prefix, s] as const;
      }),
    );
    for (const [pfx, s] of results) {
      if (s) initialFolderSummaries[pfx] = s;
    }
  }

  return (
    <S3BucketBrowser
      key={`${profileId}:${prefixParam}`}
      profileName={profileId}
      initialPrefix={prefixParam}
      initialList={initialList}
      initialFolderSummaries={initialFolderSummaries}
      organizationPublicId={orgPid ?? undefined}
    />
  );
}
