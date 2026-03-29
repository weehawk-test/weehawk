"use client";

import { useRouter, usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

/**
 * URL sync without `useSearchParams()` (which suspends and causes full-route flashes).
 * `urlPage` / `urlQ` come from the Server Component via `searchParams`.
 */
export function useDockerListUrl(urlPage: number, urlQ: string) {
  const router = useRouter();
  const pathname = usePathname();
  const [localQ, setLocalQ] = useState(urlQ);

  useEffect(() => {
    setLocalQ(urlQ);
  }, [urlQ]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const trimmed = localQ.trim();
      if (trimmed === urlQ.trim()) return;
      const params = new URLSearchParams();
      if (trimmed) params.set("q", trimmed);
      params.set("page", "1");
      router.replace(`${pathname}?${params.toString()}`);
    }, 400);
    return () => window.clearTimeout(t);
  }, [localQ, urlQ, pathname, router]);

  const setPage = useCallback(
    (next: number) => {
      const params = new URLSearchParams();
      const q = localQ.trim();
      if (q) params.set("q", q);
      params.set("page", String(Math.max(1, next)));
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, localQ],
  );

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  return {
    page: urlPage,
    q: urlQ,
    localQ,
    setLocalQ,
    setPage,
    refresh,
  };
}
