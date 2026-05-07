import ServiceDetailsClient from "./service-details-client";
import { DOCKER_LIST_PAGE_SIZE } from "@/lib/docker-paged-fetch";
import type { PaginatedSecretsResponse } from "@/lib/docker-paged-fetch";
import type { Project, Service } from "@/lib/schema";
import {
  fetchDockerSecretsPagedSSR,
  fetchProjectSSR,
  fetchServiceRuntimeSSR,
  fetchServiceSSR,
  fetchS3BucketObjectsSSR,
  fetchS3ProfilesSSR,
} from "@/lib/server-fetch";
import { getServerActiveOrganizationPublicId } from "@/lib/server-active-org";
import { normalizeS3PrefixParam } from "@/lib/s3-prefix-param";
import type { S3BucketListResponse } from "@/lib/s3-api";
import { redirect } from "next/navigation";

const SSR_SECRETS_TIMEOUT_MS = 1_500;
const SSR_S3_TIMEOUT_MS = 1_500;
const SSR_RUNTIME_TIMEOUT_MS = 250;

async function withSsrTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
    ]);
  } catch {
    return fallback;
  }
}

export default async function ServiceDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; serviceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id: projectIdRaw, serviceId: serviceIdRaw } = await params;
  const sp = await searchParams;
  await getServerActiveOrganizationPublicId();

  const safeProjectId = projectIdRaw.trim() ? projectIdRaw.trim() : null;
  const safeServiceId = serviceIdRaw.trim() ? serviceIdRaw.trim() : null;

  let initialProject: Project | null = null;
  let initialService: Service | null = null;
  let initialRuntime: { running: boolean } | null = null;
  let initialSecretsPaged: PaginatedSecretsResponse | null = null;
  const [projectResult, serviceResult, runtimeResult] = await Promise.all([
    safeProjectId ? fetchProjectSSR(safeProjectId) : Promise.resolve(null),
    safeServiceId ? fetchServiceSSR(safeServiceId) : Promise.resolve(null),
    safeServiceId
      ? withSsrTimeout(fetchServiceRuntimeSSR(safeServiceId), SSR_RUNTIME_TIMEOUT_MS, null)
      : Promise.resolve(null),
  ]);
  initialProject = projectResult;
  initialService = serviceResult;
  initialRuntime = runtimeResult;

  if (!initialProject || !initialService) {
    redirect("/resource-not-found");
  }

  if (
    initialProject?.publicId &&
    initialService?.publicId &&
    (safeProjectId !== initialProject.publicId || safeServiceId !== initialService.publicId)
  ) {
    redirect(`/projects/${initialProject.publicId}/services/${initialService.publicId}`);
  }

  const rsId = initialService?.remoteServerId;
  if (initialService?.type !== "application" && typeof rsId === "number" && rsId > 0) {
    initialSecretsPaged = await withSsrTimeout(
      fetchDockerSecretsPagedSSR(rsId, 1, DOCKER_LIST_PAGE_SIZE, ""),
      SSR_SECRETS_TIMEOUT_MS,
      null,
    );
  }

  const s3ImportRaw = typeof sp.s3Import === "string" ? sp.s3Import : "";
  const s3ProfileId = typeof sp.s3Profile === "string" ? sp.s3Profile.trim() : "";
  const s3Prefix = normalizeS3PrefixParam(sp.s3Prefix);
  const initialS3Profiles = await withSsrTimeout(
    fetchS3ProfilesSSR(),
    SSR_S3_TIMEOUT_MS,
    [],
  );

  let s3ImportSsr: {
    mode: "db" | "vol";
    profileId: string;
    profileName: string;
    prefix: string;
    initialList: S3BucketListResponse | null;
  } | null = null;

  if (s3ImportRaw === "db" || s3ImportRaw === "vol") {
    if (s3ProfileId) {
      const matchedProfile = initialS3Profiles.find((p) => p.publicId === s3ProfileId);
      const initialList = await withSsrTimeout(
        fetchS3BucketObjectsSSR(s3ProfileId, s3Prefix),
        SSR_S3_TIMEOUT_MS,
        null,
      );
      s3ImportSsr = {
        mode: s3ImportRaw,
        profileId: s3ProfileId,
        profileName: matchedProfile?.name ?? s3ProfileId,
        prefix: s3Prefix,
        initialList,
      };
    }
  }

  return (
    <ServiceDetailsClient
      initialProject={initialProject}
      initialService={initialService}
      initialRuntime={initialRuntime}
      initialSecretsPaged={initialSecretsPaged}
      s3ImportSsr={s3ImportSsr}
      initialS3Profiles={initialS3Profiles}
    />
  );
}

