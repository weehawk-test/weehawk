import { ClipboardList } from "lucide-react";

export default function OrganizationAuditPage() {
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Track who changed what inside this organization. This section will ship in a future release.
      </p>
      <div className="glass-panel rounded-2xl border border-dashed border-border/80 p-10 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-muted/50">
          <ClipboardList className="size-8 text-muted-foreground" aria-hidden />
        </div>
        <h2 className="mt-6 text-lg font-semibold text-foreground">Coming soon</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          We will record security-relevant events (invites, permission changes, project links, etc.) with timestamps and
          actors for compliance and debugging.
        </p>
      </div>
    </div>
  );
}
