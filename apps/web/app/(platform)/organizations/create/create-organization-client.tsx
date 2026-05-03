"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Type, X } from "lucide-react";
import { createOrganization } from "@/lib/organizations-api";
import { setActiveOrganizationPublicBrowserCookie } from "@/lib/active-org-cookie";

export function CreateOrganizationClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const closeModal = () => {
    if (saving) return;
    router.push("/");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const org = await createOrganization({
        name: name.trim(),
      });
      setActiveOrganizationPublicBrowserCookie(org.publicId);
      router.replace("/projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create organization");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] overflow-y-auto modal-scrim" onClick={closeModal}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="max-w-2xl w-full py-8" onClick={(e) => e.stopPropagation()}>
          <div className="glass-panel p-6 md:p-8 rounded-2xl relative overflow-hidden">
            <div className="mb-6 flex items-center justify-between gap-3">
              <h1 className="text-2xl font-bold text-foreground">Create organization</h1>
              <button
                type="button"
                aria-label="Close"
                onClick={closeModal}
                disabled={saving}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={onSubmit} className="space-y-6 relative z-10">
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="org-create-name"
                    className="flex items-center gap-2 text-sm font-medium text-foreground mb-1.5"
                  >
                    <Type className="w-4 h-4 text-primary" />
                    Name
                  </label>
                  <input
                    id="org-create-name"
                    className="input-field w-full"
                    value={name}
                    onChange={(ev) => setName(ev.target.value)}
                    placeholder="e.g. Weehawk org"
                    autoComplete="organization"
                    required
                    maxLength={200}
                  />
                </div>
              </div>

              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" className="btn-secondary" disabled={saving} onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                      Creating…
                    </>
                  ) : (
                    "Create organization"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
