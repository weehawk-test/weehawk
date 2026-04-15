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
import { API_BASE } from "@/lib/api";
import { getProfile } from "@/lib/user-api";
import { logoutApi } from "@/lib/auth-api";
import {
  AUTH_CHANGE_EVENT,
  COOKIE_SESSION_MARKER,
  notifyAuthChanged,
} from "@/lib/auth-storage";

export type AuthUser = {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  provider?: "LOCAL" | "GOOGLE";
  emailVerified?: boolean;
  imageUrl?: string | null;
};

export type AuthSessionInput = {
  userId: number;
  email: string;
  firstName: string;
  lastName: string;
  provider?: "LOCAL" | "GOOGLE";
  emailVerified?: boolean;
  imageUrl?: string | null;
};

type AuthContextValue = {
  /** `"cookie-session"` when the API session cookie is present; legacy call sites still pass this into `authFetch`. */
  accessToken: string | null;
  user: AuthUser | null;
  isReady: boolean;
  setSession: (res: AuthSessionInput) => void;
  /** Refetch profile from the API and update local user state. */
  refreshSession: () => Promise<void>;
  updateUser: (
    patch: Partial<
      Pick<AuthUser, "firstName" | "lastName" | "emailVerified" | "imageUrl" | "provider">
    >,
  ) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  children,
  initialUser,
}: {
  children: ReactNode;
  /** From RootLayout SSR (`/api/user/profile`) when cookies are visible to the Next server. */
  initialUser: AuthUser | null;
}) {
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    initialUser ? COOKIE_SESSION_MARKER : null,
  );
  const [user, setUser] = useState<AuthUser | null>(initialUser);
  const [isReady, setIsReady] = useState(false);

  const applyProfile = useCallback((p: {
    userId: number;
    email: string;
    firstName: string;
    lastName: string;
    provider: "LOCAL" | "GOOGLE";
    emailVerified: boolean;
    imageUrl: string | null;
  }) => {
    setUser({
      userId: p.userId,
      email: p.email,
      firstName: p.firstName,
      lastName: p.lastName,
      provider: p.provider,
      emailVerified: p.emailVerified,
      imageUrl: p.imageUrl,
    });
    setAccessToken(COOKIE_SESSION_MARKER);
  }, []);

  const clearLocal = useCallback(() => {
    setUser(null);
    setAccessToken(null);
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/user/profile`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (r.ok) {
        applyProfile(await r.json());
      } else {
        clearLocal();
      }
    } catch {
      clearLocal();
    }
  }, [applyProfile, clearLocal]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await bootstrap();
      if (!cancelled) setIsReady(true);
    })();

    const onAuthChange = () => {
      void bootstrap().then(() => {
        if (!cancelled) setIsReady(true);
      });
    };
    window.addEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_CHANGE_EVENT, onAuthChange);
    };
  }, [bootstrap]);

  const refreshSession = useCallback(async () => {
    try {
      const profile = await getProfile();
      applyProfile(profile);
    } catch {
      clearLocal();
    }
  }, [applyProfile, clearLocal]);

  const setSession = useCallback((res: AuthSessionInput) => {
    setUser({
      userId: res.userId,
      email: res.email,
      firstName: res.firstName,
      lastName: res.lastName,
      provider: res.provider,
      emailVerified: res.emailVerified ?? false,
      imageUrl: res.imageUrl ?? null,
    });
    setAccessToken(COOKIE_SESSION_MARKER);
  }, []);

  const updateUser = useCallback(
    (
      patch: Partial<
        Pick<AuthUser, "firstName" | "lastName" | "emailVerified" | "imageUrl" | "provider">
      >,
    ) => {
      setUser((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    [],
  );

  const logout = useCallback(async () => {
    try {
      await logoutApi();
    } catch {
      // ignore logout network/server errors and clear local session anyway
    }
    clearLocal();
    notifyAuthChanged();
  }, [clearLocal]);

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
 * Waits until the cookie probe against `/api/user/profile` has finished.
 */
export function useRequireAuth() {
  const { accessToken, user, isReady } = useAuth();
  // If SSR already provided a user, allow rendering immediately to avoid
  // layout flash while the client-side profile probe finishes.
  return { accessToken, isReady, allowed: Boolean(user) };
}
