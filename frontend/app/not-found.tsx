"use client";

import Link from "next/link";
import { AppLayout } from "@/components/layout/AppLayout";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <AppLayout>
      <div className="flex flex-col items-center justify-center min-h-[70vh] text-center">
        <AlertCircle className="w-20 h-20 text-muted-foreground mb-6 opacity-50" />
        <h1 className="text-4xl font-bold mb-4">404 - Page Not Found</h1>
        <p className="text-xl text-muted-foreground mb-8 max-w-md">
          The page you are looking for doesn't exist or has been moved.
        </p>
        <Link href="/">
          <button className="btn-primary">
            Return to Dashboard
          </button>
        </Link>
      </div>
    </AppLayout>
  );
}
