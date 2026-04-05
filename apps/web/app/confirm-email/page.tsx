import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ConfirmEmailContent } from "./confirm-email-content";

export default function ConfirmEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      }
    >
      <ConfirmEmailContent />
    </Suspense>
  );
}
