"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/**
 * URL sync without `useSearchParams()` (which suspends and causes full-route flashes).
 * `urlPage` / `urlQ` come from the Server Component via `searchParams`.
 * `persistentParams` are always re-applied (e.g. `server` on `/secrets`).
 */
export function useDockerListUrl(
  urlPage: number,
  urlQ: string,
  persistentParams?: Record<string, string | undefined>,
) {
  const router = useRouter();
  const pathname = usePathname();
  const [page, setPageState] = useState(urlPage);
  const [q, setQ] = useState(urlQ);
  const [localQ, setLocalQ] = useState(urlQ);

  useEffect(() => {
    setPageState(urlPage);
    setQ(urlQ);
    setLocalQ(urlQ);
  }, [urlQ]);

  useEffect(() => {
    setPageState(urlPage);
  }, [urlPage]);

  const updateUrl = useCallback(
    (nextPage: number, nextQ: string, mode: "replace" | "push") => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams();
      if (persistentParams) {
        for (const [key, val] of Object.entries(persistentParams)) {
          if (val != null && val !== "") params.set(key, val);
        }
      }
      const trimmed = nextQ.trim();
      if (trimmed) params.set("q", trimmed);
      params.set("page", String(Math.max(1, nextPage)));
      const next = `${pathname}?${params.toString()}`;
      if (mode === "replace") window.history.replaceState(window.history.state, "", next);
      else window.history.pushState(window.history.state, "", next);
    },
    [pathname, persistentParams],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      const trimmed = localQ.trim();
      if (trimmed === q.trim()) return;
      setQ(trimmed);
      setPageState(1);
      updateUrl(1, trimmed, "replace");
    }, 400);
    return () => window.clearTimeout(t);
  }, [localQ, q, updateUrl]);

  const setPage = useCallback(
    (next: number) => {
      const n = Math.max(1, next);
      setPageState(n);
      const nextQ = localQ.trim();
      setQ(nextQ);
      updateUrl(n, nextQ, "push");
    },
    [localQ, updateUrl],
  );

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  return {
    page,
    q,
    localQ,
    setLocalQ,
    setPage,
    refresh,
  };
}
