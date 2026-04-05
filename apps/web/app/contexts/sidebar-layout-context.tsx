"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "weehawk-sidebar-collapsed";

type SidebarLayoutContextValue = {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
};

const SidebarLayoutContext = createContext<SidebarLayoutContextValue | null>(null);

export function SidebarLayoutProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setCollapsedState(true);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--app-sidebar-width",
      collapsed ? "4rem" : "16rem",
    );
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const setCollapsed = useCallback((v: boolean) => setCollapsedState(v), []);
  const toggle = useCallback(() => setCollapsedState((c) => !c), []);

  const value = useMemo(
    () => ({ collapsed, setCollapsed, toggle }),
    [collapsed, setCollapsed, toggle],
  );

  return (
    <SidebarLayoutContext.Provider value={value}>{children}</SidebarLayoutContext.Provider>
  );
}

export function useSidebarLayout(): SidebarLayoutContextValue {
  const ctx = useContext(SidebarLayoutContext);
  if (!ctx) throw new Error("useSidebarLayout must be used within SidebarLayoutProvider");
  return ctx;
}
