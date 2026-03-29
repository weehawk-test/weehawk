"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { logoutApi, type AuthResponse } from "@/lib/auth-api";
import { AUTH_CHANGE_EVENT, AUTH_STORAGE_KEY } from "@/lib/auth-fetch";

export type AuthUser = {
  email: string;
  firstName: string;
  lastName: string;
};

type AuthContextValue = {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  /** Always true: session is read synchronously from storage on the client. */
  isReady: boolean;
  setSession: (res: AuthResponse) => void;
  updateUser: (patch: Partial<Pick<AuthUser, "firstName" | "lastName">>) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function parseRaw(raw: string): {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
} {
  if (!raw) return { accessToken: null, refreshToken: null, user: null };
  try {
    const parsed = JSON.parse(raw) as {
      accessToken?: string;
      refreshToken?: string;
      user?: AuthUser;
    };
    return {
      accessToken: parsed.accessToken ?? null,
      refreshToken: parsed.refreshToken ?? null,
      user: parsed.user ?? null,
    };
  } catch {
    return { accessToken: null, refreshToken: null, user: null };
  }
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === AUTH_STORAGE_KEY || e.key === null) onStoreChange();
  };
  const onLocal = () => onStoreChange();
  window.addEventListener("storage", onStorage);
  window.addEventListener(AUTH_CHANGE_EVENT, onLocal);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(AUTH_CHANGE_EVENT, onLocal);
  };
}

function getSnapshot(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(AUTH_STORAGE_KEY) ?? "";
}

function getServerSnapshot(): string {
  return "";
}

function notifyAuthChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { accessToken, refreshToken, user } = useMemo(() => parseRaw(raw), [raw]);

  const setSession = useCallback((res: AuthResponse) => {
    const u: AuthUser = {
      email: res.email,
      firstName: res.firstName,
      lastName: res.lastName,
    };
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
        user: u,
      }),
    );
    notifyAuthChanged();
  }, []);

  const updateUser = useCallback(
    (patch: Partial<Pick<AuthUser, "firstName" | "lastName">>) => {
      try {
        const prev = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!prev) return;
        const parsed = JSON.parse(prev) as {
          accessToken?: string;
          refreshToken?: string;
          user?: AuthUser;
        };
        if (!parsed.user) return;
        const next = { ...parsed.user, ...patch };
        localStorage.setItem(
          AUTH_STORAGE_KEY,
          JSON.stringify({
            ...parsed,
            user: next,
          }),
        );
        notifyAuthChanged();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    let rt: string | null = null;
    let em: string | undefined;
    try {
      const prev = localStorage.getItem(AUTH_STORAGE_KEY);
      if (prev) {
        const parsed = JSON.parse(prev) as { refreshToken?: string; user?: AuthUser };
        rt = parsed.refreshToken ?? null;
        em = parsed.user?.email;
      }
    } catch {
      /* ignore */
    }
    localStorage.removeItem(AUTH_STORAGE_KEY);
    notifyAuthChanged();
    if (rt) {
      try {
        await logoutApi(rt, em);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const value = useMemo(
    () => ({
      accessToken,
      refreshToken,
      user,
      isReady: true,
      setSession,
      updateUser,
      logout,
    }),
    [accessToken, refreshToken, user, setSession, updateUser, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/**
 * Redirects to `/auth` when there is no session.
 * After a full reload, `useSyncExternalStore` can briefly expose an empty session during
 * hydration while localStorage already has tokens — redirecting immediately would send the user
 * to `/auth`, then the auth page would see the token and send them to `/`. We defer one tick and
 * re-read storage before redirecting.
 */
export function useRequireAuth() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (pathname === "/auth") return;
    const id = window.setTimeout(() => {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY) ?? "";
      const session = parseRaw(raw);
      if (!session.accessToken) {
        router.replace("/auth");
      }
    }, 0);
    return () => clearTimeout(id);
  }, [accessToken, pathname, router]);

  return { accessToken, isReady: true, allowed: Boolean(accessToken) };
}
