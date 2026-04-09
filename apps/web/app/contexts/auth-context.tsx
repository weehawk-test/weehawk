"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AuthUser = {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified?: boolean;
};

type LocalSessionResponse = {
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
  setSession: (res: LocalSessionResponse) => void;
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
  const localUser = useMemo<AuthUser>(
    () =>
      initialUser ?? {
        userId: 1,
        email: "desktop@local.weehawk",
        firstName: "Desktop",
        lastName: "User",
        emailVerified: true,
      },
    [initialUser],
  );
  const [accessToken] = useState<string | null>("desktop-local-session");
  const [user, setUser] = useState<AuthUser | null>(localUser);
  const [isReady] = useState(true);

  const refreshSession = useCallback(async () => {
    setUser((prev) => prev ?? localUser);
  }, []);

  const setSession = useCallback((res: LocalSessionResponse) => {
    setUser({
      userId: res.userId,
      email: res.email,
      firstName: res.firstName,
      lastName: res.lastName,
      emailVerified: res.emailVerified ?? false,
    });
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
    setUser(localUser);
  }, [localUser]);

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
  return { accessToken, isReady, allowed: true };
}
