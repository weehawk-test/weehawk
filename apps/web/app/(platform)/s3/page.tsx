import { API_BASE } from "@/lib/api";
import { S3Client } from "@/components/s3/S3Client";
import type { S3ProfilePublic } from "@/lib/s3-api";
import { buildServerApiCookieHeaders } from "@/lib/server-cookie-headers";

export const dynamic = "force-dynamic";

async function getInitialProfiles(organizationPublicId?: string | null): Promise<S3ProfilePublic[]> {
  const org = organizationPublicId?.trim();
  const q = org ? `?organizationPublicId=${encodeURIComponent(org)}` : "";
  const res = await fetch(`${API_BASE}/api/s3/profiles${q}`, {
    method: "GET",
    headers: await buildServerApiCookieHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Could not load S3 destinations.");
  }
  return res.json();
}

type S3PageProps = { organizationPublicId?: string };

export default async function S3Page(props: S3PageProps = {}) {
  const { organizationPublicId } = props;
  let initialProfiles: S3ProfilePublic[] = [];
  let initialError: string | null = null;
  try {
    initialProfiles = await getInitialProfiles(organizationPublicId);
  } catch (e) {
    initialError = e instanceof Error ? e.message : String(e);
  }
  return (
    <S3Client
      initialProfiles={initialProfiles}
      initialError={initialError}
      organizationPublicId={organizationPublicId}
    />
  );
}
