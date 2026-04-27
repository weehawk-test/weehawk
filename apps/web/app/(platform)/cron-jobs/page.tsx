import { fetchCronJobsSSR } from "@/lib/server-fetch";
import { cookies } from "next/headers";
import {
  pendingDeletionCookieKey,
  readPendingDeletionsFromCookie,
} from "@/lib/pending-deletions";
import { CronJobsClient } from "./cron-jobs-client";

export default async function Page() {
  const cookieStore = await cookies();
  const pending = readPendingDeletionsFromCookie(
    "cron-jobs",
    cookieStore.get(pendingDeletionCookieKey("cron-jobs"))?.value,
  );
  const initialJobs = (await fetchCronJobsSSR()).filter((j) => {
    const id = String(j.id);
    const publicId = String(j.publicId ?? "").trim();
    return !pending.has(id) && (!publicId || !pending.has(publicId));
  });
  return <CronJobsClient initialJobs={initialJobs} />;
}
