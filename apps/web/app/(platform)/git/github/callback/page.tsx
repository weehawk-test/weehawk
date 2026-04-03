import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { GithubCallbackClient } from "./github-callback-client";

export default function GithubGitCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[35vh] flex-col items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="w-9 h-9 animate-spin" />
          <p className="text-sm">Loading…</p>
        </div>
      }
    >
      <GithubCallbackClient />
    </Suspense>
  );
}
