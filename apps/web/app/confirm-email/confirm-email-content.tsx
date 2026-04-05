"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { confirmEmail } from "@/lib/auth-api";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { Button } from "@/components/ui/button";

export function ConfirmEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "ok" | "err">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("err");
      setMessage("Missing confirmation token.");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await confirmEmail(token);
        if (cancelled) return;
        setStatus("ok");
        setMessage(res.message);
      } catch (e) {
        if (cancelled) return;
        setStatus("err");
        setMessage(e instanceof Error ? e.message : "Confirmation failed.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!token) {
    return (
      <AuthPageShell subtitle="Invalid link">
        <p className="text-sm text-center text-muted-foreground">Missing confirmation token.</p>
        <Button asChild className="w-full mt-4">
          <Link href="/">Back to sign in</Link>
        </Button>
      </AuthPageShell>
    );
  }

  if (status === "loading") {
    return (
      <AuthPageShell subtitle="Confirming your email…">
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell subtitle={status === "ok" ? "Email confirmed" : "Could not confirm"}>
      <p className="text-sm text-center text-muted-foreground">{message}</p>
      <Button asChild className="w-full mt-4">
        <Link href="/">Back to sign in</Link>
      </Button>
    </AuthPageShell>
  );
}
