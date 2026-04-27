import { AppLayout } from "@/components/layout/AppLayout";
import { cookies } from "next/headers";

/**
 * Keeps Sidebar + main shell mounted across client navigations. The sidebar scroll
 * position is preserved; the main column scrolls back to the top on each route change
 * (scroll lives on `main`, not the document). Previously each page wrapped itself in
 * AppLayout, which remounted the shell on every route change.
 *
 * This layout is a Client Component so Turbopack can instantiate `AppLayout` reliably
 * (avoids "module factory is not available" when a Server layout imported only client UI).
 */
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const initialSidebarCollapsed = cookieStore.get("weehawk-sidebar-collapsed")?.value === "1";
  const initialMobileNavOpen = cookieStore.get("weehawk-sidebar-mobile-open")?.value === "1";
  return (
    <AppLayout
      initialSidebarCollapsed={initialSidebarCollapsed}
      initialMobileNavOpen={initialMobileNavOpen}
    >
      {children}
    </AppLayout>
  );
}
