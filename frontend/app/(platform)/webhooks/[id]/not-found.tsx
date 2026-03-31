import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function WebhookNotFound() {
  return (
    <>
      <div className="text-center mt-20">
        <ShieldAlert className="w-16 h-16 text-destructive mx-auto mb-4" />
        <h2 className="text-2xl font-bold mb-2">Trigger not found</h2>
        <p className="text-muted-foreground mb-6">
          It may have been deleted or you may not have access.
        </p>
        <Link href="/webhooks">
          <button type="button" className="btn-primary">Back to webhooks</button>
        </Link>
      </div>
    </>
  );
}
