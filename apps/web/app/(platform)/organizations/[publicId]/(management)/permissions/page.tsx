import { Shield } from "lucide-react";

export default function OrganizationPermissionPage() {
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Fine-grained roles (admin, developer, billing, etc.) will land here. Today, the owner can invite members;
        everyone in the org is a full member for workspace access.
      </p>
      <div className="glass-panel rounded-2xl border border-dashed border-border/80 p-10 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-muted/50">
          <Shield className="size-8 text-muted-foreground" aria-hidden />
        </div>
        <h2 className="mt-6 text-lg font-semibold text-foreground">Coming soon</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Planned: role templates, resource-level rules, and integration with audit log for permission changes.
        </p>
      </div>
    </div>
  );
}
