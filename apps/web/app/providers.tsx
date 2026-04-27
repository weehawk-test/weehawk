"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/components/confirm/ConfirmProvider";
import { AuthProvider, type AuthUser, useAuth } from "@/contexts/auth-context";
import { ThemeProvider } from "@/contexts/theme-context";

const queryClientDefaults = {
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    },
  },
} as const;

/**
 * One QueryClient per authenticated user (or shared "anon" scope when logged out).
 * When `userId` changes, React creates a new client — the previous user's in-memory cache
 * is not reused, which matches TanStack Query guidance for multi-tenant / auth boundaries.
 * This is stronger than `queryClient.clear()` alone because isolation is structural.
 *
 * @see https://tanstack.com/query/latest/docs/framework/react/guides/ssr#initial-setup
 */
function UserScopedQueryClientProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const scopeKey = user?.userId != null ? `u:${user.userId}` : "anon";

  const queryClient = useMemo(
    () => new QueryClient({ ...queryClientDefaults }),
    [scopeKey],
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** RSC payloads and `initialUser` in the layout are not React Query; refresh when identity changes. */
function RefreshRscOnAuthChange() {
  const { user } = useAuth();
  const router = useRouter();
  const prevUserIdRef = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    const id = user?.userId ?? null;
    if (prevUserIdRef.current === undefined) {
      prevUserIdRef.current = id;
      return;
    }
    if (prevUserIdRef.current !== id) {
      prevUserIdRef.current = id;
      void router.refresh();
    }
  }, [user?.userId, router]);

  return null;
}

export function Providers({
  children,
  initialUser,
  initialTheme,
}: {
  children: React.ReactNode;
  initialUser: AuthUser | null;
  initialTheme: "light" | "dark";
}) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      <AuthProvider initialUser={initialUser}>
        <UserScopedQueryClientProvider>
          <RefreshRscOnAuthChange />
          <TooltipProvider>
            <ConfirmProvider>
              {children}
              <Toaster />
            </ConfirmProvider>
          </TooltipProvider>
        </UserScopedQueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
