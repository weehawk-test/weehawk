"use client";

import Link from "next/link";
import { Plus } from "lucide-react";

export function NotificationsTabs() {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-10">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">Notifications</h1>
        <p className="text-muted-foreground">
          Manage channels. Delivery and tests run only on deploy servers over SSH.
        </p>
      </div>
      <Link href="/notifications/create" className="btn-primary flex w-full items-center justify-center gap-2 md:w-auto">
        <Plus className="w-5 h-5" />
        Add Channel
      </Link>
    </div>
  );
}
