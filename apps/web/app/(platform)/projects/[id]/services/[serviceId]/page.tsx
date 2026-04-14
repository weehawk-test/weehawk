import ServiceDetailsClient from "./service-details-client";
import { DOCKER_LIST_PAGE_SIZE } from "@/lib/docker-paged-fetch";
import type { PaginatedSecretsResponse } from "@/lib/docker-paged-fetch";
import type { Project, Service } from "@/lib/schema";
import { fetchDockerSecretsPaged } from "@/lib/docker-paged-fetch";
import {
  fetchProjectSSR,
  fetchServiceRuntimeSSR,
  fetchServiceSSR,
  fetchS3BucketObjectsSSR,
  fetchS3ProfilesSSR,
} from "@/lib/server-fetch";
import { normalizeS3PrefixParam } from "@/lib/s3-prefix-param";
import type { S3BucketListResponse } from "@/lib/s3-api";

export default async function ServiceDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; serviceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id: projectIdRaw, serviceId: serviceIdRaw } = await params;

  const projectIdParsed = Number(projectIdRaw);
  const serviceIdParsed = Number(serviceIdRaw);
  const safeProjectId = Number.isNaN(projectIdParsed) ? null : String(projectIdParsed);
  const safeServiceId = Number.isNaN(serviceIdParsed) ? null : String(serviceIdParsed);

  let initialProject: Project | null = null;
  let initialService: Service | null = null;
  let initialRuntime: { running: boolean } | null = null;
  let initialSecretsPaged: PaginatedSecretsResponse | null = null;

  if (safeProjectId) {
    initialProject = await fetchProjectSSR(safeProjectId);
  }

  if (safeServiceId) {
    initialService = await fetchServiceSSR(safeServiceId);
    initialRuntime = await fetchServiceRuntimeSSR(safeServiceId);

    const rsId = initialService?.remoteServerId;
    if (initialService?.type !== "application" && typeof rsId === "number" && rsId > 0) {
      try {
        initialSecretsPaged = await fetchDockerSecretsPaged(rsId, 1, DOCKER_LIST_PAGE_SIZE, "");
      } catch {
        initialSecretsPaged = null;
      }
    }
  }

  const sp = await searchParams;
  const s3ImportRaw = typeof sp.s3Import === "string" ? sp.s3Import : "";
  const s3Profile = typeof sp.s3Profile === "string" ? sp.s3Profile.trim() : "";
  const s3Prefix = normalizeS3PrefixParam(sp.s3Prefix);

  let s3ImportSsr: {
    mode: "db" | "vol";
    profileName: string;
    prefix: string;
    initialList: S3BucketListResponse | null;
  } | null = null;

  if (s3ImportRaw === "db" || s3ImportRaw === "vol") {
    if (s3Profile) {
      const initialList = await fetchS3BucketObjectsSSR(s3Profile, s3Prefix);
      s3ImportSsr = {
        mode: s3ImportRaw,
        profileName: s3Profile,
        prefix: s3Prefix,
        initialList,
      };
    }
  }

  const initialS3Profiles = await fetchS3ProfilesSSR();

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

