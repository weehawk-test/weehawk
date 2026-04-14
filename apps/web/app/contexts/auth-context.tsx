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
import { getProfile } from "@/lib/user-api";
import { logoutApi } from "@/lib/auth-api";
import {
  AUTH_CHANGE_EVENT,
  clearStoredSession,
  readStoredSession,
  type StoredAuthUser,
  writeStoredSession,
} from "@/lib/auth-storage";

export type AuthUser = {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified?: boolean;
  imageUrl?: string | null;
};

type LocalSessionResponse = {
  accessToken: string;
  refreshToken: string;
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified?: boolean;
  imageUrl?: string | null;
};

type AuthContextValue = {
  accessToken: string | null;
  user: AuthUser | null;
  isReady: boolean;
  setSession: (res: LocalSessionResponse) => void;
  /** Refetch profile from the API (cookies) and update local user state. */
  refreshSession: () => Promise<void>;
  updateUser: (
    patch: Partial<Pick<AuthUser, "firstName" | "lastName" | "emailVerified" | "imageUrl">>,
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
  // Keep server/client initial render deterministic to avoid hydration mismatch.
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [isReady, setIsReady] = useState(false);

  const syncFromStorage = useCallback(() => {
    const session = readStoredSession();
    if (!session) {
      setAccessToken(null);
      setUser(null);
      return;
    }
    setAccessToken(session.accessToken);
    setUser(session.user);
  }, []);

  useEffect(() => {
    syncFromStorage();
    setIsReady(true);
    const onAuthChange = () => syncFromStorage();
    window.addEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    return () => window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChange);
  }, [syncFromStorage]);

  const refreshSession = useCallback(async () => {
    if (!accessToken) {
      setUser(null);
      return;
    }
    const profile = await getProfile(accessToken);
    const stored = readStoredSession();
    const nextUser: StoredAuthUser = {
      userId: profile.userId,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      emailVerified: profile.emailVerified,
      imageUrl: profile.imageUrl,
    };
    if (stored) {
      writeStoredSession({
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
        user: nextUser,
      });
    }
    setUser(nextUser);
  }, [accessToken]);

  const setSession = useCallback((res: LocalSessionResponse) => {
    const nextUser: StoredAuthUser = {
      userId: res.userId,
      email: res.email,
      firstName: res.firstName,
      lastName: res.lastName,
      emailVerified: res.emailVerified ?? false,
      imageUrl: res.imageUrl ?? null,
    };
    writeStoredSession({
      accessToken: res.accessToken,
      refreshToken: res.refreshToken,
      user: nextUser,
    });
    setAccessToken(res.accessToken);
    setUser(nextUser);
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
    const session = readStoredSession();
    if (session?.accessToken && session.refreshToken) {
      try {
        await logoutApi({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
        });
      } catch {
        // ignore logout network/server errors and clear local session anyway
      }
    }
    clearStoredSession();
    setAccessToken(null);
    setUser(null);
  }, []);

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
  const { accessToken, user, isReady } = useAuth();
  return { accessToken, isReady, allowed: Boolean(accessToken || user) };
}
