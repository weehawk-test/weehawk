import { Settings } from "lucide-react";

export default function OrganizationSettingsPage() {
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Organization name, billing, and danger zone actions will live here.
      </p>
      <div className="glass-panel rounded-2xl border border-dashed border-border/80 p-10 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-muted/50">
          <Settings className="size-8 text-muted-foreground" aria-hidden />
        </div>
        <h2 className="mt-6 text-lg font-semibold text-foreground">Coming soon</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          You will be able to update org profile, transfer ownership, and leave or delete the organization when this
          ships.
        </p>
      </div>
    </div>
  );
}
