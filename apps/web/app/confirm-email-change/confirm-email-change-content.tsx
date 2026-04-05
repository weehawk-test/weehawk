"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { confirmEmailChange } from "@/lib/auth-api";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Button } from "@/components/ui/button";

export function ConfirmEmailChangeContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "done">("loading");
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus("done");
      setMessage("Missing token.");
      setOk(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await confirmEmailChange(token);
        if (cancelled) return;
        setStatus("done");
        setMessage(res.message);
        setOk(true);
      } catch (e) {
        if (cancelled) return;
        setStatus("done");
        setMessage(e instanceof Error ? e.message : "Request failed.");
        setOk(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) {
    return (
      <AuthPageShell subtitle="Invalid link">
        <p className="text-sm text-center text-muted-foreground">Missing token.</p>
        <Button asChild className="w-full mt-4">
          <Link href="/">Back to sign in</Link>
        </Button>
      </AuthPageShell>
    );
  }

  if (status === "loading") {
    return (
      <AuthPageShell subtitle="Updating your email…">
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell subtitle={ok ? "Email updated" : "Something went wrong"}>
      <p className="text-sm text-center text-muted-foreground">{message}</p>
      <Button asChild className="w-full mt-4">
        <Link href="/">{ok ? "Sign in again" : "Back to sign in"}</Link>
      </Button>
    </AuthPageShell>
  );
}
