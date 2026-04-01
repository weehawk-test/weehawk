import { headers } from "next/headers";
import { API_BASE } from "@/lib/api";
import { S3Client } from "@/components/s3/S3Client";
import type { S3ProfilePublic } from "@/lib/s3-api";

async function getInitialProfiles(): Promise<S3ProfilePublic[]> {
  const cookieHeader = (await headers()).get("cookie") ?? "";
  const res = await fetch(`${API_BASE}/s3/profiles`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: cookieHeader,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Could not load S3 destinations.");
  }
  return res.json();
}

export default async function S3Page() {
  let initialProfiles: S3ProfilePublic[] = [];
  let initialError: string | null = null;
  try {
    initialProfiles = await getInitialProfiles();
  } catch (e) {
    initialError = e instanceof Error ? e.message : String(e);
  }
  return <S3Client initialProfiles={initialProfiles} initialError={initialError} />;
}
