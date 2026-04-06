"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { logoutApi, type AuthResponse } from "@/lib/auth-api";
import { AUTH_CHANGE_EVENT } from "@/lib/auth-fetch";
import { getProfile } from "@/lib/user-api";

export type AuthUser = {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified?: boolean;
};

type AuthContextValue = {
  accessToken: string | null;
  user: AuthUser | null;
  isReady: boolean;
  setSession: (res: AuthResponse) => void;
  /** Refetch profile from the API (cookies) and update local user state. */
  refreshSession: () => Promise<void>;
  updateUser: (
    patch: Partial<Pick<AuthUser, "firstName" | "lastName" | "emailVerified">>,
  ) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  initialUser,
}: {
  children: ReactNode;
  /** From RootLayout SSR (`/api/user/profile`) — avoids a client-side profile fetch on load. */
  initialUser: AuthUser | null;
}) {
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    initialUser ? "cookie-session" : null,
  );
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [isReady] = useState(true);

  const refreshSession = useCallback(async () => {
    try {
      const profile = await getProfile("cookie-session");
      setAccessToken("cookie-session");
      setUser({
        userId: profile.userId,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        emailVerified: profile.emailVerified ?? false,
      });
    } catch {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const onLocal = () => void refreshSession();
    window.addEventListener(AUTH_CHANGE_EVENT, onLocal);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, onLocal);
  }, [refreshSession]);

  const setSession = useCallback((res: AuthResponse) => {
    setAccessToken("cookie-session");
    setUser({
      userId: res.userId,
      email: res.email,
      firstName: res.firstName,
      lastName: res.lastName,
      emailVerified: res.emailVerified ?? false,
    });
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
  }, []);

  const updateUser = useCallback(
    (
      patch: Partial<
        Pick<AuthUser, "firstName" | "lastName" | "emailVerified">
      >,
    ) => {
      setUser((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    [],
  );

  const logout = useCallback(async () => {
    const email = user?.email;
    try {
      await logoutApi(email);
    } catch {
      /* ignore */
    } finally {
      setAccessToken(null);
      setUser(null);
      window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    }
  }, [user?.email]);

  const value = useMemo(
    () => ({
      accessToken,
      user,
      isReady,
      setSession,
      refreshSession,
      updateUser,
      logout,
    }),
    [accessToken, user, isReady, setSession, refreshSession, updateUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * Redirects to `/` when there is no session (sign-in UI is at `/`).
 * After a full reload, `useSyncExternalStore` can briefly expose an empty session during
 * hydration while localStorage already has tokens — redirecting immediately would send the user
 * to `/` or `/register`, then that page would see the token and send them to `/`. We defer one tick and
 * re-read storage before redirecting.
 */
export function useRequireAuth() {
  const { accessToken, isReady } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/" || pathname === "/register") return;
    if (!isReady) return;
    if (!accessToken) router.replace("/");
  }, [accessToken, isReady, pathname, router]);

  return { accessToken, isReady, allowed: Boolean(accessToken) };
}
