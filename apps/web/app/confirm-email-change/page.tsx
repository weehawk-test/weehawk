"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { confirmEmailChange } from "@/lib/user-api";

type ConfirmState = "loading" | "success" | "error";

export default function ConfirmEmailChangePage() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);
  const [state, setState] = useState<ConfirmState>("loading");
  const [message, setMessage] = useState("Confirming your new email...");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!token) {
        if (cancelled) return;
        setState("error");
        setMessage("Missing email change token.");
        return;
      }
      try {
        const result = await confirmEmailChange(token);
        if (cancelled) return;
        setState("success");
        setMessage(result.message || "Email changed successfully.");
      } catch (err) {
        if (cancelled) return;
        setState("error");
        setMessage(err instanceof Error ? err.message : "Could not confirm email change.");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-background">
      <div className="fixed top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md glass-panel rounded-2xl p-6 space-y-6">
        <div className="flex flex-col items-center text-center">
          <div className="relative w-14 h-14 rounded-2xl overflow-hidden border border-primary/20 shadow-sm ring-1 ring-border/70 mb-3">
            <Image
              src="/weehawk-logo.svg"
              alt="Weehawk"
              width={56}
              height={56}
              className="logo-adaptive object-contain size-14 p-1 scale-90"
              priority
            />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Confirm email change</h1>
          <p className="text-sm text-muted-foreground mt-1">{message}</p>
        </div>

        {state === "loading" ? (
          <div className="flex justify-center py-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Link href="/login" className="btn-primary w-full text-center">
            Go to sign in
          </Link>
          <Link href="/" className="btn-secondary w-full text-center">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
