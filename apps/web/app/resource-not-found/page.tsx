import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { ORG_WORKSPACE_ACCESS_DENIED_REASON } from "@/lib/org-workspace-access-denied";
import { ORG_WORKSPACE_PERMISSIONS } from "@/lib/org-workspace-permissions";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ResourceNotFoundPage({ searchParams }: Props) {
  const sp = await searchParams;
  const reason = typeof sp.reason === "string" ? sp.reason : "";
  const orgPublicId = typeof sp.org === "string" ? sp.org.trim() : "";
  const denied = typeof sp.denied === "string" ? sp.denied.trim() : "";
  const isOrgWorkspaceDenied = reason === ORG_WORKSPACE_ACCESS_DENIED_REASON && orgPublicId.length > 0;

  if (isOrgWorkspaceDenied) {
    const projectsDenied = denied === ORG_WORKSPACE_PERMISSIONS.PROJECTS;
    const backHref = projectsDenied ? "/" : "/projects";
    const backLabel = projectsDenied ? "Home" : "Projects";
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
        <ShieldAlert className="mb-6 size-20 text-amber-600/80 dark:text-amber-400/80" aria-hidden />
        <h1 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">Access restricted</h1>
        <p className="mb-2 max-w-xl text-lg text-muted-foreground md:text-xl">
          An organization owner has not granted you access to this area. Contact an owner to request the
          appropriate workspace permission.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href={backHref} className="btn-primary inline-flex items-center justify-center">
            Back to {backLabel}
          </Link>
          <Link href="/" className="btn-secondary inline-flex items-center justify-center">
            Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <ShieldAlert className="mb-6 size-20 text-muted-foreground opacity-60" aria-hidden />
      <h1 className="mb-4 text-4xl font-bold text-foreground">Page not found</h1>
      <p className="mb-8 max-w-xl text-xl text-muted-foreground">
        This item does not exist or you do not have access to it.
      </p>
      <Link href="/" className="btn-primary inline-flex items-center justify-center">
        Return Home
      </Link>
    </div>
  );
}
