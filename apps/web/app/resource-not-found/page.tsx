import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function ResourceNotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 text-center">
      <ShieldAlert className="w-20 h-20 text-muted-foreground mb-6 opacity-60" aria-hidden />
      <h1 className="text-4xl font-bold mb-4 text-foreground">Page not found</h1>
      <p className="text-xl text-muted-foreground mb-8 max-w-xl">
        This item does not exist or you do not have access to it.
      </p>
      <Link href="/" className="btn-primary inline-flex items-center justify-center">
        Return to dashboard
      </Link>
    </div>
  );
}
