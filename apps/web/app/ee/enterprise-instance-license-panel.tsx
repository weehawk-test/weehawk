"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { PasswordInput } from "@/components/inputs/password-input";
import {
  getInstanceEnterpriseLicenseState,
  updateInstanceEnterpriseLicenseKey,
  type InstanceEnterpriseLicenseState,
} from "@/lib/instance-enterprise-license-api";
import { notifyOrganizationsListChanged } from "@/lib/organizations-api";
import { parseEnterpriseSalesUrl } from "@/lib/weehawk-enterprise";

type Props = {
  /** From SSR: when set and non-null, first paint skips client fetch. */
  initialState?: InstanceEnterpriseLicenseState | null;
};

export function EnterpriseInstanceLicensePanel({ initialState }: Props) {
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(() => !initialState);
  const [licensed, setLicensed] = useState(() => initialState?.licensed ?? false);
  const [salesUrl, setSalesUrl] = useState(() => initialState?.salesUrl ?? "");
  const [hasStoredLicenseKey, setHasStoredLicenseKey] = useState(
    () => Boolean(initialState?.hasStoredLicenseKey),
  );
  const [signedLicenseEnforced, setSignedLicenseEnforced] = useState(
    () => initialState?.signedLicenseEnforced ?? false,
  );
  const [canManage, setCanManage] = useState(
    () => initialState?.canManageInstanceLicense ?? false,
  );
  const [licenseKeyDraft, setLicenseKeyDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const s = await getInstanceEnterpriseLicenseState(accessToken);
        setLicensed(s.licensed);
        setSalesUrl(s.salesUrl);
        setSignedLicenseEnforced(s.signedLicenseEnforced);
        setCanManage(s.canManageInstanceLicense);
        setHasStoredLicenseKey(Boolean(s.hasStoredLicenseKey));
      } catch (err) {
        toast({
          title: "Could not load license status",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    },
    [accessToken, toast],
  );

  useEffect(() => {
    if (initialState) return;
    void load();
  }, [initialState, load]);

  const href = parseEnterpriseSalesUrl(salesUrl);
  const draftTrim = licenseKeyDraft.trim();
  const saveDisabled =
    saving ||
    loading ||
    !signedLicenseEnforced ||
    !draftTrim.startsWith("whl1.") ||
    draftTrim.length < 20;

  const onSave = async () => {
    const key = licenseKeyDraft.trim();
    if (!signedLicenseEnforced) {
      toast({
        title: "API not configured",
        description:
          "Set WEEHAWK_ENTERPRISE_LICENSE_PUBLIC_KEY on the API server first. Only vendor-signed tokens (whl1…) are accepted.",
        variant: "destructive",
      });
      return;
    }
    if (!key.startsWith("whl1.") || key.length < 20) {
      toast({
        title: "Invalid key",
        description: "Paste a vendor-signed license token (starts with whl1.).",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const r = await updateInstanceEnterpriseLicenseKey(accessToken, key);
      setLicensed(r.licensed);
      setLicenseKeyDraft("");
      await load({ silent: true });
      notifyOrganizationsListChanged();
      toast({ title: "License updated", description: r.message });
    } catch (err) {
      toast({
        title: "Could not save license key",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async () => {
    setRemoving(true);
    try {
      const r = await updateInstanceEnterpriseLicenseKey(accessToken, "");
      setLicensed(r.licensed);
      setLicenseKeyDraft("");
      await load({ silent: true });
      notifyOrganizationsListChanged();
      toast({ title: "License key removed", description: r.message });
    } catch (err) {
      toast({
        title: "Could not remove license key",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 min-h-[1.5rem]">
        {loading ? (
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
            Checking license…
          </span>
        ) : (
          <>
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                licensed
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : "bg-amber-500/15 text-amber-800 dark:text-amber-400"
              }`}
            >
              {licensed ? "Licensed" : "Not licensed"}
            </span>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Need a license?{" "}
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Contact us
        </Link>
      </p>

      {!loading && !canManage ? (
        <p className="text-sm text-muted-foreground leading-relaxed">
          Only instance administrators (ADMIN) can save or remove the license key for this deployment.
        </p>
      ) : null}

      {!loading && canManage ? (
        <>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground" htmlFor="instance-enterprise-license-key">
              License key
            </label>
            <PasswordInput
              id="instance-enterprise-license-key"
              value={licenseKeyDraft}
              onChange={(e) => setLicenseKeyDraft(e.target.value)}
              disabled={!signedLicenseEnforced}
              placeholder={
                signedLicenseEnforced
                  ? "Paste signed license (whl1…)"
                  : "Set WEEHAWK_ENTERPRISE_LICENSE_PUBLIC_KEY on the API first"
              }
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <button
              type="button"
              disabled={saveDisabled}
              onClick={() => void onSave()}
              className="btn-primary inline-flex h-9 items-center justify-center gap-2 px-3 text-sm font-medium disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Save license key
            </button>
            {hasStoredLicenseKey ? (
              <button
                type="button"
                disabled={removing}
                onClick={() => void onRemove()}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-border/80 bg-background px-3 text-sm font-medium text-foreground shadow-sm hover:bg-muted/50 transition-colors disabled:opacity-60"
              >
                {removing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Remove stored key
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
