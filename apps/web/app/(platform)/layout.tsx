"use client";

import { AppLayout } from "@/components/layout/AppLayout";

/**
 * Keeps Sidebar + main shell mounted across client navigations so scroll positions
 * (sidebar nav and main content) are preserved. Previously each page wrapped itself
 * in AppLayout, which remounted the shell on every route change.
 *
 * This layout is a Client Component so Turbopack can instantiate `AppLayout` reliably
 * (avoids "module factory is not available" when a Server layout imported only client UI).
 */
export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppLayout>{children}</AppLayout>;
}
