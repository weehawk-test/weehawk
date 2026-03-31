import { AppLayout } from "@/components/layout/AppLayout";

/**
 * Keeps Sidebar + main shell mounted across client navigations so scroll positions
 * (sidebar nav and main content) are preserved. Previously each page wrapped itself
 * in AppLayout, which remounted the shell on every route change.
 */
export default function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppLayout>{children}</AppLayout>;
}
