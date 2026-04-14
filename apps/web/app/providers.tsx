"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/components/confirm/ConfirmProvider";
import { PageTitleManager } from "@/components/seo/page-title-manager";
import { AuthProvider, type AuthUser } from "@/contexts/auth-context";
import { ThemeProvider } from "@/contexts/theme-context";

export function Providers({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  initialUser: AuthUser | null;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: Infinity,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider initialUser={initialUser}>
          <TooltipProvider>
            <ConfirmProvider>
              <PageTitleManager />
              {children}
              <Toaster />
            </ConfirmProvider>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
