"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { exchangeGithubManifest } from "@/lib/git-api";

type Status = "idle" | "working" | "ok" | "error";

export function GithubCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    const code = searchParams.get("code");
    const organizationPublicId = searchParams.get("organizationPublicId")?.trim() ?? "";
    if (!code?.trim()) {
      ran.current = true;
      setStatus("error");
      setMessage("Missing ?code= from GitHub. Close this tab and try creating the app again.");
      return;
    }
    if (!organizationPublicId) {
      ran.current = true;
      setStatus("error");
      setMessage(
        "Missing organization in the callback URL. Register the app again from Git → GitHub in your organization workspace.",
      );
      return;
    }
    if (!accessToken) return;

    const dedupeKey = `github_manifest_exchange:${code.trim()}`;
    if (typeof window !== "undefined" && sessionStorage.getItem(dedupeKey) === "1") {
      ran.current = true;
      setStatus("ok");
      router.replace("/git");
      return;
    }

    ran.current = true;
    setStatus("working");

    void (async () => {
      try {
        if (typeof window !== "undefined") sessionStorage.setItem(dedupeKey, "1");
        const next = await exchangeGithubManifest(accessToken, organizationPublicId, code.trim());
        const nextInstallUrl = next.github.installAppUrl?.trim() || "";
        setInstallUrl(nextInstallUrl || null);
        setStatus("ok");
        toast({ title: "GitHub App connected", description: "Credentials were saved to Weehawk." });
        if (nextInstallUrl && typeof window !== "undefined") {
          window.location.assign(nextInstallUrl);
          return;
        }
        router.replace("/git");
      } catch (e) {
        if (typeof window !== "undefined") sessionStorage.removeItem(dedupeKey);
        setStatus("error");
        const msg = e instanceof Error ? e.message : String(e);
        setMessage(msg);
        toast({
          title: "Could not complete GitHub App setup",
          description: msg,
          variant: "destructive",
        });
      }
    })();
  }, [accessToken, searchParams, router, toast]);

  return (
    <div className="max-w-md mx-auto py-16 px-4 text-center space-y-6">
      {status === "working" || status === "idle" ? (
        <>
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Finishing GitHub App registration…</p>
        </>
      ) : null}
      {status === "ok" ? (
        <>
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
          <p className="text-sm text-muted-foreground">Redirecting to GitHub app installation…</p>
          {installUrl ? (
            <a
              href={installUrl}
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              احتياط: إذا لم يتم التحويل تلقائيًا، اضغط هنا لإكمال التثبيت
            </a>
          ) : null}
        </>
      ) : null}
      {status === "error" ? (
        <>
          <XCircle className="w-12 h-12 text-destructive/80 mx-auto" />
          <p className="text-sm text-destructive/90">{message ?? "Something went wrong."}</p>
          <Link
            href="/git"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ArrowLeft className="w-4 h-4" /> Back to GitHub settings
          </Link>
        </>
      ) : null}
    </div>
  );
}
