import Link from "next/link";
import { AlertCircle } from "lucide-react";

/** Full-page 404 for invalid `/docker-manager/...` hosts (e.g. `local`). Rendered outside `(platform)` so no sidebar. */
export default function ConsoleNotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 text-center">
      <AlertCircle className="w-20 h-20 text-muted-foreground mb-6 opacity-50" aria-hidden />
      <h1 className="text-4xl font-bold mb-4 text-foreground">404 — Page not found</h1>
      <p className="text-xl text-muted-foreground mb-8 max-w-md">
        This console host does not exist or is not available.
      </p>
      <Link href="/" className="btn-primary inline-flex items-center justify-center">
        Return Home
      </Link>
    </div>
  );
}
